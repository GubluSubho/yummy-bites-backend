const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const MenuItem = require('../models/MenuItem');
const { verifyToken, requireRole } = require('../middleware/auth');

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

// Public: full menu of a cart, including unavailable items (the app shows them struck off)
router.get('/:restaurantId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.restaurantId)) {
      return res.status(400).json({ error: 'Invalid restaurant' });
    }
    const items = await MenuItem.find({ restaurantId: req.params.restaurantId });
    res.json(items);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: add an item to their own cart only
router.post('/add', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const { name, type, price, quantity, prepTimeMins, showTime } = req.body;

    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length > 60) {
      return res.status(400).json({ error: 'Item name is required (max 60 characters)' });
    }
    const cleanPrice = Number(price);
    if (!Number.isFinite(cleanPrice) || cleanPrice < 0 || cleanPrice > 5000) {
      return res.status(400).json({ error: 'Enter a valid price' });
    }
    const cleanQty = quantity === undefined ? 0 : Number(quantity);
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
      price: cleanPrice,
      quantity: cleanQty,
      prepTimeMins: cleanPrep,
      showTime: showTime === true,
      isAvailable: cleanQty > 0,
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
    if (req.body.isAvailable && item.quantity <= 0) {
      return res.status(400).json({ error: 'Set the stock above 0 before turning this item on' });
    }

    item.isAvailable = req.body.isAvailable;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: set stock. Zero turns the item off, restocking from zero turns it back on.
router.patch('/:itemId/quantity', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;

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

// Manager: change the price
router.patch('/:itemId/price', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;

    const price = Number(req.body.price);
    if (!Number.isFinite(price) || price < 0 || price > 5000) {
      return res.status(400).json({ error: 'Enter a valid price' });
    }

    item.price = price;
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

// Manager: remove an item from their own cart
router.delete('/:itemId', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;

    await item.deleteOne();
    res.json({ message: 'Item removed' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
