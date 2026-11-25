const mongoose = require('mongoose');

const bindingSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  base: { type: Number, required: true, min: 0 },
  perPage: { type: Number, required: true, min: 0 }
}, { _id: false });

const printConfigSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, unique: true },
  bwPerPage: { type: Number, default: 5 },
  colorPerPage: { type: Number, default: 10 },
  laminationPerPage: { type: Number, default: 15 },
  binding: { type: [bindingSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('PrintConfig', printConfigSchema);
