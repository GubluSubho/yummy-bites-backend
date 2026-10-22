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

async function bootstrap() {
  const carts = await Restaurant.countDocuments();
  const managers = await User.countDocuments({ role: 'manager' });

  if (carts === 0 && managers === 0 && process.env.AUTO_SEED === 'true') {
    await firstSeed();
  }
  await maybeResetPasswords();
}

module.exports = { bootstrap };
