const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const { verifyToken, requireRole } = require('../middleware/auth');

// Manager: own cart settings (must stay above the /:id route)
router.get('/mine', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.user.restaurantId).select('name cooksOnDuty');
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    res.json(restaurant);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: how many cooks are working right now (shortens or lengthens wait estimates)
router.patch('/mine/cooks', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const cooks = Number(req.body.cooksOnDuty);
    if (!Number.isInteger(cooks) || cooks < 1 || cooks > 10) {
      return res.status(400).json({ error: 'Cooks on duty must be a whole number from 1 to 10' });
    }
    const restaurant = await Restaurant.findByIdAndUpdate(
      req.user.restaurantId,
      { cooksOnDuty: cooks },
      { new: true }
    ).select('name cooksOnDuty');
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    res.json(restaurant);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List all carts with item counts
router.get('/', async (req, res) => {
  try {
    const restaurants = await Restaurant.find().select('name location').lean();

    const counts = await MenuItem.aggregate([
      {
        $group: {
          _id: '$restaurantId',
          totalItems: { $sum: 1 },
          availableItems: { $sum: { $cond: ['$isAvailable', 1, 0] } },
        },
      },
    ]);

    const countMap = {};
    counts.forEach((c) => {
      countMap[String(c._id)] = c;
    });

    const result = restaurants.map((r) => ({
      ...r,
      totalItems: countMap[String(r._id)]?.totalItems || 0,
      availableItems: countMap[String(r._id)]?.availableItems || 0,
    }));

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Single cart
router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid restaurant' });
    }
    const restaurant = await Restaurant.findById(req.params.id).select('name location');
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    res.json(restaurant);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
