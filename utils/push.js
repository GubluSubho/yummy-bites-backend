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

// Save the notification for the bell list, and tell the phone when it matters.
// Phone notifications: ready, delivered and cancelled. "Being prepared" only goes to the bell list.
// Never throws, so a failed notification cannot break an order.
async function notifyOrder(order, status) {
  try {
    const rest = await Restaurant.findById(order.restaurantId).select('name');
    const place = rest ? rest.name : 'the counter';
    const paid = ['paid', 'refunded'].includes(order.paymentStatus);

    let title = '';
    let body = '';
    let note = '';
    let push = false;
    let popup = false;

    if (status === 'preparing') {
      title = 'Your order is being prepared';
      body = 'Order ' + order.orderId + ' is being prepared at ' + place + '.';
    } else if (status === 'ready') {
      title = 'Your order is ready!';
      body = 'Order ' + order.orderId + ' is ready for pickup at ' + place + '.';
      push = true;
      popup = true;
    } else if (status === 'completed') {
      title = 'Order delivered';
      body = 'Enjoy your meal! Order ' + order.orderId + ' from ' + place + ' was handed over.';
      push = true;
      popup = true;
    } else if (status === 'cancelled') {
      title = 'Order cancelled';
      if (paid && order.paymentMethod === 'wallet') note = 'The money is back in your wallet.';
      if (paid && order.paymentMethod === 'upi') note = 'Your payment will be refunded.';
      body = 'Order ' + order.orderId + ' at ' + place + ' was cancelled by the cart.' + (note ? ' ' + note : '');
      push = true;
      popup = true;
    } else {
      return;
    }

    await AppNotification.create({
      userId: order.userId,
      type: status,
      title,
      body,
      orderId: order.orderId,
      place,
      note,
      popupShown: !popup,
    });

    if (push) {
      const result = await sendToUser(order.userId, { title, body, data: { orderId: order.orderId, type: status } });
      console.log('Notification for ' + order.orderId + ' (' + status + '): ' + result.devices + ' phone(s) registered');
    }
  } catch (e) {
    console.log('Notification failed:', e.message);
  }
}

module.exports = { sendToUser, getReceipts, notifyOrder, sleep };
