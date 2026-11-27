const mongoose = require('mongoose');

const sizeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 24 },
  price: { type: Number, required: true, min: 1 },
  quantity: { type: Number, default: 0, min: 0 }
}, { _id: false });

const menuItemSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  name: { type: String, required: true },
  type: { type: String },
  subType: { type: String },
  price: { type: Number, required: true },
  isAvailable: { type: Boolean, default: true },
  quantity: { type: Number, default: 0, min: 0 },
  prepTimeMins: { type: Number, default: 5, min: 1 },
  showTime: { type: Boolean, default: false },
  hasImage: { type: Boolean, default: false },
  imageRev: { type: Number, default: 0 },
  sizes: { type: [sizeSchema], default: [] }
});

module.exports = mongoose.model('MenuItem', menuItemSchema);
