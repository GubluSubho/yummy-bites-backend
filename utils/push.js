const PushToken = require('../models/PushToken');
const Restaurant = require('../models/Restaurant');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendToUser(userId, message) {
  const tokens = await PushToken.find({ userId }).select('token');
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    channelId: 'orders',
    priority: 'high',
    ...message,
  }));

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  const body = await res.json().catch(() => null);
  const tickets = (body && body.data) || [];

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    if (t.status !== 'error') continue;
    if (t.details && t.details.error === 'DeviceNotRegistered') {
      await PushToken.deleteOne({ token: messages[i].to });
    } else {
      console.log('Push error:', t.message);
    }
  }
}

// Tell the customer about their order. Never throws, so a failed notification cannot break an order.
async function notifyOrder(order, status) {
  try {
    const rest = await Restaurant.findById(order.restaurantId).select('name');
    const place = rest ? rest.name : 'the counter';

    let title = '';
    let body = '';
    if (status === 'ready') {
      title = 'Your order is ready!';
      body = 'Order ' + order.orderId + ' is ready for pickup at ' + place + '.';
    } else if (status === 'cancelled') {
      title = 'Order cancelled';
      body = 'Order ' + order.orderId + ' at ' + place + ' was cancelled.';
      const paid = ['paid', 'refunded'].includes(order.paymentStatus);
      if (paid && order.paymentMethod === 'wallet') body += ' The money is back in your wallet.';
      if (paid && order.paymentMethod === 'upi') body += ' Your payment will be refunded.';
    } else {
      return;
    }

    await sendToUser(order.userId, { title, body, data: { orderId: order.orderId, type: status } });
  } catch (e) {
    console.log('Notification failed:', e.message);
  }
}

module.exports = { sendToUser, notifyOrder };
