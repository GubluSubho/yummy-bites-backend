const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const User = require('../models/User');
const OtpCode = require('../models/OtpCode');
const otp = require('../utils/otp');

router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  })
);

const shape = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  accountType: u.accountType,
  restaurantId: u.restaurantId ? String(u.restaurantId) : undefined,
});

const tokenFor = (u) =>
  jwt.sign(
    { id: String(u._id), role: u.role, restaurantId: u.restaurantId ? String(u.restaurantId) : undefined },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

// Ask for a code
router.post('/send', async (req, res) => {
  try {
    const phone = otp.normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
    if (!otp.available()) return res.status(503).json({ error: 'Phone login is not available right now. Use email instead.' });

    const now = new Date();
    const doc = await OtpCode.findOne({ phone });
    if (doc && doc.lastSentAt && now - doc.lastSentAt < 30000) {
      return res.status(429).json({ error: 'Please wait a few seconds before asking for another code.' });
    }
    const inWindow = doc && doc.windowStart && now - doc.windowStart < 3600000;
    const count = inWindow ? doc.sendCount : 0;
    if (count >= 5) return res.status(429).json({ error: 'Too many codes requested. Try again in an hour.' });

    const code = otp.isManaged() ? null : otp.newCode();
    let result;
    try {
      result = await otp.send(phone, code);
    } catch (e) {
      console.log('OTP send failed:', e.message);
      return res.status(502).json({ error: 'Could not send the code. Please try again.' });
    }

    await OtpCode.findOneAndUpdate(
      { phone },
      {
        $set: {
          codeHash: code ? otp.hashCode(phone, code) : null,
          codeExpiresAt: new Date(now.getTime() + 5 * 60000),
          attempts: 0,
          lastSentAt: now,
          windowStart: inWindow ? doc.windowStart : now,
          sendCount: count + 1,
          expiresAt: new Date(now.getTime() + 3600000),
        },
      },
      { upsert: true }
    );
    res.json({ sent: true, resendIn: 30, devCode: result.devCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check the code, then log in or create the account
router.post('/verify', async (req, res) => {
  try {
    const phone = otp.normalizePhone(req.body.phone);
    const code = String(req.body.code || '').trim();
    const mode = req.body.mode === 'signup' ? 'signup' : 'login';
    const name = String(req.body.name || '').trim().slice(0, 60);
    if (!phone || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code' });

    const doc = await OtpCode.findOne({ phone });
    if (!doc || (!otp.isManaged() && !doc.codeHash)) return res.status(400).json({ error: 'Ask for a new code first.' });
    if (doc.attempts >= 5) return res.status(429).json({ error: 'Too many wrong codes. Ask for a new code.' });
    if (!doc.codeExpiresAt || new Date() > doc.codeExpiresAt) return res.status(400).json({ error: 'That code has expired. Ask for a new one.' });

    let ok = false;
    if (otp.isManaged()) {
      ok = await otp.checkManaged(phone, code);
    } else {
      const a = Buffer.from(otp.hashCode(phone, code));
      const b = Buffer.from(doc.codeHash);
      ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (!ok) {
      await OtpCode.updateOne({ phone }, { $inc: { attempts: 1 } });
      return res.status(400).json({ error: 'Wrong code. Please check and try again.' });
    }
    await OtpCode.updateOne({ phone }, { $set: { codeHash: null, attempts: 0, codeExpiresAt: new Date(0) } });

    // Phone accounts are kept apart from email accounts, because email sign-ups never proved their phone number
    const email = '91' + phone + '@phone.yummybites.app';
    let user = await User.findOne({ email });
    let isNew = false;
    if (!user) {
      if (mode === 'login') return res.status(404).json({ error: 'No account found for this number. Please sign up first.' });
      if (name.length < 2) return res.status(400).json({ error: 'Enter your name to create the account' });
      try {
        user = await User.create({
          name,
          email,
          password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
          phone,
          role: 'customer',
          accountType: 'normal',
          authProvider: 'phone',
          phoneVerified: true,
        });
        isNew = true;
      } catch (e) {
        if (e.code === 11000) user = await User.findOne({ email });
        else throw e;
      }
    }
    if (!user || user.role !== 'customer') return res.status(403).json({ error: 'This number cannot be used to log in here.' });

    res.json({ token: tokenFor(user), ...shape(user), isNew });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
