require('dotenv').config();
const mongoose = require('mongoose');
const MenuItem = require('../models/MenuItem');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const r = await MenuItem.updateMany(
    { $or: [{ quantity: { $lte: 0 } }, { quantity: { $exists: false } }] },
    { $set: { quantity: 30, isAvailable: true } }
  );
  console.log('Stock set to 30 for ' + r.modifiedCount + ' items');
  await mongoose.disconnect();
}

run().catch((e) => { console.log('Error:', e.message); process.exit(1); });
