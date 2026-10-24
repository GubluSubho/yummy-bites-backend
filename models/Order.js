const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  prepTimeMins: { type: Number, required: true }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  customerName: { type: String, required: true },
  phone: { type: String, required: true },
  items: { type: [orderItemSchema], required: true },
  instructions: { type: String, default: '', maxlength: 200 },
  isParcel: { type: Boolean, default: false },
  parcelFee: { type: Number, default: 0, min: 0 },
  total: { type: Number, required: true },
  paymentMethod: { type: String, enum: ['upi', 'wallet', 'cash'], default: 'upi' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  paymentDueAt: { type: Date },
  razorpayOrderId: { type: String },
  razorpayPaymentId: { type: String },
  status: { type: String, enum: ['placed', 'preparing', 'ready', 'completed', 'cancelled'], default: 'placed' },
  estimatedWaitMins: { type: Number, required: true, min: 0 }
}, { timestamps: true });

orderSchema.index({ restaurantId: 1, status: 1 });

module.exports = mongoose.model('Order', orderSchema);
