const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const { verifyToken, requireRole } = require('../middleware/auth');
const { PARCEL_FEE, activeQueue, estimateFor } = require('../utils/rules');
const { refundUpi, settleOrCancel } = require('../utils/payments');

const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Cash is not accepted any more: online payment or the wallet only
const ALLOWED_PAYMENTS = ['upi', 'wallet'];
// How long an unpaid online order may hold its stock before it is released
const PAYMENT_WINDOW_MS = 10 * 60 * 1000;
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
  const rests = await Restaurant.find({ _id: { $in: ids } }).select('name liveCounter').lean();
  const info = new Map(rests.map((r) => [String(r._id), r]));
  const out = list.map((o) => {
    const r = info.get(String(o.restaurantId));
    return {
      ...present(o),
      restaurantName: r ? r.name : '',
      liveCounter: !!(r && r.liveCounter),
    };
  });
  return Array.isArray(input) ? out : out[0];
}

async function restoreStock(items) {
  for (const it of items) {
    await MenuItem.updateOne({ _id: it.menuItemId }, { $inc: { quantity: it.quantity } });
  }
}

// Explain to the customer why an item could not be reserved
async function soldOutMessage(menuItemId, restaurantId, wantedQty) {
  const doc = await MenuItem.findOne({ _id: menuItemId, restaurantId }).select('name quantity isAvailable');
  if (!doc) return 'An item is no longer on the menu';
  if (!doc.isAvailable) return doc.name + ' is not being served right now';
  if (doc.quantity <= 0) return doc.name + ' has just sold out';
  return 'Only ' + doc.quantity + ' left of ' + doc.name + ' (you asked for ' + wantedQty + ')';
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
    const { restaurantId, items, instructions, paymentMethod, parcel } = req.body;

    if (!mongoose.isValidObjectId(restaurantId)) {
      return res.status(400).json({ error: 'Invalid restaurant' });
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
      return res.status(400).json({ error: 'Add 1 to 30 items to the order' });
    }

    if (paymentMethod === 'cash') {
      return res.status(400).json({ error: 'Cash is not accepted. Pay online or use your wallet.' });
    }
    if (!ALLOWED_PAYMENTS.includes(paymentMethod)) {
      return res.status(400).json({ error: 'Choose online payment or wallet' });
    }
    const method = paymentMethod;

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

    // Special instructions only make sense at the live food counter
    let note = '';
    if (restaurant.liveCounter) {
      note = String(instructions || '').trim();
      if (note.length > 200) {
        return res.status(400).json({ error: 'Special instructions can be at most 200 characters' });
      }
    }

    if (parcel && !restaurant.allowParcel) {
      return res.status(400).json({ error: 'Parcel is not available at this cart' });
    }
    const isParcel = !!(restaurant.allowParcel && parcel);
    const parcelFee = isParcel ? PARCEL_FEE : 0;

    const user = await User.findById(req.user.id);
    if (!user || !user.phone) {
      return res.status(400).json({ error: 'Add a phone number to your profile before ordering' });
    }

    // One unpaid online payment at a time, so abandoned payments cannot hold stock
    if (method === 'upi') {
      const earlier = await Order.find({
        userId: user._id,
        paymentMethod: 'upi',
        paymentStatus: 'pending',
        status: 'placed',
      });
      for (const old of earlier) {
        try {
          await settleOrCancel(old);
        } catch (e) {
          return res.status(409).json({
            error: 'You have an online payment in progress. Finish or cancel it first, then try again.',
          });
        }
      }
    }

    // Reserve stock. Each item is taken in one atomic step, so two customers can never get the same last unit.
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
        return res.status(400).json({ error: await soldOutMessage(menuItemId, restaurantId, qty) });
      }

      reserved.push({ menuItemId: item._id, quantity: qty });
      orderItems.push({
        menuItemId: item._id,
        name: item.name,
        price: item.price,
        quantity: qty,
        prepTimeMins: item.showTime ? item.prepTimeMins || 5 : 0,
      });
    }

    const itemsTotal = orderItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
    const total = itemsTotal + parcelFee;

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
          error: 'Not enough wallet balance. Add money at a cart counter or pay online.',
        });
      }
      charge = { userId: user._id, amount: total };
      balanceAfter = payer.walletBalance;
    }

    const queued = await activeQueue(restaurantId);
    const est = estimateFor(restaurant, queued, orderItems);

    const orderId = await makeOrderId();

    const order = await Order.create({
      orderId,
      userId: user._id,
      restaurantId,
      customerName: user.name,
      phone: user.phone,
      items: orderItems,
      instructions: note,
      isParcel,
      parcelFee,
      total,
      paymentMethod: method,
      paymentStatus: method === 'wallet' ? 'paid' : 'pending',
      paymentDueAt: method === 'upi' ? new Date(Date.now() + PAYMENT_WINDOW_MS) : undefined,
      estimatedWaitMins: est.mins,
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

// A manager's live queue (their own cart only). Online orders appear once they are paid.
router.get('/restaurant', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const orders = await Order.find({
      restaurantId: req.user.restaurantId,
      status: { $in: ['placed', 'preparing', 'ready'] },
      $or: [{ paymentMethod: { $ne: 'upi' } }, { paymentStatus: 'paid' }],
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
    if (order.paymentMethod === 'upi' && order.paymentStatus !== 'paid' && status !== 'cancelled') {
      return res.status(400).json({ error: 'Payment has not been received for this order yet' });
    }

    // Carts without a live counter hand over ready-made food, so they can skip "preparing"
    const cart = await Restaurant.findById(order.restaurantId).select('liveCounter');
    const allowed = [...NEXT_STATUS[order.status]];
    if (cart && !cart.liveCounter && order.status === 'placed') allowed.push('ready');

    if (!allowed.includes(status)) {
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
      await refundUpi(updated);
    }

    const fresh = await Order.findById(order._id);
    res.json(await withNames(fresh));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
