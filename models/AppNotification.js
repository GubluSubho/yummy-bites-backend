const mongoose = require('mongoose');

const appNotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['preparing', 'ready', 'completed', 'cancelled'], required: true },
  kind: { type: String, default: 'food' },
  title: { type: String, required: true },
  body: { type: String, required: true },
  orderId: { type: String, required: true },
  place: { type: String, default: '' },
  note: { type: String, default: '' },
  read: { type: Boolean, default: false },
  popupShown: { type: Boolean, default: false }
}, { timestamps: true });

appNotificationSchema.index({ userId: 1, createdAt: -1 });
appNotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model('AppNotification', appNotificationSchema);
