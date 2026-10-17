const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  phone: { type: String },
  role: { type: String, enum: ['customer', 'manager'], default: 'customer' },
  accountType: { type: String, enum: ['normal', 'university'], default: 'normal' },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' },
  walletBalance: { type: Number, default: 0, min: 0 },
  idCardHash: { type: String, unique: true, sparse: true }
});

module.exports = mongoose.model('User', userSchema);
