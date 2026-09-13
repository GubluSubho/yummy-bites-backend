require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');

// Update the "name" values below if they don't match exactly what's in your
// Restaurant documents (check MongoDB Atlas if unsure).
const managersToCreate = [
  {
    restaurantName: "Canteen",
    managerName: "Canteen Manager",
    email: "canteen.manager@test.com",
    password: "Manager123"
  },
  {
    restaurantName: "Xpress (Café Coffee Day)",
    managerName: "Xpress Manager",
    email: "xpress.manager@test.com",
    password: "Manager123"
  },
  {
    restaurantName: "Panda Junction",
    managerName: "Panda Junction Manager",
    email: "pandajunction.manager@test.com",
    password: "Manager123"
  }
];

async function seedManagers() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    for (const entry of managersToCreate) {
      const restaurant = await Restaurant.findOne({ name: entry.restaurantName });

      if (!restaurant) {
        console.log(`❌ Restaurant "${entry.restaurantName}" not found — skipping ${entry.email}`);
        continue;
      }

      const existing = await User.findOne({ email: entry.email });
      if (existing) {
        console.log(`⚠️  ${entry.email} already exists — skipping`);
        continue;
      }

      const hashedPassword = await bcrypt.hash(entry.password, 10);

      const manager = await User.create({
        name: entry.managerName,
        email: entry.email,
        password: hashedPassword,
        role: "manager",
        restaurantId: restaurant._id
      });

      restaurant.staffIds.push(manager._id);
      await restaurant.save();

      console.log(`✅ Manager created: ${manager.email} (password: ${entry.password}) -> linked to ${restaurant.name}`);
    }

    console.log('🎉 Done seeding remaining managers');
    process.exit();
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

seedManagers();