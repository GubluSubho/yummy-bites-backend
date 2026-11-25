const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Restaurant = require('../models/Restaurant');
const RestaurantImage = require('../models/RestaurantImage');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const { verifyToken, requireRole } = require('../middleware/auth');
const { PARCEL_FEE, BUSY_QUEUE, ACTIVE } = require('../utils/rules');

const COUNTED = { $or: [{ paymentMethod: { $ne: 'upi' } }, { paymentStatus: 'paid' }] };

// Read a JPEG photo sent as base64 and check it
function readJpeg(body) {
  let raw = String(body.image || '');
  const marker = raw.indexOf('base64,');
  if (marker !== -1) raw = raw.slice(marker + 7);
  if (!raw || raw.length > 900000) return { error: 'The photo is too large. Pick a smaller one.' };

  const buf = Buffer.from(raw, 'base64');
  if (buf.length < 1000 || buf.length > 650000) return { error: 'The photo is too small or too large.' };
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return { error: 'Only JPEG photos are accepted.' };
  return { buf };
}

// Manager: own cart settings (must stay above the /:id route)
router.get('/mine', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const r = await Restaurant.findById(req.user.restaurantId).select(
      'name cooksOnDuty liveCounter isOpen hasImage imageRev allowSizes'
    );
    if (!r) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({
      _id: r._id,
      name: r.name,
      cooksOnDuty: r.cooksOnDuty,
      allowSizes: !!r.allowSizes,
      liveCounter: !!r.liveCounter,
      isOpen: r.isOpen !== false,
      hasImage: !!r.hasImage,
      imageRev: r.imageRev || 0,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: open or close the cart. A closed cart takes no new orders.
router.patch('/mine/open', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    if (typeof req.body.isOpen !== 'boolean') {
      return res.status(400).json({ error: 'isOpen must be true or false' });
    }
    const restaurant = await Restaurant.findByIdAndUpdate(
      req.user.restaurantId,
      { isOpen: req.body.isOpen },
      { new: true }
    ).select('name isOpen');
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ name: restaurant.name, isOpen: restaurant.isOpen !== false });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: how many cooks are working. Only the live counter uses this.
router.patch('/mine/cooks', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const own = await Restaurant.findById(req.user.restaurantId).select('liveCounter');
    if (!own) return res.status(404).json({ error: 'Restaurant not found' });
    if (!own.liveCounter) {
      return res.status(400).json({ error: 'Cooks on duty only applies to the live counter' });
    }

    const cooks = Number(req.body.cooksOnDuty);
    if (!Number.isInteger(cooks) || cooks < 1 || cooks > 10) {
      return res.status(400).json({ error: 'Cooks on duty must be a whole number from 1 to 10' });
    }
    const restaurant = await Restaurant.findByIdAndUpdate(
      req.user.restaurantId,
      { cooksOnDuty: cooks },
      { new: true }
    ).select('name cooksOnDuty');
    res.json(restaurant);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: set or replace the photo of their own cart
router.put('/mine/image', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const parsed = readJpeg(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    await RestaurantImage.findOneAndUpdate(
      { restaurantId: req.user.restaurantId },
      { data: parsed.buf, contentType: 'image/jpeg' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const r = await Restaurant.findByIdAndUpdate(
      req.user.restaurantId,
      { $set: { hasImage: true }, $inc: { imageRev: 1 } },
      { new: true }
    ).select('hasImage imageRev');
    res.json({ hasImage: !!r.hasImage, imageRev: r.imageRev || 0 });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: remove the photo of their own cart
router.delete('/mine/image', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    await RestaurantImage.deleteOne({ restaurantId: req.user.restaurantId });
    const r = await Restaurant.findByIdAndUpdate(
      req.user.restaurantId,
      { $set: { hasImage: false }, $inc: { imageRev: 1 } },
      { new: true }
    ).select('hasImage imageRev');
    res.json({ hasImage: !!r.hasImage, imageRev: r.imageRev || 0 });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Public: the photo of a cart. The app adds ?v=<imageRev>, so it can be cached for a long time.
router.get('/:id/image', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
    const img = await RestaurantImage.findOne({ restaurantId: req.params.id });
    if (!img) return res.status(404).end();
    res.set('Content-Type', img.contentType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(img.data);
  } catch (err) {
    res.status(404).end();
  }
});

// List all carts with item counts and the rules that apply to each
router.get('/', async (req, res) => {
  try {
    const restaurants = await Restaurant.find()
      .select('name location liveCounter allowParcel isOpen hasImage imageRev')
      .lean();

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
          isOpen: r.isOpen !== false,
          hasImage: !!r.hasImage,
          imageRev: r.imageRev || 0,
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
    const r = await Restaurant.findById(req.params.id)
      .select('name location liveCounter allowParcel isOpen hasImage imageRev')
      .lean();
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
      isOpen: r.isOpen !== false,
      hasImage: !!r.hasImage,
      imageRev: r.imageRev || 0,
      parcelFee: PARCEL_FEE,
      activeOrders,
      busy: activeOrders >= BUSY_QUEUE,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
