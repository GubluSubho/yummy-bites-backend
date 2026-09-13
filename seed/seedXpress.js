require('dotenv').config();
const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');

const menuData = [
  // Hot Beverages - items with both Small and Regular
  { name: "Black Coffee (Espresso/Americano) - Small", type: "Hot Beverage", price: 35 },
  { name: "Black Coffee (Espresso/Americano) - Regular", type: "Hot Beverage", price: 50 },
  { name: "Cappuccino - Small", type: "Hot Beverage", price: 35 },
  { name: "Cappuccino - Regular", type: "Hot Beverage", price: 50 },
  { name: "Flavoured Cappuccino (Hazelnut/Caramel) - Small", type: "Hot Beverage", price: 45 },
  { name: "Flavoured Cappuccino (Hazelnut/Caramel) - Regular", type: "Hot Beverage", price: 75 },
  { name: "Chai (Masala/Ginger/Cardamom) - Small", type: "Hot Beverage", price: 40 },
  { name: "Chai (Masala/Ginger/Cardamom) - Regular", type: "Hot Beverage", price: 50 },
  { name: "Garam Chai/Lemon Tea/Green Tea - Small", type: "Hot Beverage", price: 35 },
  { name: "Garam Chai/Lemon Tea/Green Tea - Regular", type: "Hot Beverage", price: 50 },
  { name: "Boost/Horlicks - Small", type: "Hot Beverage", price: 40 },
  { name: "Boost/Horlicks - Regular", type: "Hot Beverage", price: 60 },

  // Hot Beverages - Regular only (no Small size listed)
  { name: "Café Mocha", type: "Hot Beverage", price: 50 },
  { name: "Café Latte", type: "Hot Beverage", price: 50 },

  // Cold Beverages
  { name: "Cold Coffee (Classic/Hazelnut/Caramel)", type: "Cold Beverage", price: 85 },
  { name: "Milkshake (Classic Chocolate/Berry)", type: "Cold Beverage", price: 85 },

  // Ready to Drink (MRP items, no price shown - using estimated typical MRP)
  { name: "Storm Energy Drink", type: "Ready to Drink", price: 30 },
  { name: "Cold Coffee (Vanilla/Hazelnut) - RTD", type: "Ready to Drink", price: 40 },
  { name: "Rush Fruit Juice (Mango/Pomegranate)", type: "Ready to Drink", price: 30 },
  { name: "Tender Coconut Water", type: "Ready to Drink", price: 60 },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const restaurant = await Restaurant.create({
      name: "Xpress (Café Coffee Day)",
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