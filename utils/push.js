const PushToken = require('../models/PushToken');
const Restaurant = require('../models/Restaurant');
const AppNotification = require('../models/AppNotification');

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

async function sendToUser(userId, message) {
  const tokens = await PushToken.find({ userId }).select('token');
  if (tokens.length === 0) return { devices: 0, tickets: [] };

  const messages = tokens.map((t) => ({
    to: t.token, sound: 'default', channelId: 'orders', priority: 'high', ...message,
  }));
  const body = await postJson(SEND_URL, messages);
  const tickets = (body && body.data) || [];

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    if (t.status !== 'error') continue;
    console.log('Push ticket error:', t.message, t.details && t.details.error);
    if (t.details && t.details.error === 'DeviceNotRegistered') await PushToken.deleteOne({ token: messages[i].to });
  }
  return { devices: tokens.length, tickets };
}

async function getReceipts(ids) {
  const body = await postJson(RECEIPTS_URL, { ids });
  return (body && body.data) || {};
}

// food, print, or mixed (a Jumbo order with both)
function kindOf(order) {
  const items = order.items || [];
  const services = items.filter((i) => i.service).length;
  if (items.length > 0 && services === items.length) return 'print';
  return services > 0 ? 'mixed' : 'food';
}

const COPY = {
  preparing: {
    food: ['Your order is being prepared', (id, p) => 'Order ' + id + ' is being prepared at ' + p + '.'],
    print: ['Your print job has started', (id, p) => 'Order ' + id + ' is being printed at ' + p + '.'],
    mixed: ['Your order is being prepared', (id, p) => 'Order ' + id + ' is being prepared at ' + p + '.'],
  },
  ready: {
    food: ['Your order is ready!', (id, p) => 'Order ' + id + ' is ready for pickup at ' + p + '.'],
    print: ['Your print job is ready!', (id, p) => 'Order ' + id + ' is ready to collect at ' + p + '.'],
    mixed: ['Your order is ready!', (id, p) => 'Order ' + id + ' is ready for pickup at ' + p + '.'],
  },
  completed: {
    food: ['Order delivered', (id, p) => 'Enjoy your meal! Order ' + id + ' from ' + p + ' was handed over.'],
    print: ['Print job collected', (id, p) => 'Thanks for printing with ' + p + '. Order ' + id + ' is complete.'],
    mixed: ['Order collected', (id, p) => 'Thanks for ordering from ' + p + '. Order ' + id + ' is complete.'],
  },
};

// Save the notification for the bell list, and tell the phone when it matters. Never throws.
async function notifyOrder(order, status) {
  try {
    const rest = await Restaurant.findById(order.restaurantId).select('name');
    const place = rest ? rest.name : 'the counter';
    const kind = kindOf(order);
    const paid = ['paid', 'refunded'].includes(order.paymentStatus);

    let title, body, note = '', push = false, popup = false;
    if (status === 'cancelled') {
      title = 'Order cancelled';
      if (paid && order.paymentMethod === 'wallet') note = 'The money is back in your wallet.';
      if (paid && order.paymentMethod === 'upi') note = 'Your payment will be refunded.';
      body = 'Order ' + order.orderId + ' at ' + place + ' was cancelled by the cart.' + (note ? ' ' + note : '');
      push = popup = true;
    } else if (COPY[status]) {
      const [t, b] = COPY[status][kind];
      title = t;
      body = b(order.orderId, place);
      push = popup = status !== 'preparing';
    } else {
      return;
    }

    await AppNotification.create({ userId: order.userId, type: status, kind, title, body, orderId: order.orderId, place, note, popupShown: !popup });
    if (push) {
      const result = await sendToUser(order.userId, { title, body, data: { orderId: order.orderId, type: status, kind } });
      console.log('Notification for ' + order.orderId + ' (' + status + '): ' + result.devices + ' phone(s) registered');
    }
  } catch (e) {
    console.log('Notification failed:', e.message);
  }
}

module.exports = { sendToUser, getReceipts, notifyOrder, sleep, kindOf };
