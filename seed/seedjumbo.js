require('dotenv').config();
const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');

const menuData = [
  // Printing
  { name: "A4 Xerox", type: "Printing", price: 2 },
  { name: "A4 Black Print", type: "Printing", price: 5 },
  { name: "A4 Colour Print", type: "Printing", price: 10 },
  { name: "A3 Xerox", type: "Printing", price: 4 },
  { name: "A3 Black Print", type: "Printing", price: 10 },
  { name: "A3 Colour Print", type: "Printing", price: 20 },

  // Spiral Binding
  { name: "Spiral Binding (1-30 pages)", type: "Binding", price: 30 },
  { name: "Spiral Binding (31-50 pages)", type: "Binding", price: 40 },
  { name: "Spiral Binding (51-80 pages)", type: "Binding", price: 50 },
  { name: "Spiral Binding (81-120 pages)", type: "Binding", price: 70 },

  // Snacks & Chips
  { name: "Chips", type: "Snacks & Chips", price: 20 },
  { name: "Kurkure", type: "Snacks & Chips", price: 20 },
  { name: "Oreo Biscuit", type: "Snacks & Chips", price: 15 },
  { name: "Cake", type: "Snacks & Chips", price: 25 },

  // Soft Drinks
  { name: "Coca Cola", type: "Soft Drinks", price: 40 },
  { name: "Thumbs Up", type: "Soft Drinks", price: 40 },

  // Other Services
  { name: "Lamination", type: "Other Services", price: 50 },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const restaurant = await Restaurant.create({
      name: "Jumbo",
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