const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const { verifyToken, requireRole } = require('../middleware/auth');
const { PARCEL_FEE, BUSY_QUEUE, ACTIVE } = require('../utils/rules');

const COUNTED = { $or: [{ paymentMethod: { $ne: 'upi' } }, { paymentStatus: 'paid' }] };

// Manager: own cart settings (must stay above the /:id route)
router.get('/mine', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.user.restaurantId).select('name cooksOnDuty liveCounter');
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({
      _id: restaurant._id,
      name: restaurant.name,
      cooksOnDuty: restaurant.cooksOnDuty,
      liveCounter: !!restaurant.liveCounter,
    });
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

// List all carts with item counts and the rules that apply to each
router.get('/', async (req, res) => {
  try {
    const restaurants = await Restaurant.find().select('name location liveCounter allowParcel').lean();

    const counts = await MenuItem.aggregate([
      {
        $group: {
          _id: '$restaurantId',
          totalItems: { $sum: 1 },
          availableItems: { $sum: { $cond: [{ $and: ['$isAvailable', { $gt: ['$quantity', 0] }] }, 1, 0] } },
        },
      },
    ]);
    const countMap = {};
    counts.forEach((c) => {
      countMap[String(c._id)] = c;
    });

    const waiting = await Order.aggregate([
      { $match: { status: { $in: ACTIVE }, ...COUNTED } },
      { $group: { _id: '$restaurantId', n: { $sum: 1 } } },
    ]);
    const waitMap = {};
    waiting.forEach((w) => {
      waitMap[String(w._id)] = w.n;
    });

    res.json(
      restaurants.map((r) => {
        const activeOrders = waitMap[String(r._id)] || 0;
        return {
          ...r,
          liveCounter: !!r.liveCounter,
          allowParcel: !!r.allowParcel,
          parcelFee: PARCEL_FEE,
          totalItems: countMap[String(r._id)]?.totalItems || 0,
          availableItems: countMap[String(r._id)]?.availableItems || 0,
          activeOrders,
          busy: activeOrders >= BUSY_QUEUE,
        };
      })
    );
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
    const r = await Restaurant.findById(req.params.id).select('name location liveCounter allowParcel').lean();
    if (!r) return res.status(404).json({ error: 'Restaurant not found' });

    const activeOrders = await Order.countDocuments({
      restaurantId: r._id,
      status: { $in: ACTIVE },
      ...COUNTED,
    });
    res.json({
      ...r,
      liveCounter: !!r.liveCounter,
      allowParcel: !!r.allowParcel,
      parcelFee: PARCEL_FEE,
      activeOrders,
      busy: activeOrders >= BUSY_QUEUE,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
