const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const router = express.Router();
const PrintFile = require('../models/PrintFile');
const { verifyToken, requireRole } = require('../middleware/auth');

const sign = (fileId, exp) => crypto.createHmac('sha256', String(process.env.JWT_SECRET || '')).update(fileId + '.' + exp).digest('hex');

// A short-lived link so a customer can look at the file they uploaded before paying
router.get('/my-link/:fileId', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.fileId)) return res.status(404).json({ error: 'File not found' });
    const f = await PrintFile.findOne({ _id: req.params.fileId, userId: req.user.id }).select('name');
    if (!f) return res.status(404).json({ error: 'File not found' });
    const id = String(f._id);
    const exp = Date.now() + 10 * 60 * 1000;
    res.json({ url: req.protocol + '://' + req.get('host') + '/api/print/file/' + id + '?exp=' + exp + '&sig=' + sign(id, exp), name: f.name });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
