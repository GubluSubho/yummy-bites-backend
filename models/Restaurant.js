const mongoose = require('mongoose');

const restaurantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  location: { type: String },
  staffIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  cooksOnDuty: { type: Number, default: 2, min: 1 }
});

module.exports = mongoose.model('Restaurant', restaurantSchema);
