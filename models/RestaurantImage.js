const mongoose = require('mongoose');

const restaurantImageSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, unique: true },
  data: { type: Buffer, required: true },
  contentType: { type: String, default: 'image/jpeg' }
}, { timestamps: true });

module.exports = mongoose.model('RestaurantImage', restaurantImageSchema);
