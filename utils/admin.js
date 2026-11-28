const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 10 characters) on the server to create or update the owner login
async function ensureAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email || password.length < 10) return;

  const existing = await User.findOne({ email });
  if (existing && existing.role !== 'admin') {
    console.log('ADMIN_EMAIL belongs to a normal account, so no owner login was created.');
    return;
  }
  if (!existing) {
    await User.create({
      name: 'Owner',
      email,
      password: await bcrypt.hash(password, 10),
      role: 'admin',
      accountType: 'normal',
      authProvider: 'password',
    });
    console.log('Owner login created for ' + email);
  } else if (!(await bcrypt.compare(password, existing.password))) {
    await User.updateOne({ _id: existing._id }, { $set: { password: await bcrypt.hash(password, 10) } });
    console.log('Owner password updated for ' + email);
  }
}

module.exports = { ensureAdmin };
