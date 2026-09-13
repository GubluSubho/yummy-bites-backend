const express = require('express');
const router = express.Router();
const MenuItem = require('../models/MenuItem');
const { verifyToken } = require('../middleware/auth');

router.get('/:restaurantId', async (req, res) => {
  try {
    const items = await MenuItem.find({ restaurantId: req.params.restaurantId });
    res.json(items);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/add', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'manager') return res.status(403).json({ error: 'Managers only' });
    const item = await MenuItem.create(req.body);
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:itemId/availability', verifyToken, async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (String(item.restaurantId) !== String(req.user.restaurantId))
      return res.status(403).json({ error: 'Not your restaurant' });

    item.isAvailable = req.body.isAvailable;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:itemId/quantity', verifyToken, async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (String(item.restaurantId) !== String(req.user.restaurantId))
      return res.status(403).json({ error: 'Not your restaurant' });

    item.quantity = req.body.quantity;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;