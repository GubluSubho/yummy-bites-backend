const crypto = require('crypto');
const Razorpay = require('razorpay');
const Order = require('../models/Order');
const { restoreStock } = require('./stock');

let client = null;

function razorpay() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Online payments are not set up on the server yet');
  }
  if (!client) {
    client = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  }
  return client;
}

function errorText(err) {
  return (err && err.error && err.error.description) || (err && err.message) || 'Payment service error';
}

function validSignature(razorpayOrderId, paymentId, signature) {
  if (typeof signature !== 'string') return false;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(razorpayOrderId + '|' + paymentId).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Ask Razorpay whether this order really received a payment of the right amount
async function capturedPayment(razorpayOrderId, amountPaise) {
  const rz = razorpay();
  const list = await rz.orders.fetchPayments(razorpayOrderId);
  for (const p of list.items || []) {
    if (p.amount !== amountPaise) continue;
    if (p.status === 'captured') return p;
    if (p.status === 'authorized') {
      try {
        const c = await rz.payments.capture(p.id, amountPaise, 'INR');
        if (c.status === 'captured') return c;
      } catch (e) {
        console.log('Capture failed:', errorText(e));
      }
    }
  }
  return null;
}

async function markPaid(order, paymentId) {
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, paymentStatus: 'pending' },
    { paymentStatus: 'paid', razorpayPaymentId: paymentId },
    { new: true }
  );
  return updated || (await Order.findById(order._id));
}

// Is the order paid? Marks it paid when Razorpay shows the money. Never cancels anything.
async function checkPaid(order) {
  if (order.paymentStatus === 'paid') return true;
  if (!order.razorpayOrderId) return false;
  const p = await capturedPayment(order.razorpayOrderId, Math.round(order.total * 100));
  if (!p) return false;
  await markPaid(order, p.id);
  return true;
}

async function ensureRazorpayOrder(order) {
  if (order.razorpayOrderId) return order.razorpayOrderId;
  const created = await razorpay().orders.create({
    amount: Math.round(order.total * 100),
    currency: 'INR',
    receipt: order.orderId,
    notes: { orderId: order.orderId },
  });
  await Order.updateOne({ _id: order._id }, { razorpayOrderId: created.id });
  return created.id;
}

// Start a UPI "intent" payment, which opens the customer's own UPI app. Returns the upi:// link.
async function createUpiIntent(order, user, req) {
  const orderId = await ensureRazorpayOrder(order);
  const phone = String(user.phone || '').replace(/\D/g, '').slice(-10);
  const res = await razorpay().payments.createUpi({
    amount: Math.round(order.total * 100),
    currency: 'INR',
    order_id: orderId,
    email: user.email,
    contact: '+91' + phone,
    method: 'upi',
    upi: { flow: 'intent' },
    ip: req.ip || '127.0.0.1',
    referer: req.get('origin') || 'https://yummy-bites-api.onrender.com',
    user_agent: req.get('user-agent') || 'YummyBites',
  });
  const steps = Array.isArray(res.next) ? res.next : [];
  const hit = steps.find((s) => s && typeof s.url === 'string' && /^(upi|intent):/i.test(s.url));
  const url = (hit && hit.url) || res.intent_url || res.link || '';
  if (!/^upi:/i.test(url)) throw new Error('Razorpay did not return a UPI link');
  return { url, paymentId: res.razorpay_payment_id };
}

async function cancelUnpaid(order) {
  const cancelled = await Order.findOneAndUpdate(
    { _id: order._id, paymentMethod: 'upi', paymentStatus: 'pending', status: 'placed' },
    { status: 'cancelled', paymentStatus: 'failed' },
    { new: true }
  );
  if (cancelled) await restoreStock(cancelled.items);
  return cancelled;
}

// If Razorpay shows a payment, mark the order paid. Otherwise cancel it and release the stock.
async function settleOrCancel(order) {
  if (order.razorpayOrderId) {
    const payment = await capturedPayment(order.razorpayOrderId, Math.round(order.total * 100));
    if (payment) return { paid: true, order: await markPaid(order, payment.id) };
  }
  const cancelled = await cancelUnpaid(order);
  return { paid: false, order: cancelled || (await Order.findById(order._id)) };
}

async function refundUpi(order) {
  if (order.paymentMethod !== 'upi' || order.paymentStatus !== 'paid' || !order.razorpayPaymentId) return;
  try {
    await razorpay().payments.refund(order.razorpayPaymentId, { amount: Math.round(order.total * 100) });
    await Order.updateOne({ _id: order._id, paymentStatus: 'paid' }, { paymentStatus: 'refunded' });
  } catch (e) {
    console.log('UPI refund failed for ' + order.orderId + ':', errorText(e));
  }
}

async function expireUnpaidOrders() {
  try {
    const stale = await Order.find({
      paymentMethod: 'upi', paymentStatus: 'pending', status: 'placed', paymentDueAt: { $lt: new Date() },
    }).limit(20);
    for (const order of stale) {
      try { await settleOrCancel(order); } catch (e) { console.log('Expiry check failed for ' + order.orderId + ':', errorText(e)); }
    }
  } catch (e) {
    console.log('Expiry job failed:', e.message);
  }
}

module.exports = {
  razorpay, errorText, validSignature, settleOrCancel, markPaid, refundUpi, expireUnpaidOrders,
  checkPaid, ensureRazorpayOrder, createUpiIntent,
};
