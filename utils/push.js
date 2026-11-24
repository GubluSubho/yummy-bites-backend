const PushToken = require('../models/PushToken');
const Restaurant = require('../models/Restaurant');

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => null);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Send to every phone of this user. Returns how many phones and what Expo answered for each.
async function sendToUser(userId, message) {
  const tokens = await PushToken.find({ userId }).select('token');
  if (tokens.length === 0) return { devices: 0, tickets: [] };

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    channelId: 'orders',
    priority: 'high',
    ...message,
  }));

  const body = await postJson(SEND_URL, messages);
  const tickets = (body && body.data) || [];

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    if (t.status !== 'error') continue;
    console.log('Push ticket error:', t.message, t.details && t.details.error);
    if (t.details && t.details.error === 'DeviceNotRegistered') {
      await PushToken.deleteOne({ token: messages[i].to });
    }
  }
  return { devices: tokens.length, tickets };
}

async function getReceipts(ids) {
  const body = await postJson(RECEIPTS_URL, { ids });
  return (body && body.data) || {};
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

    const result = await sendToUser(order.userId, { title, body, data: { orderId: order.orderId, type: status } });
    console.log('Notification for ' + order.orderId + ' (' + status + '): ' + result.devices + ' phone(s) registered');
  } catch (e) {
    console.log('Notification failed:', e.message);
  }
}

module.exports = { sendToUser, getReceipts, notifyOrder, sleep };
