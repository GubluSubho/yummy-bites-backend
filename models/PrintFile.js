const mongoose = require('mongoose');

const printFileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  mime: { type: String },
  size: { type: Number },
  pages: { type: Number },
  pagesExact: { type: Boolean, default: false },
  data: { type: Buffer, required: true }
}, { timestamps: true });

// Uploaded files are deleted after 14 days
printFileSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });

module.exports = mongoose.model('PrintFile', printFileSchema);
