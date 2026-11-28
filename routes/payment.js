const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const { verifyToken, requireRole } = require('../middleware/auth');
const {
  razorpay, errorText, validSignature, settleOrCancel, markPaid, checkPaid, ensureRazorpayOrder, createUpiIntent,
} = require('../utils/payments');

async function ownOrder(req, res) {
  const order = await Order.findOne({ orderId: String(req.body.orderId || '').toUpperCase() });
  if (!order) { res.status(404).json({ error: 'Order not found' }); return null; }
  if (String(order.userId) !== String(req.user.id)) { res.status(403).json({ error: 'Not your order' }); return null; }
  return order;
}

const needsPayment = (o) => o.paymentMethod === 'upi' && o.paymentStatus === 'pending' && o.status === 'placed';

// Create the Razorpay payment for a pending online order (card, net banking, wallets)
router.post('/start', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;
    if (!needsPayment(order)) return res.status(400).json({ error: 'This order does not need an online payment' });
    if (order.paymentDueAt && order.paymentDueAt < new Date()) return res.status(400).json({ error: 'This order expired. Please place it again.' });

    const razorpayOrderId = await ensureRazorpayOrder(order);
    const user = await User.findById(req.user.id).select('name email phone');
    res.json({
      keyId: process.env.RAZORPAY_KEY_ID,
      razorpayOrderId,
      amount: Math.round(order.total * 100),
      name: user ? user.name : '',
      email: user ? user.email : '',
      contact: user ? user.phone : '',
    });
  } catch (err) {
    res.status(500).json({ error: errorText(err) });
  }
});

// Pay with an installed UPI app: returns the link the app opens
router.post('/upi-intent', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;
    if (!needsPayment(order)) return res.status(400).json({ error: 'This order does not need a payment' });
    if (order.paymentDueAt && order.paymentDueAt < new Date()) return res.status(400).json({ error: 'This order expired. Please place it again.' });

    const user = await User.findById(req.user.id).select('email phone');
    try {
      const { url } = await createUpiIntent(order, user, req);
      res.json({ intentUrl: url, dueAt: order.paymentDueAt });
    } catch (e) {
      console.log('UPI intent failed:', errorText(e));
      res.status(422).json({ error: 'UPI app payment is not available yet. Please pay with card, net banking or your wallet.', detail: errorText(e) });
    }
  } catch (err) {
    res.status(500).json({ error: errorText(err) });
  }
});

// Has the payment gone through? Used while the customer is in their UPI app.
router.post('/status', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;
    if (order.status === 'cancelled') return res.json({ paid: false, expired: true });
    const paid = await checkPaid(order);
    const expired = !paid && !!order.paymentDueAt && order.paymentDueAt < new Date();
    res.json({ paid, expired });
  } catch (err) {
    res.status(500).json({ error: errorText(err) });
  }
});

// Confirm a card / net banking payment: the signature and the amount must both check out
router.post('/verify', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;

    const { razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;
    const rz = razorpay();
    const amount = Math.round(order.total * 100);

    if (!order.razorpayOrderId || order.razorpayOrderId !== razorpayOrderId) return res.status(400).json({ error: 'This payment does not match the order' });
    if (typeof razorpayPaymentId !== 'string' || !validSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
      return res.status(400).json({ error: 'The payment could not be verified' });
    }
    if (order.paymentStatus === 'paid') return res.json(order);

    if (order.paymentStatus !== 'pending' || order.status !== 'placed') {
      try { await rz.payments.refund(razorpayPaymentId, { amount }); } catch (e) { console.log('Late payment refund failed:', errorText(e)); }
      return res.status(409).json({ error: 'This order had already expired. Your payment is being refunded.' });
    }

    const payment = await rz.payments.fetch(razorpayPaymentId);
    if (payment.order_id !== razorpayOrderId || payment.amount !== amount || !['captured', 'authorized'].includes(payment.status)) {
      return res.status(400).json({ error: 'The payment is not complete' });
    }
    if (payment.status === 'authorized') await rz.payments.capture(razorpayPaymentId, amount, 'INR');

    res.json(await markPaid(order, razorpayPaymentId));
  } catch (err) {
    res.status(500).json({ error: errorText(err) });
  }
});

// The customer left the payment. If money did arrive, keep the order. Otherwise cancel it and release the stock.
router.post('/abandon', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;
    if (order.paymentMethod !== 'upi') return res.status(400).json({ error: 'This order was not an online payment' });
    if (order.paymentStatus === 'paid') return res.json({ paid: true });
    if (order.status === 'cancelled') return res.json({ paid: false });

    try {
      const result = await settleOrCancel(order);
      res.json({ paid: result.paid });
    } catch (e) {
      console.log('Abandon check failed:', errorText(e));
      res.status(502).json({ error: 'Could not confirm the payment status. Please try again in a moment.' });
    }
  } catch (err) {
    res.status(500).json({ error: errorText(err) });
  }
});

module.exports = router;
