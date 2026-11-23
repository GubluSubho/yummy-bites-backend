const mongoose = require('mongoose');

const itemImageSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true, unique: true },
  data: { type: Buffer, required: true },
  contentType: { type: String, default: 'image/jpeg' }
}, { timestamps: true });

module.exports = mongoose.model('ItemImage', itemImageSchema);
