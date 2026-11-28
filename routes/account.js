const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Order = require('../models/Order');
const PrintFile = require('../models/PrintFile');
const PushToken = require('../models/PushToken');
const AppNotification = require('../models/AppNotification');
const WalletTransaction = require('../models/WalletTransaction');
const { verifyToken, requireRole } = require('../middleware/auth');
const { settleOrCancel } = require('../utils/payments');

// Delete the customer's account and personal data.
// Order records stay with the name and phone removed, so each cart's sales totals stay correct.
router.delete('/', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    if (!req.body || req.body.confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Account not found' });

    const active = await Order.countDocuments({
      userId: user._id,
      status: { $in: ['placed', 'preparing', 'ready'] },
      $or: [{ paymentMethod: { $ne: 'upi' } }, { paymentStatus: 'paid' }],
    });
    if (active > 0) {
      return res.status(409).json({ error: 'You have an order in progress. Collect it or wait for it to finish, then delete your account.' });
    }
    if ((user.walletBalance || 0) > 0 && req.body.forfeitWallet !== true) {
      return res.status(409).json({ error: 'wallet', balance: user.walletBalance });
    }

    // Release anything still waiting for payment
    const pending = await Order.find({ userId: user._id, paymentMethod: 'upi', paymentStatus: 'pending', status: 'placed' });
    for (const o of pending) {
      try { await settleOrCancel(o); } catch (e) { /* the expiry job will clean it up */ }
    }

    await Promise.all([
      WalletTransaction.deleteMany({ userId: user._id }),
      PushToken.deleteMany({ userId: user._id }),
      AppNotification.deleteMany({ userId: user._id }),
      PrintFile.deleteMany({ userId: user._id }),
      Order.updateMany({ userId: user._id }, { $set: { customerName: 'Deleted user', phone: '0000000000' } }),
    ]);
    await User.deleteOne({ _id: user._id });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
