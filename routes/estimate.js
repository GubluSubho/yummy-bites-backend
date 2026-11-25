const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const MenuItem = require('../models/MenuItem');
const Restaurant = require('../models/Restaurant');
const { verifyToken, requireRole } = require('../middleware/auth');
const { PARCEL_FEE, activeQueue, estimateFor } = require('../utils/rules');

// Preview the bill and the wait, and check stock, without placing an order
router.post('/', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const { restaurantId, items, parcel } = req.body;

    if (!mongoose.isValidObjectId(restaurantId)) return res.status(400).json({ error: 'Invalid restaurant' });
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
      return res.status(400).json({ error: 'Add 1 to 30 items' });
    }

    const lines = new Map();
    const wanted = new Map();
    for (const line of items) {
      const qty = Number(line.quantity);
      if (!mongoose.isValidObjectId(line.menuItemId) || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ error: 'Invalid item or quantity' });
      }
      const id = String(line.menuItemId);
      const size = String(line.size || '').trim().slice(0, 30);
      lines.set(id + '|' + size, (lines.get(id + '|' + size) || 0) + qty);
      wanted.set(id, (wanted.get(id) || 0) + qty);
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
      if (!d || d.price <= 0) problems.push('An item is no longer on the menu');
      else if (!d.isAvailable || d.quantity <= 0) {
        problems.push(d.name + (d.quantity <= 0 ? ' has sold out' : ' is not being served right now'));
      } else if (d.quantity < qty) problems.push('Only ' + d.quantity + ' left of ' + d.name);
    }

    for (const [key, qty] of lines) {
      const cut = key.indexOf('|');
      const d = byId.get(key.slice(0, cut));
      const size = key.slice(cut + 1);
      if (!d || d.price <= 0 || !d.isAvailable || d.quantity < wanted.get(String(d._id))) continue;

      const sizes = d.sizes || [];
      let price = d.price;
      if (sizes.length > 0) {
        const chosen = sizes.find((s) => s.name === size);
        if (!chosen) {
          problems.push('Choose a size for ' + d.name);
          continue;
        }
        price = chosen.price;
      } else if (size) {
        problems.push(d.name + ' does not come in sizes');
        continue;
      }
      orderItems.push({ prepTimeMins: d.showTime ? d.prepTimeMins || 5 : 0, quantity: qty });
      subtotal += price * qty;
    }

    if (restaurant.isOpen === false) {
      problems.unshift('This cart is closed right now. Please try again when it opens.');
    }
    const parcelFee = restaurant.allowParcel && parcel ? PARCEL_FEE : 0;
    const base = { liveCounter: !!restaurant.liveCounter, allowParcel: !!restaurant.allowParcel, parcelFee, problems };

    if (orderItems.length === 0) {
      return res.json({ ...base, estimatedWaitMins: 0, showEstimate: false, reason: null, subtotal: 0, total: 0 });
    }

    const queued = await activeQueue(restaurantId);
    const est = estimateFor(restaurant, queued, orderItems);
    res.json({
      ...base,
      estimatedWaitMins: est.mins,
      showEstimate: est.show,
      reason: est.reason,
      subtotal,
      total: subtotal + parcelFee,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
