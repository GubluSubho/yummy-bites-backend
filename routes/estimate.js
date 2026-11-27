const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const MenuItem = require('../models/MenuItem');
const Restaurant = require('../models/Restaurant');
const { verifyToken, requireRole } = require('../middleware/auth');
const { PARCEL_FEE, activeQueue, estimateFor } = require('../utils/rules');
const { getConfig, quoteLine } = require('../utils/printPricing');
const { hasSizes } = require('../utils/stock');

const SERVICES = ['print', 'binding', 'lamination'];

// Preview the bill and the wait, and check stock, without placing an order
router.post('/', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const { restaurantId, items, parcel } = req.body;

    if (!mongoose.isValidObjectId(restaurantId)) return res.status(400).json({ error: 'Invalid restaurant' });
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
      return res.status(400).json({ error: 'Add 1 to 30 items' });
    }

    const lines = new Map();
    const services = [];
    for (const line of items) {
      if (line && line.service) {
        if (!SERVICES.includes(line.service)) return res.status(400).json({ error: 'Invalid item' });
        services.push({ service: line.service, job: line.job || {} });
        continue;
      }
      const qty = Number(line && line.quantity);
      if (!line || !mongoose.isValidObjectId(line.menuItemId) || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ error: 'Invalid item or quantity' });
      }
      const key = String(line.menuItemId) + '|' + String(line.size || '').trim().slice(0, 30);
      lines.set(key, (lines.get(key) || 0) + qty);
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    const ids = [...new Set([...lines.keys()].map((k) => k.slice(0, k.indexOf('|'))))];
    const docs = await MenuItem.find({ _id: { $in: ids }, restaurantId });
    const byId = new Map(docs.map((d) => [String(d._id), d]));

    const problems = [];
    const orderItems = [];
    let subtotal = 0;

    for (const [key, qty] of lines) {
      const cut = key.indexOf('|');
      const d = byId.get(key.slice(0, cut));
      const size = key.slice(cut + 1);

      if (!d || d.price <= 0) { problems.push('An item is no longer on the menu'); continue; }
      if (!d.isAvailable) { problems.push(d.name + ' is not being served right now'); continue; }

      const sized = hasSizes(d);
      let price = d.price;
      let have = d.quantity;
      if (sized) {
        const chosen = d.sizes.find((s) => s.name === size);
        if (!chosen) { problems.push('Choose a size for ' + d.name); continue; }
        price = chosen.price;
        have = chosen.quantity || 0;
      } else if (size) {
        problems.push(d.name + ' does not come in sizes');
        continue;
      }

      const label = d.name + (sized ? ' (' + size + ')' : '');
      if (have <= 0) { problems.push(label + ' has sold out'); continue; }
      if (have < qty) { problems.push('Only ' + have + ' left of ' + label); continue; }

      orderItems.push({ prepTimeMins: d.showTime ? d.prepTimeMins || 5 : 0, quantity: qty });
      subtotal += price * qty;
    }

    if (services.length > 0) {
      if (!restaurant.allowPrint) {
        problems.push('Printing is not available at this cart');
      } else {
        const config = await getConfig(restaurantId);
        for (const s of services) {
          const q = await quoteLine({ userId: req.user.id, config, service: s.service, job: s.job });
          if (q.error) problems.push(q.error);
          else subtotal += q.price;
        }
      }
    }

    if (restaurant.isOpen === false) {
      problems.unshift('This cart is closed right now. Please try again when it opens.');
    }
    const parcelFee = restaurant.allowParcel && parcel ? PARCEL_FEE : 0;
    const base = { liveCounter: !!restaurant.liveCounter, allowParcel: !!restaurant.allowParcel, parcelFee, problems };

    const queued = await activeQueue(restaurantId);
    const est = estimateFor(restaurant, queued, orderItems);
    res.json({
      ...base,
      estimatedWaitMins: orderItems.length === 0 && !est.show ? 0 : est.mins,
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
