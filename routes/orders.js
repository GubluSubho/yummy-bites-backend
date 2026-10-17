const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const { verifyToken, requireRole } = require('../middleware/auth');
const { calculateWait } = require('../utils/waitTime');

const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ACTIVE = ['placed', 'preparing'];
const ALLOWED_PAYMENTS = ['upi', 'wallet', 'cash'];
const NEXT_STATUS = {
  placed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed'],
  completed: [],
  cancelled: [],
};

async function makeOrderId() {
  for (let attempt = 0; attempt < 5; attempt++) {
    let id = 'ORD-';
    for (let i = 0; i < 6; i++) {
      id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
    }
    if (!(await Order.exists({ orderId: id }))) return id;
  }
  throw new Error('Could not generate an order ID, please try again');
}

function remainingMins(order) {
  if (['ready', 'completed', 'cancelled'].includes(order.status)) return 0;
  const elapsed = (Date.now() - new Date(order.createdAt).getTime()) / 60000;
  return Math.max(0, Math.ceil(order.estimatedWaitMins - elapsed));
}

function present(order) {
  const plain = order.toObject ? order.toObject() : order;
  return { ...plain, remainingMins: remainingMins(plain) };
}

async function withNames(input) {
  const list = Array.isArray(input) ? input : [input];
  const ids = [...new Set(list.map((o) => String(o.restaurantId)))];
  const rests = await Restaurant.find({ _id: { $in: ids } }).select('name').lean();
  const names = new Map(rests.map((r) => [String(r._id), r.name]));
  const out = list.map((o) => ({
    ...present(o),
    restaurantName: names.get(String(o.restaurantId)) || '',
  }));
  return Array.isArray(input) ? out : out[0];
}

async function restoreStock(items) {
  for (const it of items) {
    await MenuItem.updateOne({ _id: it.menuItemId }, { $inc: { quantity: it.quantity } });
  }
}

// Give wallet money back for a cancelled order. Safe to call twice: only the first call pays out.
async function refundWallet(order) {
  if (order.paymentMethod !== 'wallet') return;
  const marked = await Order.findOneAndUpdate(
    { _id: order._id, paymentStatus: 'paid' },
    { paymentStatus: 'refunded' },
    { new: true }
  );
  if (!marked) return;

  const user = await User.findByIdAndUpdate(
    order.userId,
    { $inc: { walletBalance: order.total } },
    { new: true }
  );
  if (!user) return;

  try {
    await WalletTransaction.create({
      userId: user._id,
      type: 'refund',
      amount: order.total,
      balanceAfter: user.walletBalance,
      orderId: order.orderId,
      note: 'Order cancelled by the cart',
    });
  } catch (e) {
    console.log('Wallet log failed:', e.message);
  }
}

