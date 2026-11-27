const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');

const NESCAFE_TEAS = [
  { name: 'Black Tea', alt: [], regular: 25, large: 50 },
  { name: 'Cardamom Tea', alt: ['Caradomom Tea', 'Elaichi Tea'], regular: 30, large: 50 },
  { name: 'Green Tea', alt: [], regular: 25, large: 50 },
  { name: 'Lemon Tea', alt: [], regular: 25, large: 50 },
  { name: 'Masala Tea', alt: [], regular: 30, large: 50 },
];

// Momos start hidden (no price). The Nescafe manager prices them in the app (Menu tab, Set prices).
const MOMOS = {
  'Steam Momo': ['Veg Steam Momo', 'Paneer Steam Momo', 'Corn Cheese Momo', 'Paneer Cheese Momo', 'Mushroom Cheese Momo', 'Chicken Steam Momo', 'Chicken Darjeeling Momo', 'Chicken Cheese Momo'],
  'Fried Momo': ['Veg Fried Momo', 'Paneer Fried Momo', 'Chicken Fried Momo'],
  'Pan-fried Momo': ['Veg Pan-fried Momo', 'Paneer Pan-fried Momo', 'Chicken Pan-fried Momo', 'Chicken Chili Garlic Momo'],
};

const XPRESS = [
  { name: 'Black Coffee', alt: [], small: 35, regular: 50 },
  { name: 'Horlicks', alt: [], small: 40, regular: 60 },
  { name: 'Cappuccino', alt: [], small: 35, regular: 50 },
  { name: 'Masala Tea', alt: [], small: 40, regular: 50 },
  { name: 'Lemon Tea', alt: [], small: 35, regular: 50 },
  { name: 'Hazelnut Cappuccino', alt: [], small: 45, regular: 75 },
  { name: 'Caramel Cappuccino', alt: [], small: 45, regular: 75 },
  { name: 'Cardamom Tea', alt: ['Caradomom Tea', 'Elaichi Tea'], small: 40, regular: 50 },
  { name: 'Ginger Tea', alt: [], small: 40, regular: 50 },
  { name: 'Green Tea', alt: [], small: 40, regular: 50 },
  { name: 'Jaggery Cappuccino', alt: [], small: 40, regular: 60 },
];

const STOCK = 30;
const normalize = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');

async function applySizes(restaurantId, list, makeSizes, type, extra) {
  const items = await MenuItem.find({ restaurantId });
  let created = 0;
  for (const d of list) {
    const wanted = [d.name, ...(d.alt || [])].map(normalize);
    const sizes = makeSizes(d).map((s) => ({ ...s, quantity: STOCK }));
    const found = items.find((i) => wanted.includes(normalize(i.name)));
    if (found) {
      found.sizes = sizes;
      found.price = Math.min(...sizes.map((s) => s.price));
      found.type = type;
      await found.save();
    } else {
      await MenuItem.create({
        restaurantId, name: d.name, type, sizes, price: Math.min(...sizes.map((s) => s.price)),
        quantity: 0, isAvailable: true, ...extra,
      });
      created++;
    }
  }
  return created;
}

async function applyCatalog() {
  const meta = mongoose.connection.db.collection('meta');

  const nescafe = await Restaurant.findOne({ name: /nescaf/i }).select('_id');
  if (nescafe && !(await meta.findOne({ _id: 'catalog-nescafe-v1' }))) {
    const made = await applySizes(
      nescafe._id, NESCAFE_TEAS,
      (t) => [{ name: 'Regular', price: t.regular }, { name: 'Large', price: t.large }],
      'Hot Favourites', { prepTimeMins: 3, showTime: true }
    );

    const items = await MenuItem.find({ restaurantId: nescafe._id });
    let added = 0;
    for (const [sub, dishes] of Object.entries(MOMOS)) {
      for (const dish of dishes) {
        const existing = items.find((i) => normalize(i.name) === normalize(dish));
        if (existing) {
          existing.type = 'Momo';
          existing.subType = sub;
          await existing.save();
          continue;
        }
        await MenuItem.create({
          restaurantId: nescafe._id, name: dish, type: 'Momo', subType: sub, price: 0,
          quantity: 0, isAvailable: false, prepTimeMins: 8, showTime: true,
        });
        added++;
      }
    }
    await meta.updateOne({ _id: 'catalog-nescafe-v1' }, { $set: { at: new Date() } }, { upsert: true });
    console.log('Nescafe catalog: ' + NESCAFE_TEAS.length + ' teas with sizes (' + made + ' new), ' + added + ' momo dishes waiting for a price');
  }

  const xpress = await Restaurant.findOne({ name: /xpress/i }).select('_id');
  if (xpress && !(await meta.findOne({ _id: 'catalog-xpress-v1' }))) {
    const made = await applySizes(
      xpress._id, XPRESS,
      (d) => [{ name: 'Small', price: d.small }, { name: 'Regular', price: d.regular }],
      'Hot Beverage', { prepTimeMins: 5, showTime: false }
    );
    await meta.updateOne({ _id: 'catalog-xpress-v1' }, { $set: { at: new Date() } }, { upsert: true });
    console.log('Xpress catalog: ' + XPRESS.length + ' drinks with sizes (' + made + ' new)');
  }
}

module.exports = { applyCatalog };
