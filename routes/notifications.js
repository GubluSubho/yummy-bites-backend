const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const AppNotification = require('../models/AppNotification');
const Order = require('../models/Order');
const { verifyToken, requireRole } = require('../middleware/auth');

// A "your food is ready" popup is only worth showing while it is fresh
const POPUP_WINDOW_MS = 30 * 60 * 1000;
const customerOnly = [verifyToken, requireRole('customer')];

// The bell list
router.get('/', customerOnly, async (req, res) => {
  try {
    const items = await AppNotification.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('type title body orderId place note read createdAt');
    const unread = await AppNotification.countDocuments({ userId: req.user.id, read: false });
    res.json({ items, unread });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Popups still waiting to be shown. Each one is handed out exactly once, however many times the app restarts.
router.get('/popups', customerOnly, async (req, res) => {
  try {
    const pending = await AppNotification.find({ userId: req.user.id, popupShown: false })
      .sort({ createdAt: 1 })
      .limit(10);

    const popups = [];
    for (const n of pending) {
      const claimed = await AppNotification.findOneAndUpdate(
        { _id: n._id, popupShown: false },
        { popupShown: true },
        { new: true }
      );
      if (!claimed) continue;
      if (Date.now() - new Date(claimed.createdAt).getTime() > POPUP_WINDOW_MS) continue;
      popups.push({
        id: String(claimed._id),
        type: claimed.type,
        orderId: claimed.orderId,
        place: claimed.place,
        note: claimed.note,
      });
    }

    const active = await Order.countDocuments({
      userId: req.user.id,
      status: { $in: ['placed', 'preparing', 'ready'] },
      $or: [{ paymentMethod: { $ne: 'upi' } }, { paymentStatus: 'paid' }],
    });

    res.json({ popups, active });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/read-all', customerOnly, async (req, res) => {
  try {
    await AppNotification.updateMany({ userId: req.user.id, read: false }, { read: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/read', customerOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid notification' });
    await AppNotification.updateOne({ _id: req.params.id, userId: req.user.id }, { read: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', customerOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid notification' });
    await AppNotification.deleteOne({ _id: req.params.id, userId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Clear everything
router.delete('/', customerOnly, async (req, res) => {
  try {
    await AppNotification.deleteMany({ userId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
