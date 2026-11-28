const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const WalletTransaction = require('../models/WalletTransaction');
const { verifyToken, requireRole } = require('../middleware/auth');

const staff = [verifyToken, requireRole('admin')];
const IST = 19800000;
const DAY = 86400000;
const TZ = 'Asia/Kolkata';
const LIVE = ['placed', 'preparing', 'ready'];
const COUNTED = { $or: [{ paymentMethod: { $ne: 'upi' } }, { paymentStatus: 'paid' }] };

// Start of today / the last 7 days / the last 30 days, in Indian time
function startOf(range) {
  const todayStart = Math.floor((Date.now() + IST) / DAY) * DAY - IST;
  const days = range === 'month' ? 30 : range === 'week' ? 7 : 1;
  return new Date(todayStart - (days - 1) * DAY);
}
const rangeOf = (q) => (['today', 'week', 'month'].includes(q) ? q : 'today');
const SALE = (start) => ({ createdAt: { $gte: start }, paymentStatus: 'paid', status: { $ne: 'cancelled' } });
const stockExpr = { $cond: [{ $gt: [{ $size: { $ifNull: ['$sizes', []] } }, 0] }, { $sum: '$sizes.quantity' }, '$quantity'] };

function makePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[bytes[i] % chars.length];
  return out;
}

