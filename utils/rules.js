const Order = require('../models/Order');
const { calculateWait } = require('./waitTime');

const PARCEL_FEE = 10;
// A normal cart only shows a wait once this many orders are queued
const BUSY_QUEUE = 8;
const ACTIVE = ['placed', 'preparing'];

// Orders that really count towards the queue: online orders only once they are paid
async function activeQueue(restaurantId) {
  return Order.find({
    restaurantId,
    status: { $in: ACTIVE },
    $or: [{ paymentMethod: { $ne: 'upi' } }, { paymentStatus: 'paid' }],
  }).select('items status');
}

// Live counter (Nescafe): full estimate from the queue, the dishes and the cooks.
// Other carts: no wait at all unless the queue is long.
function estimateFor(restaurant, queuedOrders, newItems) {
  if (restaurant.liveCounter) {
    return {
      show: true,
      mins: calculateWait({ queuedOrders, cooksOnDuty: restaurant.cooksOnDuty, newItems }),
    };
  }

  const waiting = queuedOrders.length;
  if (waiting >= BUSY_QUEUE) {
    const cooks = Math.max(1, restaurant.cooksOnDuty || 1);
    return { show: true, mins: Math.min(60, Math.max(5, Math.ceil(waiting / cooks) * 2)) };
  }
  return { show: false, mins: 0 };
}

module.exports = { PARCEL_FEE, BUSY_QUEUE, ACTIVE, activeQueue, estimateFor };
