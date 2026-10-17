require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Database:', mongoose.connection.name, '| host:', mongoose.connection.host);
  console.log('Restaurants:', await Restaurant.countDocuments());
  console.log('Menu items:', await MenuItem.countDocuments());
  console.log('Orders:', await Order.countDocuments());
  console.log('Users:', await User.countDocuments());

  const managers = await User.find({ role: 'manager' }).select('email password restaurantId');
  console.log('Managers:', managers.length);
  for (const m of managers) {
    const ok = await bcrypt.compare('Manager123', m.password);
    console.log(' ', m.email, '| cart linked:', !!m.restaurantId, '| Manager123 matches:', ok);
  }

  const dbs = await mongoose.connection.getClient().db().admin().listDatabases();
  console.log('Databases on this server:', dbs.databases.map((d) => d.name + ' (' + Math.round(d.sizeOnDisk / 1024) + ' KB)').join(', '));
  await mongoose.disconnect();
}

run().catch((e) => { console.log('Error:', e.message); process.exit(1); });
