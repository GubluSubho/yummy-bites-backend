const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');

const TEAS = [
  { name: 'Black Tea', alt: [], regular: 25, large: 50 },
  { name: 'Cardamom Tea', alt: ['Caradomom Tea', 'Elaichi Tea'], regular: 30, large: 50 },
  { name: 'Green Tea', alt: [], regular: 25, large: 50 },
  { name: 'Lemon Tea', alt: [], regular: 25, large: 50 },
  { name: 'Masala Tea', alt: [], regular: 30, large: 50 },
];

// Type the price after each colon. A dish left at 0 is added hidden until the manager sets a price.
const MOMOS = {
  'Steam Momo': {
    'Veg Steam Momo': 90,
    'Paneer Steam Momo': 100,
    'Corn Cheese Momo': 100,
    'Paneer Cheese Momo': 100,
    'Mushroom Cheese Momo': 110,
    'Chicken Steam Momo': 110,
    'Chicken Darjeeling Momo': 120,
    'Chicken Cheese Momo': 120,
  },
  'Fried Momo': {
    'Veg Fried Momo': 110,
    'Paneer Fried Momo': 120,
    'Chicken Fried Momo': 130,
  },
  'Pan-fried Momo': {
    'Veg Pan-fried Momo': 130,
    'Paneer Pan-fried Momo': 140,
    'Chicken Pan-fried Momo': 150,
    'Chicken Chili Garlic Momo': 160,
  },
};

const normalize = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');

async function applyCatalog() {
  await Restaurant.updateMany({ name: /nescaf|xpress/i, allowSizes: { $ne: true } }, { $set: { allowSizes: true } });

  const meta = mongoose.connection.db.collection('meta');
  if (await meta.findOne({ _id: 'catalog-v1' })) return;

  const nescafe = await Restaurant.findOne({ name: /nescaf/i }).select('_id');
  if (!nescafe) return;

  const items = await MenuItem.find({ restaurantId: nescafe._id });
  const find = (...names) => {
    const wanted = names.map(normalize);
    return items.find((i) => wanted.includes(normalize(i.name)));
  };

  for (const t of TEAS) {
    const sizes = [{ name: 'Regular', price: t.regular }, { name: 'Large', price: t.large }];
    const item = find(t.name, ...t.alt);
    if (item) {
      item.sizes = sizes;
      item.price = t.regular;
      item.type = 'Hot Favourites';
      await item.save();
    } else {
      items.push(await MenuItem.create({
        restaurantId: nescafe._id, name: t.name, type: 'Hot Favourites', price: t.regular, sizes,
        quantity: 30, isAvailable: true, prepTimeMins: 3, showTime: true,
      }));
    }
  }

  let added = 0;
  for (const [sub, dishes] of Object.entries(MOMOS)) {
    for (const [dish, price] of Object.entries(dishes)) {
      const existing = find(dish);
      if (existing) {
        existing.type = 'Momo';
        existing.subType = sub;
        await existing.save();
        continue;
      }
      await MenuItem.create({
        restaurantId: nescafe._id, name: dish, type: 'Momo', subType: sub, price,
        quantity: price > 0 ? 30 : 0, isAvailable: price > 0, prepTimeMins: 8, showTime: true,
      });
      added++;
    }
  }

  await meta.updateOne({ _id: 'catalog-v1' }, { $set: { at: new Date() } }, { upsert: true });
  console.log('Catalog applied: ' + TEAS.length + ' teas with sizes, ' + added + ' momo dishes added');
}

module.exports = { applyCatalog };
