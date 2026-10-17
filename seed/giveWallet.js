require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');

async function run() {
  const [email, amountArg] = process.argv.slice(2);
  const amount = Number(amountArg);
  if (!email || !Number.isInteger(amount) || amount < 1 || amount > 5000) {
    console.log('Usage: node seed\\giveWallet.js email amount');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOneAndUpdate(
    { email: email.trim().toLowerCase(), role: 'customer' },
    { $inc: { walletBalance: amount } },
    { new: true }
  );
  if (!user) {
    console.log('No customer with that email');
  } else {
    await WalletTransaction.create({
      userId: user._id,
      type: 'topup',
      amount,
      balanceAfter: user.walletBalance,
      note: 'Test top-up',
    });
    console.log(user.name + ' now has Rs ' + user.walletBalance);
  }
  await mongoose.disconnect();
}

run().catch((e) => { console.log('Error:', e.message); process.exit(1); });
