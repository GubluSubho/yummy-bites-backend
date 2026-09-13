require('dotenv').config();
const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');

const menuData = [
  { name: "Rice", type: "Staple", price: 15 },
  { name: "Dal", type: "Staple", price: 15 },
  { name: "Seasonal Veg", type: "Veg", price: 20 },
  { name: "Chicken", type: "Non-Veg", price: 50 },
  { name: "Fish", type: "Non-Veg", price: 50 },
  { name: "Egg", type: "Non-Veg", price: 15 },
  { name: "Paneer", type: "Veg", price: 40 },
  { name: "Jhinge Aloo Posto", type: "Veg", price: 25 },
  { name: "Veg Moong Dal", type: "Veg", price: 20 },
  { name: "Echor Dalna", type: "Veg", price: 25 },
  { name: "Chutney", type: "Side", price: 10 },
  { name: "Papad", type: "Side", price: 5 },
  { name: "Chorchori", type: "Veg", price: 25 },
  { name: "Mix Bhaja", type: "Veg", price: 25 },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const restaurant = await Restaurant.create({
      name: "Canteen",
      location: "Adamas University",
      staffIds: []
    });
    console.log('✅ Restaurant created:', restaurant._id);

    const itemsWithRestaurant = menuData.map(item => ({
      ...item,
      restaurantId: restaurant._id,
      isAvailable: true,
      quantity: 30
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