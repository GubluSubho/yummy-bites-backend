const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const MenuItem = require('../models/MenuItem');
const ItemImage = require('../models/ItemImage');
const { verifyToken, requireRole } = require('../middleware/auth');
const { hasSizes, totalStock } = require('../utils/stock');

// Check a list of sizes (name, price and its own stock). An empty list means "no sizes".
function cleanSizes(input) {
  if (!Array.isArray(input)) return { error: 'Sizes must be a list' };
  if (input.length === 0) return { sizes: [] };
  if (input.length > 6) return { error: 'A dish can have at most 6 sizes' };
  const seen = new Set();
  const out = [];
  for (const s of input) {
    const name = String((s && s.name) || '').trim();
    const price = Number(s && s.price);
    const quantity = Number(s && s.quantity);
    if (!name || name.length > 24) return { error: 'Each size needs a name (max 24 characters)' };
    if (!Number.isFinite(price) || price < 1 || price > 5000) return { error: 'Enter a valid price for ' + name };
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1000) {
      return { error: 'Stock for ' + name + ' must be a whole number from 0 to 1000' };
    }
    if (seen.has(name.toLowerCase())) return { error: 'Size names must be different' };
    seen.add(name.toLowerCase());
    out.push({ name, price, quantity });
  }
  if (out.length < 2) return { error: 'Add at least two sizes, or turn sizes off to use one price' };
  return { sizes: out };
}

async function findOwnItem(req, res) {
  if (!mongoose.isValidObjectId(req.params.itemId)) {
    res.status(400).json({ error: 'Invalid item' });
    return null;
  }
  const item = await MenuItem.findById(req.params.itemId);
  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return null;
  }
  if (String(item.restaurantId) !== String(req.user.restaurantId)) {
    res.status(403).json({ error: 'Not your restaurant' });
    return null;
  }
  return item;
}

// A dish that had no price goes on sale the moment it gets one
function publishIfNew(item, wasUnpriced) {
  if (wasUnpriced && item.price > 0) {
    if (!hasSizes(item) && item.quantity <= 0) item.quantity = 30;
    item.isAvailable = true;
  }
}

// What customers get: for sized dishes, `quantity` is the total across sizes
function forCustomers(doc) {
  const o = doc.toObject();
  if (hasSizes(o)) o.quantity = totalStock(o);
  return o;
}

// Manager: every dish of their own cart, including ones that still need a price
router.get('/mine/list', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    res.json(await MenuItem.find({ restaurantId: req.user.restaurantId }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Public: the menu of a cart (dishes without a price are hidden)
router.get('/:restaurantId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.restaurantId)) {
      return res.status(400).json({ error: 'Invalid restaurant' });
    }
    const items = await MenuItem.find({ restaurantId: req.params.restaurantId, price: { $gt: 0 } });
    res.json(items.map(forCustomers));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Public: the photo of one dish. The app adds ?v=<imageRev>, so it can be cached for a long time.
router.get('/:itemId/image', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.itemId)) return res.status(404).end();
    const img = await ItemImage.findOne({ itemId: req.params.itemId });
    if (!img) return res.status(404).end();
    res.set('Content-Type', img.contentType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(img.data);
  } catch (err) {
    res.status(404).end();
  }
});

