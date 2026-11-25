const mongoose = require('mongoose');
const PrintFile = require('../models/PrintFile');
const PrintConfig = require('../models/PrintConfig');

const DEFAULTS = {
  bwPerPage: 5,
  colorPerPage: 10,
  laminationPerPage: 15,
  binding: [
    { key: 'spiral', label: 'Spiral binding', base: 20, perPage: 0.5 },
    { key: 'comb', label: 'Comb binding', base: 25, perPage: 0.5 },
    { key: 'soft', label: 'Soft cover binding', base: 40, perPage: 0.4 },
  ],
};

const toInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};

function shape(doc) {
  return {
    bwPerPage: doc.bwPerPage,
    colorPerPage: doc.colorPerPage,
    laminationPerPage: doc.laminationPerPage,
    binding: (doc.binding || []).map((b) => ({ key: b.key, label: b.label, base: b.base, perPage: b.perPage })),
  };
}

async function getConfig(restaurantId) {
  let doc = await PrintConfig.findOne({ restaurantId }).lean();
  if (!doc) {
    try {
      doc = (await PrintConfig.create({ restaurantId, ...DEFAULTS })).toObject();
    } catch (e) {
      doc = await PrintConfig.findOne({ restaurantId }).lean();
    }
  }
  return shape(doc || DEFAULTS);
}

// Check prices a manager typed in. Binding types stay fixed, only their prices change.
function cleanConfig(input, current) {
  const out = {};
  for (const k of ['bwPerPage', 'colorPerPage', 'laminationPerPage']) {
    const n = Number(input[k]);
    if (!Number.isInteger(n) || n < 1 || n > 500) return { error: 'Prices must be whole rupees from 1 to 500' };
    out[k] = n;
  }
  const given = Array.isArray(input.binding) ? input.binding : [];
  out.binding = [];
  for (const cur of current.binding) {
    const g = given.find((b) => b && b.key === cur.key) || cur;
    const base = Number(g.base);
    const perPage = Number(g.perPage);
    if (!Number.isFinite(base) || base < 0 || base > 2000) return { error: 'Check the starting price for ' + cur.label };
    if (!Number.isFinite(perPage) || perPage < 0 || perPage > 50) return { error: 'Check the per-page price for ' + cur.label };
    out.binding.push({
      key: cur.key,
      label: cur.label,
      base: Math.round(base * 100) / 100,
      perPage: Math.round(perPage * 100) / 100,
    });
  }
  return { config: out };
}

// "1-5, 8, 10-12" -> number of distinct pages inside 1..total
function parseRange(text, total) {
  const set = new Set();
  const parts = String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { error: 'Enter the pages to print, like 1-5, 8' };
  for (const p of parts) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(p);
    if (!m) return { error: 'Use pages like 1-5, 8, 10-12' };
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > total) return { error: 'Pages must be between 1 and ' + total };
    for (let i = a; i <= b; i++) set.add(i);
  }
  return { count: set.size, text: parts.join(', ') };
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '...' : s);

// Price one print, binding or lamination line. Everything is recomputed on the server.
async function quoteLine({ userId, config, service, job }) {
  const j = job || {};

  if (service === 'print') {
    if (!mongoose.isValidObjectId(j.fileId)) return { error: 'Upload a file first' };
    const file = await PrintFile.findOne({ _id: j.fileId, userId }).select('name pages pagesExact');
    if (!file) return { error: 'That file is no longer available. Please upload it again.' };

    const total = file.pagesExact && file.pages ? file.pages : toInt(j.pages);
    if (!total || total < 1 || total > 500) return { error: 'Enter the number of pages (1 to 500)' };
    const copies = toInt(j.copies);
    if (!copies || copies < 1 || copies > 50) return { error: 'Copies must be from 1 to 50' };

    const color = j.color === 'color' ? 'color' : 'bw';
    const orientation = j.orientation === 'landscape' ? 'landscape' : 'portrait';
    let pages = total;
    let range = '';
    const rangeText = String(j.range || '').trim().slice(0, 60);
    if (rangeText) {
      const r = parseRange(rangeText, total);
      if (r.error) return { error: r.error };
      pages = r.count;
      range = r.text;
    }

    const rate = color === 'color' ? config.colorPerPage : config.bwPerPage;
    const price = Math.ceil(pages * rate * copies);
    const detail =
      plural(pages, 'page', 'pages') + ' | ' + (color === 'color' ? 'Colour' : 'B&W') + ' | ' +
      plural(copies, 'copy', 'copies') + ' | ' + (orientation === 'landscape' ? 'Landscape' : 'Portrait') +
      (range ? ' | pages ' + range : '');
    return {
      price,
      title: 'Print: ' + short(file.name, 28),
      detail,
      job: { fileId: String(file._id), fileName: file.name, totalPages: total, range, pages, copies, color, orientation },
    };
  }

  if (service === 'binding') {
    const type = (config.binding || []).find((b) => b.key === j.type);
    if (!type) return { error: 'Choose a binding type' };
    const pages = toInt(j.pages);
    if (!pages || pages < 1 || pages > 500) return { error: 'Enter the number of pages (1 to 500)' };
    return {
      price: Math.ceil(type.base + type.perPage * pages),
      title: 'Binding: ' + type.label,
      detail: plural(pages, 'page', 'pages'),
      job: { type: type.key, pages },
    };
  }

  if (service === 'lamination') {
    const pages = toInt(j.pages);
    if (!pages || pages < 1 || pages > 200) return { error: 'Enter the number of pages (1 to 200)' };
    return {
      price: pages * config.laminationPerPage,
      title: 'Lamination',
      detail: plural(pages, 'page', 'pages'),
      job: { pages },
    };
  }

  return { error: 'Unknown service' };
}

module.exports = { DEFAULTS, getConfig, cleanConfig, parseRange, quoteLine };