// Place an order (customers only)
router.post('/', verifyToken, requireRole('customer'), async (req, res) => {
  const reserved = [];
  let charge = null;
  try {
    const { restaurantId, items, instructions, paymentMethod } = req.body;

    if (!mongoose.isValidObjectId(restaurantId)) {
      return res.status(400).json({ error: 'Invalid restaurant' });
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
      return res.status(400).json({ error: 'Add 1 to 30 items to the order' });
    }

    const method = paymentMethod || 'cash';
    if (!ALLOWED_PAYMENTS.includes(method)) {
      return res.status(400).json({ error: 'Choose UPI, wallet or cash' });
    }

    const note = String(instructions || '').trim();
    if (note.length > 200) {
      return res.status(400).json({ error: 'Special instructions can be at most 200 characters' });
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

    const user = await User.findById(req.user.id);
    if (!user || !user.phone) {
      return res.status(400).json({ error: 'Add a phone number to your profile before ordering' });
    }

    const orderItems = [];
    for (const [menuItemId, qty] of wanted) {
      const item = await MenuItem.findOneAndUpdate(
        { _id: menuItemId, restaurantId, isAvailable: true, quantity: { $gte: qty } },
        { $inc: { quantity: -qty } },
        { new: true }
      );

      if (!item) {
        await restoreStock(reserved);
        reserved.length = 0;
        const missing = await MenuItem.findById(menuItemId).select('name');
        const label = missing ? missing.name : 'An item';
        return res.status(400).json({ error: label + ' is unavailable or out of stock' });
      }

      reserved.push({ menuItemId: item._id, quantity: qty });
      orderItems.push({
        menuItemId: item._id,
        name: item.name,
        price: item.price,
        quantity: qty,
        prepTimeMins: item.prepTimeMins || 5,
      });
    }

    await MenuItem.updateMany(
      { _id: { $in: [...wanted.keys()] }, quantity: { $lte: 0 } },
      { $set: { isAvailable: false } }
    );

    const total = orderItems.reduce((sum, it) => sum + it.price * it.quantity, 0);

    let balanceAfter = null;
    if (method === 'wallet') {
      const payer = await User.findOneAndUpdate(
        { _id: user._id, walletBalance: { $gte: total } },
        { $inc: { walletBalance: -total } },
        { new: true }
      );
      if (!payer) {
        await restoreStock(reserved);
        reserved.length = 0;
        return res.status(400).json({
          error: 'Not enough wallet balance. Add money at a cart counter or pick another payment method.',
        });
      }
      charge = { userId: user._id, amount: total };
      balanceAfter = payer.walletBalance;
    }

    const queued = await Order.find({ restaurantId, status: { $in: ACTIVE } }).select('items status');
    const estimatedWaitMins = calculateWait({
      queuedOrders: queued,
      cooksOnDuty: restaurant.cooksOnDuty,
      newItems: orderItems,
    });

    const orderId = await makeOrderId();

    const order = await Order.create({
      orderId,
      userId: user._id,
      restaurantId,
      customerName: user.name,
      phone: user.phone,
      items: orderItems,
      instructions: note,
      total,
      paymentMethod: method,
      paymentStatus: method === 'wallet' ? 'paid' : 'pending',
      estimatedWaitMins,
    });

    reserved.length = 0;
    charge = null;

    if (method === 'wallet') {
      try {
        await WalletTransaction.create({
          userId: user._id,
          type: 'payment',
          amount: total,
          balanceAfter,
          orderId: order.orderId,
          note: 'Order at ' + restaurant.name,
        });
      } catch (e) {
        console.log('Wallet log failed:', e.message);
      }
    }

    res.status(201).json(await withNames(order));
  } catch (err) {
    try {
      await restoreStock(reserved);
      if (charge) {
        await User.updateOne({ _id: charge.userId }, { $inc: { walletBalance: charge.amount } });
      }
    } catch (e) {
      console.log('Rollback failed:', e.message);
    }
    res.status(500).json({ error: err.message });
  }
});

// A customer's own orders
router.get('/mine', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(50);
    res.json(await withNames(orders));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// A manager's live queue (their own cart only)
router.get('/restaurant', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const orders = await Order.find({
      restaurantId: req.user.restaurantId,
      status: { $in: ['placed', 'preparing', 'ready'] },
    }).sort({ createdAt: 1 });
    res.json(await withNames(orders));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Track one order by Order ID (owner or that cart's manager)
router.get('/:orderId', verifyToken, async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: String(req.params.orderId).toUpperCase() });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const isOwner = String(order.userId) === String(req.user.id);
    const isCartManager =
      req.user.role === 'manager' && String(order.restaurantId) === String(req.user.restaurantId);
    if (!isOwner && !isCartManager) {
      return res.status(403).json({ error: 'Not your order' });
    }

    res.json(await withNames(order));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager moves an order along (own cart only)
router.patch('/:orderId/status', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findOne({ orderId: String(req.params.orderId).toUpperCase() });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (String(order.restaurantId) !== String(req.user.restaurantId)) {
      return res.status(403).json({ error: 'Not your restaurant' });
    }
    if (!NEXT_STATUS[order.status].includes(status)) {
      return res.status(400).json({ error: 'Cannot move an order from ' + order.status + ' to ' + status });
    }

    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: order.status },
      { status },
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({ error: 'Order was just updated, refresh and try again' });
    }

    if (status === 'cancelled') {
      await restoreStock(order.items);
      await refundWallet(updated);
    }

    const fresh = await Order.findById(order._id);
    res.json(await withNames(fresh));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
