const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  codeHash: { type: String },
  codeExpiresAt: { type: Date },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date },
  windowStart: { type: Date },
  sendCount: { type: Number, default: 0 },
  expiresAt: { type: Date }
});

// The record disappears an hour after the last code was asked for
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpCode', otpSchema);
