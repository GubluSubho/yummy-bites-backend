const crypto = require('crypto');
const Razorpay = require('razorpay');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');

let client = null;

function razorpay() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Online payments are not set up on the server yet');
  }
  if (!client) {
    client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return client;
}

function errorText(err) {
  return (err && err.error && err.error.description) || (err && err.message) || 'Payment service error';
}

function validSignature(razorpayOrderId, paymentId, signature) {
  if (typeof signature !== 'string') return false;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(razorpayOrderId + '|' + paymentId)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function restoreStock(items) {
  for (const it of items) {
    await MenuItem.updateOne({ _id: it.menuItemId }, { $inc: { quantity: it.quantity } });
  }
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

// Give the money back when a cart cancels a paid UPI order
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
      paymentMethod: 'upi',
      paymentStatus: 'pending',
      status: 'placed',
      paymentDueAt: { $lt: new Date() },
    }).limit(20);

    for (const order of stale) {
      try {
        await settleOrCancel(order);
      } catch (e) {
        console.log('Expiry check failed for ' + order.orderId + ':', errorText(e));
      }
    }
  } catch (e) {
    console.log('Expiry job failed:', e.message);
  }
}

module.exports = {
  razorpay,
  errorText,
  validSignature,
  settleOrCancel,
  markPaid,
  refundUpi,
  expireUnpaidOrders,
};
