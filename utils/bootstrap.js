const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const User = require('../models/User');

const SEED_DIR = path.join(__dirname, '..', 'seed');
const SEED_SCRIPTS = [
  'seedCanteen.js',
  'seedjumbo.js',
  'seedNescafe.js',
  'seedPandaJunction.js',
  'seedXpress.js',
  'seedManager.js',
  'seedJumboManager.js',
  'seedRemainingManagers.js',
];
const PREP_BY_TYPE = { Staple: 3, Side: 2, Veg: 6, 'Non-Veg': 8 };

// Find a seed file even if the upper/lower case differs (Linux servers care about case)
function findScript(name) {
  const files = fs.readdirSync(SEED_DIR);
  const match = files.find((f) => f.toLowerCase() === name.toLowerCase());
  if (!match) throw new Error('Missing seed file: ' + name);
  return path.join(SEED_DIR, match);
}

function makePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function resetManagerPasswords() {
  const managers = await User.find({ role: 'manager' }).sort({ email: 1 }).select('email');
  console.log('===== MANAGER LOGINS (shown once, copy them now) =====');
  for (const m of managers) {
    const pw = makePassword();
    await User.updateOne({ _id: m._id }, { $set: { password: await bcrypt.hash(pw, 10) } });
    console.log(m.email + '   ' + pw);
  }
  console.log('===== END OF MANAGER LOGINS =====');
}

async function firstSeed() {
  console.log('Empty database found. Filling it with the campus carts...');
  try {
    for (const name of SEED_SCRIPTS) {
      const result = spawnSync(process.execPath, [findScript(name)], {
        env: process.env,
        encoding: 'utf8',
        timeout: 90000,
      });
      if (result.status !== 0) {
        throw new Error(name + ' failed: ' + String(result.stderr || result.stdout || '').slice(0, 300));
      }
    }

    for (const [type, mins] of Object.entries(PREP_BY_TYPE)) {
      await MenuItem.updateMany({ type }, { $set: { prepTimeMins: mins } });
    }

    const carts = await Restaurant.countDocuments();
    const items = await MenuItem.countDocuments();
    console.log('Seeded ' + carts + ' carts and ' + items + ' menu items.');
    await resetManagerPasswords();
  } catch (e) {
    console.log('First-time seeding failed, cleaning up:', e.message);
    await MenuItem.deleteMany({});
    await Restaurant.deleteMany({});
    await User.deleteMany({ role: 'manager' });
    throw e;
  }
}

// Change the value of RESET_MANAGER_PASSWORDS on the server to make new manager passwords once
async function maybeResetPasswords() {
  const token = String(process.env.RESET_MANAGER_PASSWORDS || '').trim();
  if (!token) return;

  const meta = mongoose.connection.db.collection('meta');
  const done = await meta.findOne({ _id: 'manager-reset' });
  if (done && done.token === token) return;

  await resetManagerPasswords();
  await meta.updateOne({ _id: 'manager-reset' }, { $set: { token, at: new Date() } }, { upsert: true });
}

// Which carts have a live food counter, take parcels or run the print shop
async function applyCartRules() {
  await Restaurant.updateMany(
    { name: /nescaf/i, liveCounter: { $ne: true } },
    { $set: { liveCounter: true, allowParcel: true } }
  );
  await Restaurant.updateMany({ name: /nescaf/i, allowParcel: { $ne: true } }, { $set: { allowParcel: true } });
  await Restaurant.updateMany({ name: /panda/i, allowParcel: { $ne: true } }, { $set: { allowParcel: true } });
  await Restaurant.updateMany({ name: /jumbo/i, allowPrint: { $ne: true } }, { $set: { allowPrint: true } });
}

// Nescafe items start with their prep time switched on. Managers can change it per item later.
async function applyItemTiming() {
  const nescafe = await Restaurant.findOne({ name: /nescaf/i }).select('_id');
  if (!nescafe) return;
  await MenuItem.updateMany(
    { restaurantId: nescafe._id, showTime: { $exists: false } },
    { $set: { showTime: true } }
  );
}

// Every cart can use sizes, and every size has its own stock. Older sized dishes get the dish's stock per size.
async function applySizeStock() {
  await Restaurant.updateMany({ allowSizes: { $ne: true } }, { $set: { allowSizes: true } });

  const old = await MenuItem.collection
    .find({ 'sizes.0': { $exists: true }, sizes: { $elemMatch: { quantity: { $exists: false } } } })
    .toArray();
  for (const doc of old) {
    const base = doc.quantity > 0 ? doc.quantity : 30;
    const sizes = doc.sizes.map((s) => ({
      name: s.name,
      price: s.price,
      quantity: typeof s.quantity === 'number' ? s.quantity : base,
    }));
    await MenuItem.collection.updateOne({ _id: doc._id }, { $set: { sizes } });
  }
  if (old.length > 0) console.log('Per-size stock set up for ' + old.length + ' dishes');
}

async function bootstrap() {
  const carts = await Restaurant.countDocuments();
  const managers = await User.countDocuments({ role: 'manager' });

  if (carts === 0 && managers === 0 && process.env.AUTO_SEED === 'true') {
    await firstSeed();
  }
  await applyCartRules();
  await applyItemTiming();
  await require('./catalog').applyCatalog();
  await applySizeStock();
  await maybeResetPasswords();
}

module.exports = { bootstrap };
