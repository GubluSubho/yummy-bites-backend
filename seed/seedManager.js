require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');

async function seedManager() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find the Nescafe restaurant (already created earlier)
    const restaurant = await Restaurant.findOne({ name: "Nescafe" });
    if (!restaurant) {
      console.log('❌ Nescafe restaurant not found — run seedNescafe.js first');
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash("Manager123", 10);

    const manager = await User.create({
      name: "Nescafe Manager",
      email: "nescafe.manager@test.com",
      password: hashedPassword,
      role: "manager",
      restaurantId: restaurant._id
    });

    // Link manager to restaurant's staffIds
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