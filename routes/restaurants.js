const express = require('express');
const router = express.Router();
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');

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
    const restaurant = await Restaurant.findById(req.params.id).select('name location');
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    res.json(restaurant);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
