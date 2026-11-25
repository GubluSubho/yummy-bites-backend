const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { PDFDocument } = require('pdf-lib');
const JSZip = require('jszip');
const router = express.Router();
const PrintFile = require('../models/PrintFile');
const PrintConfig = require('../models/PrintConfig');
const Restaurant = require('../models/Restaurant');
const Order = require('../models/Order');
const { verifyToken, requireRole } = require('../middleware/auth');
const { getConfig, cleanConfig, quoteLine } = require('../utils/printPricing');

const MAX_PAGES = 500;
const LINK_MINUTES = 15;

function sign(fileId, exp) {
  return crypto.createHmac('sha256', String(process.env.JWT_SECRET || '')).update(fileId + '.' + exp).digest('hex');
}

async function zipPages(zip, tag) {
  try {
    const f = zip.file('docProps/app.xml');
    if (!f) return null;
    const xml = await f.async('string');
    const m = new RegExp('<' + tag + '>(\\d+)</' + tag + '>').exec(xml);
    const n = m ? Number(m[1]) : null;
    return n && n > 0 ? n : null;
  } catch (e) {
    return null;
  }
}

// Work out what kind of file this really is (by its content, not its name) and how many pages it has
async function inspectFile(buf, name) {
  const h = buf.subarray(0, 12);

  if (h.subarray(0, 5).toString('latin1') === '%PDF-') {
    let pages = null;
    try {
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
      pages = doc.getPageCount();
    } catch (e) {
      pages = null;
    }
    return { mime: 'application/pdf', pages, exact: pages !== null };
  }
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { mime: 'image/jpeg', pages: 1, exact: true };
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return { mime: 'image/png', pages: 1, exact: true };
  if (h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { mime: 'image/webp', pages: 1, exact: true };
  }
  if (h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04) {
    try {
      const zip = await JSZip.loadAsync(buf);
      if (zip.file('word/document.xml')) {
        return {
          mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          pages: await zipPages(zip, 'Pages'),
          exact: false,
        };
      }
      if (zip.file('ppt/presentation.xml')) {
        return {
          mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          pages: await zipPages(zip, 'Slides'),
          exact: false,
        };
      }
    } catch (e) {
      return null;
    }
    return null;
  }
  if (h[0] === 0xd0 && h[1] === 0xcf && h[2] === 0x11 && h[3] === 0xe0) {
    const ppt = /\.ppt$/i.test(name);
    return { mime: ppt ? 'application/vnd.ms-powerpoint' : 'application/msword', pages: null, exact: false };
  }
  return null;
}

async function printCart(restaurantId) {
  if (!mongoose.isValidObjectId(restaurantId)) return null;
  const r = await Restaurant.findById(restaurantId).select('allowPrint name');
  return r && r.allowPrint ? r : null;
}

// Prices and whether this cart runs the print shop
router.get('/config/:restaurantId', verifyToken, async (req, res) => {
  try {
    const cart = await printCart(req.params.restaurantId);
    if (!cart) return res.json({ enabled: false });
    res.json({ enabled: true, ...(await getConfig(req.params.restaurantId)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: is the print shop part of my cart?
router.get('/enabled', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const cart = await printCart(req.user.restaurantId);
    res.json({ enabled: !!cart });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: change the print prices
router.put('/config', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const cart = await printCart(req.user.restaurantId);
    if (!cart) return res.status(400).json({ error: 'Printing is not available for this cart' });

    const current = await getConfig(req.user.restaurantId);
    const parsed = cleanConfig(req.body || {}, current);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    await PrintConfig.updateOne({ restaurantId: req.user.restaurantId }, { $set: parsed.config }, { upsert: true });
    res.json({ enabled: true, ...(await getConfig(req.user.restaurantId)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Customer: upload a document or image (sent as the raw file body)
router.post('/upload', verifyToken, requireRole('customer'), express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
  try {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 100) return res.status(400).json({ error: 'No file received' });

    let name = 'document';
    try {
      name = decodeURIComponent(String(req.headers['x-file-name'] || 'document'));
    } catch (e) {
      name = 'document';
    }
    name = name.replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 80) || 'document';

    const info = await inspectFile(buf, name);
    if (!info) {
      return res.status(400).json({ error: 'This file type is not supported. Use a PDF, Word or PowerPoint file, or an image.' });
    }
    if (info.pages && info.pages > MAX_PAGES) {
      return res.status(400).json({ error: 'Files over ' + MAX_PAGES + ' pages are not supported. Split the file first.' });
    }

    const doc = await PrintFile.create({
      userId: req.user.id,
      name,
      mime: info.mime,
      size: buf.length,
      pages: info.pages || undefined,
      pagesExact: info.exact,
      data: buf,
    });

    // Keep only the 25 newest files per customer
    const old = await PrintFile.find({ userId: req.user.id }).sort({ createdAt: -1 }).skip(25).select('_id');
    if (old.length > 0) await PrintFile.deleteMany({ _id: { $in: old.map((o) => o._id) } });

    res.json({
      fileId: String(doc._id),
      name,
      mime: info.mime,
      size: buf.length,
      pages: info.pages || null,
      pagesExact: info.exact,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer: price one print, binding or lamination line
router.post('/quote', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const { restaurantId, service, job } = req.body;
    const cart = await printCart(restaurantId);
    if (!cart) return res.status(400).json({ error: 'Printing is not available at this cart' });

    const config = await getConfig(restaurantId);
    const q = await quoteLine({ userId: req.user.id, config, service, job });
    if (q.error) return res.status(400).json({ error: q.error });
    res.json({ price: q.price, title: q.title, detail: q.detail });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: a short-lived link to open the file of a print job
router.get('/link/:orderId/:index', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: String(req.params.orderId).toUpperCase() });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (String(order.restaurantId) !== String(req.user.restaurantId)) {
      return res.status(403).json({ error: 'Not your restaurant' });
    }

    const line = order.items[Number(req.params.index)];
    if (!line || line.service !== 'print' || !line.job || !line.job.fileId) {
      return res.status(404).json({ error: 'This line has no file' });
    }

    const fileId = String(line.job.fileId);
    const exp = Date.now() + LINK_MINUTES * 60 * 1000;
    const base = req.protocol + '://' + req.get('host');
    res.json({
      url: base + '/api/print/file/' + fileId + '?exp=' + exp + '&sig=' + sign(fileId, exp),
      name: line.job.fileName,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// The file itself, only with a valid signed link
router.get('/file/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig || '');
    if (!mongoose.isValidObjectId(fileId) || !Number.isFinite(exp) || exp < Date.now()) {
      return res.status(403).send('This link has expired. Open the file again from the app.');
    }
    const expected = sign(fileId, exp);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).send('Invalid link');

    const f = await PrintFile.findById(fileId);
    if (!f) return res.status(404).send('File not found');

    res.set('Content-Type', f.mime || 'application/octet-stream');
    res.set('Content-Disposition', "inline; filename*=UTF-8''" + encodeURIComponent(f.name));
    res.set('Cache-Control', 'private, no-store');
    res.send(f.data);
  } catch (err) {
    res.status(404).send('File not found');
  }
});

router.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'The file is too large. The limit is 12 MB.' });
  }
  next(err);
});

module.exports = router;
