const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  name: { type: String, required: true },
  type: { type: String },
  price: { type: Number, required: true },
  isAvailable: { type: Boolean, default: true },
  quantity: { type: Number, default: 0 },
  prepTimeMins: { type: Number, default: 5, min: 1 }
});

module.exports = mongoose.model('MenuItem', menuItemSchema);
