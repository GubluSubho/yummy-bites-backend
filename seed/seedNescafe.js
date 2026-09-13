require('dotenv').config();
const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');

const menuData = [
  // Hot Favourites
  { name: "Lemon Tea", type: "Hot Favourites", price: 25 },
  { name: "Green Tea", type: "Hot Favourites", price: 25 },
  { name: "Black Tea", type: "Hot Favourites", price: 25 },
  { name: "Cardamom Tea", type: "Hot Favourites", price: 30 },
  { name: "Masala Tea", type: "Hot Favourites", price: 30 },
  { name: "Express Black Coffee", type: "Hot Favourites", price: 30 },
  { name: "Nescafe Regular Coffee", type: "Hot Favourites", price: 35 },
  { name: "Americano", type: "Hot Favourites", price: 40 },

  // Coffee Premium
  { name: "Cappuccino", type: "Coffee Premium", price: 50 },
  { name: "Café Latte", type: "Coffee Premium", price: 50 },
  { name: "Tapri Coffee", type: "Coffee Premium", price: 50 },
  { name: "Hot Chocolate", type: "Coffee Premium", price: 60 },
  { name: "Cafe Mocha", type: "Coffee Premium", price: 60 },
  { name: "Cappuccino Strong", type: "Coffee Premium", price: 60 },
  { name: "Irish Cappuccino", type: "Coffee Premium", price: 60 },
  { name: "Hazelnut Cappuccino", type: "Coffee Premium", price: 60 },
  { name: "Caramel Cappuccino", type: "Coffee Premium", price: 65 },
  { name: "Chococcino", type: "Coffee Premium", price: 65 },

  // Cold Refreshers
  { name: "Lemon Ice Tea", type: "Cold Refreshers", price: 60 },
  { name: "Masala Ice Tea", type: "Cold Refreshers", price: 65 },
  { name: "Mojito Ice Tea", type: "Cold Refreshers", price: 65 },
  { name: "Peach Ice Tea", type: "Cold Refreshers", price: 75 },
  { name: "Ice Americano", type: "Cold Refreshers", price: 75 },
  { name: "Frappe Mocha", type: "Cold Refreshers", price: 75 },
  { name: "Cold Chocolate", type: "Cold Refreshers", price: 80 },
  { name: "Cold Frappe Mocha", type: "Cold Refreshers", price: 85 },
  { name: "Irish Frappe", type: "Cold Refreshers", price: 85 },
  { name: "Caramel Frappe", type: "Cold Refreshers", price: 85 },
  { name: "Hazelnut Frappe", type: "Cold Refreshers", price: 100 },
  { name: "Kitkat Frappe", type: "Cold Refreshers", price: 100 },
  { name: "Munch Frappe", type: "Cold Refreshers", price: 100 },

  // Sandwich Menu
  { name: "Bread Omlet", type: "Sandwich", price: 60 },
  { name: "Bread Cheese Omlet", type: "Sandwich", price: 75 },
  { name: "Cheese Sandwich", type: "Sandwich", price: 60 },
  { name: "Vegetable Sandwich", type: "Sandwich", price: 75 },
  { name: "Veg Cheese Sandwich", type: "Sandwich", price: 75 },
  { name: "Veg Corn Sandwich", type: "Sandwich", price: 90 },
  { name: "Veg Corn Cheese Sandwich", type: "Sandwich", price: 85 },
  { name: "Paneer Sandwich", type: "Sandwich", price: 100 },
  { name: "Paneer Cheese Sandwich", type: "Sandwich", price: 85 },
  { name: "Chicken Sandwich", type: "Sandwich", price: 100 },
  { name: "Chicken Cheese Sandwich", type: "Sandwich", price: 110 },
  { name: "Chilli Garlic Chicken Sandwich", type: "Sandwich", price: 110 },

  // Maggi Specials
  { name: "Original Masala Maggi", type: "Maggi", price: 55 },
  { name: "Aata Maggi", type: "Maggi", price: 60 },
  { name: "Garden Fresh Maggi", type: "Maggi", price: 65 },
  { name: "Special Masala Maggi", type: "Maggi", price: 65 },
  { name: "Butter Garlic Maggi", type: "Maggi", price: 70 },
  { name: "Manchurian Maggi", type: "Maggi", price: 75 },
  { name: "Chilli Garlic Maggi", type: "Maggi", price: 75 },
  { name: "Double Masala Maggi", type: "Maggi", price: 75 },
  { name: "Chilli Paneer Maggi", type: "Maggi", price: 80 },
  { name: "Peri Peri Maggi", type: "Maggi", price: 80 },
  { name: "Barbeque Maggi", type: "Maggi", price: 80 },
  { name: "Hostel Wali Maggi", type: "Maggi", price: 80 },
  { name: "Shillong Szechuan Maggi", type: "Maggi", price: 80 },
  { name: "Traffic Light Maggi", type: "Maggi", price: 90 },
  { name: "Italiano Maggi", type: "Maggi", price: 90 },
  { name: "Kolkata Special Maggi", type: "Maggi", price: 90 },
  { name: "Hyderabadi Maggi", type: "Maggi", price: 90 },
  { name: "Patiala Tandoori Maggi", type: "Maggi", price: 90 },
  { name: "Creamy Chilli Garlic Maggi", type: "Maggi", price: 90 },
  { name: "Fry Maggi", type: "Maggi", price: 180 },
  { name: "Corn Cheese Maggi (2pc)", type: "Maggi", price: 180 },
  { name: "Chinese Maggi (2pc)", type: "Maggi", price: 110 },

  // Pazzta
  { name: "Cheese Pazzta", type: "Pazzta", price: 100 },
  { name: "Paneer Cheese Pazzta", type: "Pazzta", price: 120 },
  { name: "Chicken Cheese Pazzta", type: "Pazzta", price: 130 },
  { name: "Masala Pazzta", type: "Pazzta", price: 100 },
  { name: "Paneer Masala Pazzta", type: "Pazzta", price: 120 },
  { name: "Chicken Masala Pazzta", type: "Pazzta", price: 130 },
  { name: "Tomato Pazzta", type: "Pazzta", price: 100 },
  { name: "Paneer Tomato Pazzta", type: "Pazzta", price: 120 },
  { name: "Chicken Tomato Pazzta", type: "Pazzta", price: 130 },
  { name: "Mushroom Pazzta", type: "Pazzta", price: 100 },
  { name: "Paneer Mushroom Pazzta", type: "Pazzta", price: 120 },
  { name: "Chicken Mushroom Pazzta", type: "Pazzta", price: 130 },

  // Rice
  { name: "Wok Rice", type: "Rice", price: 100 },
  { name: "Egg Wok Rice", type: "Rice", price: 110 },
  { name: "Paneer Wok Rice", type: "Rice", price: 120 },
  { name: "Chicken Wok Rice", type: "Rice", price: 130 },
  { name: "Mix Wok Rice", type: "Rice", price: 140 },
  { name: "Wok Rice with Veg Manchurian", type: "Rice", price: 150 },
  { name: "Wok Rice with Chk Manchurian", type: "Rice", price: 200 },
  { name: "Chilli Garlic Rice", type: "Rice", price: 100 },
  { name: "Egg Chilli Garlic Rice", type: "Rice", price: 110 },
  { name: "Paneer Chilli Garlic Rice", type: "Rice", price: 120 },
  { name: "Chicken Chilli Garlic Rice", type: "Rice", price: 130 },
  { name: "Mix Chilli Garlic Rice", type: "Rice", price: 140 },
  { name: "Chilli Garlic Rice with Veg Manchurian", type: "Rice", price: 150 },
  { name: "Chilli Garlic Rice with Chk Manchurian", type: "Rice", price: 200 },

  // Momo Specials
  { name: "Vegetable Momo", type: "Momo", price: 80 },
  { name: "Chicken Momo", type: "Momo", price: 90 },
  { name: "Chicken Cheese Momo", type: "Momo", price: 120 },
  { name: "Paneer Momo", type: "Momo", price: 120 },
  { name: "Mushroom Cheese Momo", type: "Momo", price: 120 },
  { name: "Corn Cheese Momo", type: "Momo", price: 120 },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Create the restaurant
    const restaurant = await Restaurant.create({
      name: "Nescafe",
      location: "Adamas University - Near Food Court & Convention Hall",
      staffIds: []
    });
    console.log('✅ Restaurant created:', restaurant._id);

    // Attach restaurantId to every menu item
    const itemsWithRestaurant = menuData.map(item => ({
      ...item,
      restaurantId: restaurant._id,
      isAvailable: true,
      quantity: 20
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