const express = require('express');
const router = express.Router();
const PushToken = require('../models/PushToken');
const { verifyToken } = require('../middleware/auth');
const { sendToUser, getReceipts, sleep } = require('../utils/push');

const TOKEN_FORMAT = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,}\]$/;

// Remember this phone for notifications. A phone belongs to whoever logged in last.
router.post('/register', verifyToken, async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    if (!TOKEN_FORMAT.test(token)) {
      return res.status(400).json({ error: 'Invalid notification token' });
    }
    await PushToken.findOneAndUpdate(
      { token },
      { userId: req.user.id, platform: String(req.body.platform || 'android').slice(0, 20) },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Stop notifications for this phone (called when the user logs out)
router.post('/unregister', verifyToken, async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    await PushToken.deleteOne({ token, userId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// How many phones are registered for this account
router.get('/status', verifyToken, async (req, res) => {
  try {
    const devices = await PushToken.countDocuments({ userId: req.user.id });
    res.json({ devices });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Send a test notification to this account's phones and report what Expo and Google answered
router.post('/test', verifyToken, async (req, res) => {
  try {
    const result = await sendToUser(req.user.id, {
      title: 'Test from Yummy Bites',
      body: 'If you can read this, notifications work.',
      data: { type: 'test' },
    });
    if (result.devices === 0) return res.json({ devices: 0, tickets: [], receipts: [] });

    const clean = (x) => ({ status: x.status, error: x.details && x.details.error, message: x.message });
    const ids = result.tickets.filter((t) => t.status === 'ok' && t.id).map((t) => t.id);

    let receipts = [];
    if (ids.length > 0) {
      await sleep(5000);
      const map = await getReceipts(ids);
      receipts = ids.map((id) => (map[id] ? clean(map[id]) : { status: 'pending' }));
    }
    res.json({ devices: result.devices, tickets: result.tickets.map(clean), receipts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
