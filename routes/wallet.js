const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const { verifyToken, requireRole } = require('../middleware/auth');

const CODE_PREFIX = 'YB-WALLET:';
const MAX_TOPUP = 2000;

function hashPayload(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// A scanned code is either a wallet QR from the app or a linked university ID card QR
function customerFilter(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length > 300) return null;

  const match = /^YB-WALLET:([a-f0-9]{24})$/i.exec(text);
  if (match) return { filter: { _id: match[1], role: 'customer' }, via: 'wallet' };

  return { filter: { idCardHash: hashPayload(text), role: 'customer' }, via: 'idcard' };
}

const NOT_FOUND =
  'No wallet found for this QR code. The student can show their wallet QR, or link their ID card first.';

// Customer: balance, wallet QR code and recent history
router.get('/', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('walletBalance idCardHash');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const transactions = await WalletTransaction.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(30)
      .select('type amount balanceAfter orderId note createdAt');

    res.json({
      balance: user.walletBalance || 0,
      code: CODE_PREFIX + user._id,
      idLinked: !!user.idCardHash,
      transactions,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Customer: link a university ID card QR to this account
router.post('/link-id', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const text = String(req.body.payload || '').trim();
    if (text.length < 4 || text.length > 300) {
      return res.status(400).json({ error: 'This does not look like an ID card QR code' });
    }
    if (text.toUpperCase().startsWith(CODE_PREFIX)) {
      return res.status(400).json({ error: 'That is your wallet QR, not your university ID card' });
    }

    const hash = hashPayload(text);
    const taken = await User.findOne({ idCardHash: hash, _id: { $ne: req.user.id } }).select('_id');
    if (taken) {
      return res.status(409).json({ error: 'This ID card is already linked to another account' });
    }

    await User.updateOne({ _id: req.user.id }, { $set: { idCardHash: hash } });
    res.json({ linked: true });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This ID card is already linked to another account' });
    }
    res.status(400).json({ error: err.message });
  }
});

// Customer: unlink the ID card
router.delete('/link-id', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    await User.updateOne({ _id: req.user.id }, { $unset: { idCardHash: '' } });
    res.json({ linked: false });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: who does this scanned code belong to (shown before confirming a top-up)
router.get('/lookup', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const target = customerFilter(req.query.code);
    if (!target) return res.status(400).json({ error: NOT_FOUND });

    const user = await User.findOne(target.filter).select('name');
    if (!user) return res.status(404).json({ error: NOT_FOUND });

    res.json({ name: user.name, via: target.via });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manager: add money to a customer's wallet after taking cash at the counter
router.post('/topup', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const target = customerFilter(req.body.code);
    if (!target) return res.status(400).json({ error: NOT_FOUND });

    const amount = Number(req.body.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_TOPUP) {
      return res.status(400).json({ error: 'Enter a whole amount from 1 to ' + MAX_TOPUP });
    }

    const user = await User.findOneAndUpdate(target.filter, { $inc: { walletBalance: amount } }, { new: true }).select(
      'name walletBalance'
    );
    if (!user) return res.status(404).json({ error: NOT_FOUND });

    try {
      await WalletTransaction.create({
        userId: user._id,
        type: 'topup',
        amount,
        balanceAfter: user.walletBalance,
        note: 'Cash top-up at cart counter',
        restaurantId: req.user.restaurantId,
        managerId: req.user.id,
      });
    } catch (e) {
      console.log('Wallet log failed:', e.message);
    }

    res.json({ name: user.name, added: amount, balance: user.walletBalance });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
