const express = require('express');
const router = express.Router();
const PushToken = require('../models/PushToken');
const { verifyToken } = require('../middleware/auth');

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

module.exports = router;
