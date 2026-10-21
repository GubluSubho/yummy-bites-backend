const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const { verifyToken, requireRole } = require('../middleware/auth');
const { razorpay, errorText, validSignature, settleOrCancel, markPaid } = require('../utils/payments');

async function ownOrder(req, res) {
  const order = await Order.findOne({ orderId: String(req.body.orderId || '').toUpperCase() });
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return null;
  }
  if (String(order.userId) !== String(req.user.id)) {
    res.status(403).json({ error: 'Not your order' });
    return null;
  }
  return order;
}

// Create the Razorpay payment for a pending UPI order
router.post('/start', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;

    if (order.paymentMethod !== 'upi' || order.paymentStatus !== 'pending' || order.status !== 'placed') {
      return res.status(400).json({ error: 'This order does not need an online payment' });
    }
    if (order.paymentDueAt && order.paymentDueAt < new Date()) {
      return res.status(400).json({ error: 'This order expired. Please place it again.' });
    }

    const rz = razorpay();
    const amount = Math.round(order.total * 100);

    let razorpayOrderId = order.razorpayOrderId;
    if (!razorpayOrderId) {
      const created = await rz.orders.create({
        amount,
        currency: 'INR',
        receipt: order.orderId,
        notes: { orderId: order.orderId },
      });
      razorpayOrderId = created.id;
      await Order.updateOne({ _id: order._id }, { razorpayOrderId });
    }

    const user = await User.findById(req.user.id).select('name email phone');
    res.json({
      keyId: process.env.RAZORPAY_KEY_ID,
      razorpayOrderId,
      amount,
      name: user ? user.name : '',
      email: user ? user.email : '',
      contact: user ? user.phone : '',
    });
  } catch (err) {
    res.status(500).json({ error: errorText(err) });
  }
});

// Confirm a payment after checkout: the signature and the amount must both check out
router.post('/verify', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;

    const { razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;
    const rz = razorpay();
    const amount = Math.round(order.total * 100);

    if (!order.razorpayOrderId || order.razorpayOrderId !== razorpayOrderId) {
      return res.status(400).json({ error: 'This payment does not match the order' });
    }
    if (typeof razorpayPaymentId !== 'string' || !validSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
      return res.status(400).json({ error: 'The payment could not be verified' });
    }

    if (order.paymentStatus === 'paid') return res.json(order);

    if (order.paymentStatus !== 'pending' || order.status !== 'placed') {
      try {
        await rz.payments.refund(razorpayPaymentId, { amount });
      } catch (e) {
        console.log('Late payment refund failed:', errorText(e));
      }
      return res.status(409).json({ error: 'This order had already expired. Your payment is being refunded.' });
    }

    const payment = await rz.payments.fetch(razorpayPaymentId);
    if (
      payment.order_id !== razorpayOrderId ||
      payment.amount !== amount ||
      !['captured', 'authorized'].includes(payment.status)
    ) {
      return res.status(400).json({ error: 'The payment is not complete' });
    }
    if (payment.status === 'authorized') {
      await rz.payments.capture(razorpayPaymentId, amount, 'INR');
    }

    res.json(await markPaid(order, razorpayPaymentId));
  } catch (err) {
    res.status(500).json({ error: errorText(err) });
  }
});

// The customer left checkout. If money did arrive, keep the order. Otherwise cancel it and release the stock.
router.post('/abandon', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;

    if (order.paymentMethod !== 'upi') {
      return res.status(400).json({ error: 'This order was not an online payment' });
    }
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
