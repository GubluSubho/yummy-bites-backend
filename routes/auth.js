const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');
const { verifyFirebaseToken } = require('../utils/firebaseVerify');

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role, restaurantId: user.restaurantId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function profile(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    accountType: user.accountType,
    restaurantId: user.restaurantId,
  };
}

function userResponse(user) {
  return { token: signToken(user), ...profile(user) };
}

function cleanPhone(phone) {
  const p = String(phone || '').trim();
  return /^\d{10}$/.test(p) ? p : null;
}

// Customer sign-in through Firebase (email, Google, university email)
router.post('/firebase', async (req, res) => {
  try {
    const { idToken, name, phone } = req.body;
    if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 5000) {
      return res.status(400).json({ error: 'Missing sign-in token' });
    }

    let claims;
    try {
      claims = await verifyFirebaseToken(idToken);
    } catch (e) {
      if (e.message === 'Server is missing FIREBASE_PROJECT_ID') {
        return res.status(500).json({ error: e.message });
      }
      return res.status(401).json({ error: 'Invalid or expired sign-in token' });
    }

    if (!claims.email) return res.status(400).json({ error: 'This account has no email address' });
    if (claims.email_verified !== true) {
      return res.status(403).json({ error: 'Verify your email before continuing' });
    }

    const email = String(claims.email).trim().toLowerCase();

    let phoneValue = null;
    if (phone !== undefined && phone !== '') {
      phoneValue = cleanPhone(phone);
      if (!phoneValue) return res.status(400).json({ error: 'Enter a valid 10-digit phone number' });
    }

    let user = await User.findOne({ email });
    if (user && user.role !== 'customer') {
      return res.status(403).json({ error: 'Managers sign in from the manager login' });
    }

    if (!user) {
      const universityDomain = (process.env.UNIVERSITY_EMAIL_DOMAIN || '').toLowerCase();
      const isUniversity = universityDomain && email.endsWith('@' + universityDomain);
      const displayName = String(name || claims.name || email.split('@')[0]).trim().slice(0, 60);
      const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

      user = await User.create({
        name: displayName,
        email,
        password: unusablePassword,
        phone: phoneValue || undefined,
        role: 'customer',
        accountType: isUniversity ? 'university' : 'normal',
      });
    } else if (phoneValue && user.phone !== phoneValue) {
      user.phone = phoneValue;
      await user.save();
    }

    res.json(userResponse(user));
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Please try signing in again' });
    }
    res.status(400).json({ error: err.message });
  }
});

// Manager login (and any account that has a password)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(String(password), user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    res.json(userResponse(user));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Current user's profile
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(profile(user));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update name or phone
router.patch('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { name, phone } = req.body;

    if (name !== undefined) {
      const n = String(name).trim();
      if (!n || n.length > 60) {
        return res.status(400).json({ error: 'Name is required (max 60 characters)' });
      }
      user.name = n;
    }

    if (phone !== undefined) {
      const p = cleanPhone(phone);
      if (!p) return res.status(400).json({ error: 'Enter a valid 10-digit phone number' });
      user.phone = p;
    }

    await user.save();
    res.json(profile(user));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
