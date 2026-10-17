const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const Restaurant = require('../models/Restaurant');
const { verifyToken, requireRole } = require('../middleware/auth');
const { calculateWait } = require('../utils/waitTime');

const ACTIVE = ['placed', 'preparing'];

// Preview the wait time and check stock without placing an order
router.post('/', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const { restaurantId, items } = req.body;

    if (!mongoose.isValidObjectId(restaurantId)) {
      return res.status(400).json({ error: 'Invalid restaurant' });
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
      return res.status(400).json({ error: 'Add 1 to 30 items' });
    }

    const wanted = new Map();
    for (const line of items) {
      const qty = Number(line.quantity);
      if (!mongoose.isValidObjectId(line.menuItemId) || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ error: 'Invalid item or quantity' });
      }
      const key = String(line.menuItemId);
      wanted.set(key, (wanted.get(key) || 0) + qty);
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    const docs = await MenuItem.find({ _id: { $in: [...wanted.keys()] }, restaurantId });
    const byId = new Map(docs.map((d) => [String(d._id), d]));

    const problems = [];
    const orderItems = [];
    let subtotal = 0;

    for (const [id, qty] of wanted) {
      const d = byId.get(id);
      if (!d) {
        problems.push('An item is no longer on the menu');
        continue;
      }
      if (!d.isAvailable || d.quantity <= 0) {
        problems.push(d.name + ' is out of stock');
        continue;
      }
      if (d.quantity < qty) {
        problems.push('Only ' + d.quantity + ' left of ' + d.name);
        continue;
      }
      orderItems.push({ prepTimeMins: d.prepTimeMins || 5, quantity: qty });
      subtotal += d.price * qty;
    }

    if (orderItems.length === 0) {
      return res.json({ estimatedWaitMins: 0, subtotal: 0, problems });
    }

    const queued = await Order.find({ restaurantId, status: { $in: ACTIVE } }).select('items status');
    const estimatedWaitMins = calculateWait({
      queuedOrders: queued,
      cooksOnDuty: restaurant.cooksOnDuty,
      newItems: orderItems,
    });

    res.json({ estimatedWaitMins, subtotal, problems });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
