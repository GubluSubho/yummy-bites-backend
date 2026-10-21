require('dotenv').config();
const Razorpay = require('razorpay');

const id = process.env.RAZORPAY_KEY_ID || '';
const secret = process.env.RAZORPAY_KEY_SECRET || '';

console.log('Key id:', id ? id.slice(0, 12) + '... (length ' + id.length + ')' : 'MISSING');
console.log('Secret length:', secret.length, '(a normal one is about 24)');
console.log('Spaces or quotes present:', /[\s"']/.test(id + secret));
console.log('Mode:', id.startsWith('rzp_test_') ? 'TEST' : id.startsWith('rzp_live_') ? 'LIVE' : 'unknown');

async function run() {
  if (!id || !secret) {
    console.log('Keys are missing from .env');
    return;
  }
  const rz = new Razorpay({ key_id: id, key_secret: secret });
  try {
    await rz.orders.all({ count: 1 });
    console.log('Razorpay accepted these keys.');
  } catch (e) {
    console.log('Razorpay rejected them:', (e && e.error && e.error.description) || e.message);
  }
}

run();
