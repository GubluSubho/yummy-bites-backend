require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');

async function seedManager() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const restaurant = await Restaurant.findOne({ name: "Jumbo" });
    if (!restaurant) {
      console.log('❌ Jumbo restaurant not found — run seedjumbo.js first');
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash("Manager123", 10);

    const manager = await User.create({
      name: "Jumbo Manager",
      email: "jumbo.manager@test.com",
      password: hashedPassword,
      role: "manager",
      restaurantId: restaurant._id
    });

    restaurant.staffIds.push(manager._id);
    await restaurant.save();

    console.log('✅ Manager created:', manager.email);
    console.log('✅ Password: Manager123');
    console.log('✅ Linked to restaurant:', restaurant.name);

    process.exit();
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

seedManager();