// Manager: set or replace the photo of a dish in their own cart
router.put('/:itemId/image', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;

    let raw = String(req.body.image || '');
    const marker = raw.indexOf('base64,');
    if (marker !== -1) raw = raw.slice(marker + 7);
    if (!raw || raw.length > 900000) {
      return res.status(400).json({ error: 'The photo is too large. Pick a smaller one.' });
    }

    const buf = Buffer.from(raw, 'base64');
    if (buf.length < 1000 || buf.length > 650000) {
      return res.status(400).json({ error: 'The photo is too small or too large.' });
    }
    if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) {
      return res.status(400).json({ error: 'Only JPEG photos are accepted.' });
    }

    await ItemImage.findOneAndUpdate(
      { itemId: item._id },
      { data: buf, contentType: 'image/jpeg' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    item.hasImage = true;
    item.imageRev = (item.imageRev || 0) + 1;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: remove the photo of a dish
router.delete('/:itemId/image', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;

    await ItemImage.deleteOne({ itemId: item._id });
    item.hasImage = false;
    item.imageRev = (item.imageRev || 0) + 1;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: add an item to their own cart only (with sizes, if the dish comes in sizes)
router.post('/add', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const { name, type, subType, sizes, price, quantity, prepTimeMins, showTime } = req.body;

    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length > 60) {
      return res.status(400).json({ error: 'Item name is required (max 60 characters)' });
    }

    let sizeList = [];
    if (Array.isArray(sizes) && sizes.length > 0) {
      const parsed = cleanSizes(sizes);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      sizeList = parsed.sizes;
    }
    const sized = sizeList.length > 0;

    const cleanPrice = sized ? Math.min(...sizeList.map((s) => s.price)) : Number(price);
    if (!Number.isFinite(cleanPrice) || cleanPrice < 0 || cleanPrice > 5000) {
      return res.status(400).json({ error: 'Enter a valid price' });
    }
    const cleanQty = sized ? 0 : quantity === undefined ? 0 : Number(quantity);
    if (!Number.isInteger(cleanQty) || cleanQty < 0 || cleanQty > 1000) {
      return res.status(400).json({ error: 'Stock must be a whole number from 0 to 1000' });
    }
    const cleanPrep = prepTimeMins === undefined ? 5 : Number(prepTimeMins);
    if (!Number.isInteger(cleanPrep) || cleanPrep < 1 || cleanPrep > 60) {
      return res.status(400).json({ error: 'Prep time must be 1 to 60 minutes' });
    }

    const item = await MenuItem.create({
      restaurantId: req.user.restaurantId,
      name: cleanName,
      type: type ? String(type).trim().slice(0, 30) : undefined,
      subType: subType ? String(subType).trim().slice(0, 30) : undefined,
      price: cleanPrice,
      sizes: sizeList,
      quantity: cleanQty,
      prepTimeMins: cleanPrep,
      showTime: showTime === true,
      isAvailable: sized ? true : cleanQty > 0,
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: switch an item on or off
router.patch('/:itemId/availability', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;

    if (typeof req.body.isAvailable !== 'boolean') {
      return res.status(400).json({ error: 'isAvailable must be true or false' });
    }
    if (req.body.isAvailable && totalStock(item) <= 0) {
      return res.status(400).json({ error: 'Set some stock before turning this item on' });
    }

    item.isAvailable = req.body.isAvailable;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: set stock of a dish without sizes. Zero turns it off, restocking from zero turns it back on.
router.patch('/:itemId/quantity', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;
    if (hasSizes(item)) {
      return res.status(400).json({ error: 'This dish has sizes. Set the stock of each size instead.' });
    }

    const qty = Number(req.body.quantity);
    if (!Number.isInteger(qty) || qty < 0 || qty > 1000) {
      return res.status(400).json({ error: 'Stock must be a whole number from 0 to 1000' });
    }

    if (qty === 0) item.isAvailable = false;
    else if (item.quantity === 0) item.isAvailable = true;

    item.quantity = qty;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: change the price of a dish without sizes
router.patch('/:itemId/price', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;
    if (hasSizes(item)) {
      return res.status(400).json({ error: 'This dish has sizes. Change the prices in the sizes list.' });
    }

    const price = Number(req.body.price);
    if (!Number.isFinite(price) || price < 0 || price > 5000) {
      return res.status(400).json({ error: 'Enter a valid price' });
    }

    const wasUnpriced = !(item.price > 0);
    item.price = price;
    publishIfNew(item, wasUnpriced);
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: choose whether this item shows an estimated time, and how many minutes it takes
router.patch('/:itemId/timing', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;

    if (typeof req.body.showTime !== 'boolean') {
      return res.status(400).json({ error: 'showTime must be true or false' });
    }
    if (req.body.prepTimeMins !== undefined) {
      const mins = Number(req.body.prepTimeMins);
      if (!Number.isInteger(mins) || mins < 1 || mins > 60) {
        return res.status(400).json({ error: 'Prep time must be 1 to 60 minutes' });
      }
      item.prepTimeMins = mins;
    }

    item.showTime = req.body.showTime;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: set the sizes of a dish, each with its own price and stock (an empty list removes the sizes)
router.patch('/:itemId/sizes', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;

    const parsed = cleanSizes(req.body.sizes);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const wasUnpriced = !(item.price > 0);
    if (parsed.sizes.length > 0) {
      item.sizes = parsed.sizes;
      item.price = Math.min(...parsed.sizes.map((s) => s.price));
    } else {
      // Going back to one price: keep the stock that was there
      item.quantity = totalStock(item);
      item.sizes = [];
    }
    publishIfNew(item, wasUnpriced);
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: change the name, category and sub-category of a dish
router.patch('/:itemId/details', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;

    const name = String(req.body.name === undefined ? item.name : req.body.name).trim();
    if (!name || name.length > 60) {
      return res.status(400).json({ error: 'Item name is required (max 60 characters)' });
    }
    if (req.body.type !== undefined) {
      item.type = String(req.body.type || '').trim().slice(0, 30) || undefined;
    }
    if (req.body.subType !== undefined) {
      item.subType = String(req.body.subType || '').trim().slice(0, 30) || undefined;
    }

    item.name = name;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: remove an item from their own cart
router.delete('/:itemId', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;

    await ItemImage.deleteOne({ itemId: item._id });
    await item.deleteOne();
    res.json({ message: 'Item removed' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
