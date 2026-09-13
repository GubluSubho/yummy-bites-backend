require('dotenv').config();
const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');

const menuData = [
  // Beverages
  { name: "Tea", type: "Beverage", price: 10 },
  { name: "Water Bottle", type: "Beverage", price: 20 },
  { name: "Cold Drinks", type: "Beverage", price: 30 },

  // Breakfast / Snacks
  { name: "Boiled Egg", type: "Breakfast", price: 15 },
  { name: "Idli", type: "Breakfast", price: 20 },
  { name: "Vada", type: "Breakfast", price: 20 },
  { name: "Vegetable Chop", type: "Breakfast", price: 15 },
  { name: "Samosa Bread Ghugni", type: "Breakfast", price: 25 },

  // Chicken & Rice Combos
  { name: "Rice Chicken Combo", type: "Combo", price: 60 },
  { name: "Break Chicken Stoo", type: "Combo", price: 50 },
  { name: "Biriyani Chicken Combo", type: "Combo", price: 80 },
  { name: "Polau Chicken Combo", type: "Combo", price: 70 },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const restaurant = await Restaurant.create({
      name: "Panda Junction",
      location: "Adamas University",
      staffIds: []
    });
    console.log('✅ Restaurant created:', restaurant._id);

    const itemsWithRestaurant = menuData.map(item => ({
      ...item,
      restaurantId: restaurant._id,
      isAvailable: true,
      quantity: 25
    }));

    await MenuItem.insertMany(itemsWithRestaurant);
    console.log(`✅ Inserted ${itemsWithRestaurant.length} menu items`);

    process.exit();
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

seed();