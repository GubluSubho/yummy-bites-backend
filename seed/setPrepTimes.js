require('dotenv').config();
const mongoose = require('mongoose');
const MenuItem = require('../models/MenuItem');

const prepByType = { Staple: 3, Side: 2, Veg: 6, 'Non-Veg': 8 };

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  for (const [type, mins] of Object.entries(prepByType)) {
    const r = await MenuItem.updateMany({ type }, { $set: { prepTimeMins: mins } });
    console.log(type + ': ' + r.modifiedCount + ' items set to ' + mins + ' mins');
  }
  await mongoose.disconnect();
}

run().catch((e) => { console.log('Error:', e.message); process.exit(1); });