router.get('/overview', staff, async (req, res) => {
  try {
    const range = rangeOf(req.query.range);
    const start = startOf(range);
    const sale = SALE(start);
    const [carts, total, byCart, hourly, daily, mix, recent, active, cancelled, walletAgg] = await Promise.all([
      Restaurant.find().select('name').lean(),
      Order.aggregate([{ $match: sale }, { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 }, parcels: { $sum: { $cond: ['$isParcel', 1, 0] } } } }]),
      Order.aggregate([{ $match: sale }, { $group: { _id: '$restaurantId', revenue: { $sum: '$total' }, orders: { $sum: 1 } } }]),
      Order.aggregate([{ $match: sale }, { $group: { _id: { $hour: { date: '$createdAt', timezone: TZ } }, orders: { $sum: 1 }, revenue: { $sum: '$total' } } }]),
      Order.aggregate([{ $match: sale }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } }, orders: { $sum: 1 }, revenue: { $sum: '$total' } } }]),
      Order.aggregate([{ $match: sale }, { $group: { _id: '$paymentMethod', revenue: { $sum: '$total' }, orders: { $sum: 1 } } }]),
      Order.find().sort({ createdAt: -1 }).limit(8).select('orderId restaurantId customerName total status createdAt').lean(),
      Order.countDocuments({ status: { $in: LIVE }, ...COUNTED }),
      Order.countDocuments({ createdAt: { $gte: start }, status: 'cancelled', paymentStatus: { $ne: 'failed' } }),
      User.aggregate([{ $match: { role: 'customer' } }, { $group: { _id: null, float: { $sum: '$walletBalance' }, customers: { $sum: 1 } } }]),
    ]);

    const names = new Map(carts.map((c) => [String(c._id), c.name]));
    const t = total[0] || { revenue: 0, orders: 0, parcels: 0 };

    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, revenue: 0 }));
    hourly.forEach((h) => { if (h._id >= 0 && h._id < 24) hours[h._id] = { hour: h._id, orders: h.orders, revenue: h.revenue }; });

    const days = range === 'today' ? 0 : range === 'week' ? 7 : 30;
    const dayMap = new Map(daily.map((d) => [d._id, d]));
    const series = [];
    for (let k = 0; k < days; k++) {
      const key = new Date(start.getTime() + k * DAY + IST).toISOString().slice(0, 10);
      const d = dayMap.get(key);
      series.push({ date: key, revenue: d ? d.revenue : 0, orders: d ? d.orders : 0 });
    }

    res.json({
      range,
      revenue: t.revenue,
      orders: t.orders,
      parcels: t.parcels,
      avgOrder: t.orders ? Math.round(t.revenue / t.orders) : 0,
      cancelled,
      activeNow: active,
      walletFloat: walletAgg[0] ? walletAgg[0].float : 0,
      customers: walletAgg[0] ? walletAgg[0].customers : 0,
      byCart: byCart
        .map((c) => ({ name: names.get(String(c._id)) || 'Unknown', revenue: c.revenue, orders: c.orders }))
        .sort((a, b) => b.revenue - a.revenue),
      hours,
      series,
      mix: mix.map((m) => ({ method: m._id, revenue: m.revenue, orders: m.orders })),
      recent: recent.map((o) => ({ ...o, cart: names.get(String(o.restaurantId)) || '' })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/top-items', staff, async (req, res) => {
  try {
    const start = startOf(rangeOf(req.query.range));
    const rows = await Order.aggregate([
      { $match: SALE(start) },
      { $unwind: '$items' },
      { $group: { _id: { $ifNull: ['$items.service', '$items.name'] }, qty: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]);
    const label = { print: 'Printing', binding: 'Binding', lamination: 'Lamination' };
    res.json(rows.map((r) => ({ name: label[r._id] || r._id, qty: r.qty, revenue: r.revenue })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/carts', staff, async (req, res) => {
  try {
    const todayStart = startOf('today');
    const [carts, managers, today, stock, live] = await Promise.all([
      Restaurant.find().lean(),
      User.find({ role: 'manager' }).select('name email restaurantId').lean(),
      Order.aggregate([{ $match: SALE(todayStart) }, { $group: { _id: '$restaurantId', revenue: { $sum: '$total' }, orders: { $sum: 1 } } }]),
      MenuItem.aggregate([
        { $match: { price: { $gt: 0 } } },
        { $group: { _id: '$restaurantId', dishes: { $sum: 1 }, out: { $sum: { $cond: [{ $lte: [stockExpr, 0] }, 1, 0] } } } },
      ]),
      Order.aggregate([{ $match: { status: { $in: LIVE }, ...COUNTED } }, { $group: { _id: '$restaurantId', n: { $sum: 1 } } }]),
    ]);
    const by = (rows) => new Map(rows.map((r) => [String(r._id), r]));
    const T = by(today), S = by(stock), L = by(live);
    res.json(
      carts.map((c) => {
        const id = String(c._id);
        const mgr = managers.filter((m) => String(m.restaurantId) === id);
        return {
          _id: c._id,
          name: c.name,
          isOpen: c.isOpen !== false,
          liveCounter: !!c.liveCounter,
          allowPrint: !!c.allowPrint,
          allowParcel: !!c.allowParcel,
          managers: mgr.map((m) => ({ _id: m._id, name: m.name, email: m.email })),
          revenueToday: T.get(id) ? T.get(id).revenue : 0,
          ordersToday: T.get(id) ? T.get(id).orders : 0,
          dishes: S.get(id) ? S.get(id).dishes : 0,
          soldOut: S.get(id) ? S.get(id).out : 0,
          activeOrders: L.get(id) ? L.get(id).n : 0,
        };
      }).sort((a, b) => b.revenueToday - a.revenueToday)
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The owner can open or close any cart
router.patch('/carts/:id/open', staff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || typeof req.body.isOpen !== 'boolean') {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const r = await Restaurant.findByIdAndUpdate(req.params.id, { isOpen: req.body.isOpen }, { new: true }).select('name isOpen');
    if (!r) return res.status(404).json({ error: 'Cart not found' });
    res.json({ name: r.name, isOpen: r.isOpen !== false });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add a new cart together with its manager login. The password is shown once.
router.post('/carts', staff, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.managerEmail || '').trim().toLowerCase();
    const managerName = String(req.body.managerName || '').trim() || name + ' Manager';
    if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Cart name must be 2 to 40 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid manager email' });

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (await Restaurant.findOne({ name: new RegExp('^' + escaped + '$', 'i') })) return res.status(409).json({ error: 'A cart with this name already exists' });
    if (await User.findOne({ email })) return res.status(409).json({ error: 'That email is already in use' });

    const cart = await Restaurant.create({
      name,
      liveCounter: req.body.liveCounter === true,
      allowParcel: req.body.allowParcel === true,
      allowPrint: req.body.allowPrint === true,
      allowSizes: true,
    });
    const password = makePassword();
    const manager = await User.create({
      name: managerName,
      email,
      password: await bcrypt.hash(password, 10),
      role: 'manager',
      restaurantId: cart._id,
      accountType: 'normal',
      authProvider: 'password',
    });
    res.status(201).json({ cart: { _id: cart._id, name: cart.name }, manager: { _id: manager._id, email, password } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/managers/:userId/reset-password', staff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) return res.status(400).json({ error: 'Invalid manager' });
    const m = await User.findOne({ _id: req.params.userId, role: 'manager' });
    if (!m) return res.status(404).json({ error: 'Manager not found' });
    const password = makePassword();
    await User.updateOne({ _id: m._id }, { $set: { password: await bcrypt.hash(password, 10) } });
    res.json({ email: m.email, password });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/wallet', staff, async (req, res) => {
  try {
    const start = startOf('week');
    const [floatAgg, flows, byManager, recent] = await Promise.all([
      User.aggregate([{ $match: { role: 'customer' } }, { $group: { _id: null, float: { $sum: '$walletBalance' }, holders: { $sum: { $cond: [{ $gt: ['$walletBalance', 0] }, 1, 0] } } } }]),
      WalletTransaction.aggregate([{ $match: { createdAt: { $gte: start } } }, { $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      WalletTransaction.aggregate([
        { $match: { createdAt: { $gte: start }, type: 'topup', managerId: { $exists: true } } },
        { $group: { _id: '$managerId', amount: { $sum: '$amount' }, count: { $sum: 1 }, biggest: { $max: '$amount' } } },
        { $sort: { amount: -1 } },
      ]),
      WalletTransaction.find({ type: 'topup', managerId: { $exists: true } }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);

    const ids = [...new Set([...byManager.map((m) => String(m._id)), ...recent.map((r) => String(r.managerId))])];
    const mgrs = await User.find({ _id: { $in: ids } }).select('name email restaurantId').lean();
    const carts = await Restaurant.find().select('name').lean();
    const cartName = new Map(carts.map((c) => [String(c._id), c.name]));
    const mgr = new Map(mgrs.map((m) => [String(m._id), { name: m.name, cart: cartName.get(String(m.restaurantId)) || '' }]));
    const flow = (type) => flows.find((f) => f._id === type) || { amount: 0, count: 0 };

    res.json({
      float: floatAgg[0] ? floatAgg[0].float : 0,
      holders: floatAgg[0] ? floatAgg[0].holders : 0,
      topups: flow('topup'),
      spent: flow('payment'),
      refunds: flow('refund'),
      byManager: byManager.map((m) => ({ ...(mgr.get(String(m._id)) || { name: 'Unknown', cart: '' }), amount: m.amount, count: m.count, biggest: m.biggest })),
      recent: recent.map((r) => ({
        amount: r.amount,
        createdAt: r.createdAt,
        ...(mgr.get(String(r.managerId)) || { name: 'Unknown', cart: '' }),
        flagged: r.amount >= 1000,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
