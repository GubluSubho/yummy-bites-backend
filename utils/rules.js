const Order = require('../models/Order');
const { calculateWait } = require('./waitTime');

const PARCEL_FEE = 10;
// A cart shows a "busy" wait once this many orders are queued
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

// Items the manager switched a time on for carry prepTimeMins > 0. Items without a time carry 0.
// If the order has timed items: estimate from the queue, those items and the cooks.
// If it has none: no wait, unless the queue is long.
function estimateFor(restaurant, queuedOrders, newItems) {
  const timed = newItems.filter((i) => i.prepTimeMins > 0);
  if (timed.length > 0) {
    return {
      show: true,
      reason: 'prep',
      mins: calculateWait({ queuedOrders, cooksOnDuty: restaurant.cooksOnDuty, newItems: timed }),
    };
  }

  const waiting = queuedOrders.length;
  if (waiting >= BUSY_QUEUE) {
    const cooks = Math.max(1, restaurant.cooksOnDuty || 1);
    return { show: true, reason: 'busy', mins: Math.min(60, Math.max(5, Math.ceil(waiting / cooks) * 2)) };
  }
  return { show: false, reason: null, mins: 0 };
}

module.exports = { PARCEL_FEE, BUSY_QUEUE, ACTIVE, activeQueue, estimateFor };
