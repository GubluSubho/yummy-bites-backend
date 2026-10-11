require('dotenv').config();
const mongoose = require('mongoose');
const MenuItem = require('../models/MenuItem');
const Restaurant = require('../models/Restaurant');

const prepByType = { Staple: 3, Side: 2, Veg: 6, 'Non-Veg': 8 };

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  for (const [type, mins] of Object.entries(prepByType)) {
    const r = await MenuItem.updateMany(
      { type, prepTimeMins: { $exists: false } },
      { $set: { prepTimeMins: mins } }
    );
    console.log(`${type}: ${r.modifiedCount} items set to ${mins} mins`);
  }

  const rest = await MenuItem.updateMany(
    { prepTimeMins: { $exists: false } },
    { $set: { prepTimeMins: 5 } }
  );
  console.log(`Other items: ${rest.modifiedCount} set to 5 mins`);

  const cooks = await Restaurant.updateMany(
    { cooksOnDuty: { $exists: false } },
    { $set: { cooksOnDuty: 2 } }
  );
  console.log(`Restaurants: ${cooks.modifiedCount} set to 2 cooks on duty`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.log('Error:', err.message);
  process.exit(1);
});
