const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['topup', 'payment', 'refund'], required: true },
  amount: { type: Number, required: true, min: 1 },
  balanceAfter: { type: Number, required: true },
  orderId: { type: String },
  note: { type: String },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

walletTransactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
