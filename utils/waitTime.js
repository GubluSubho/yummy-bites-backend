const BATCH_FACTOR = 0.4;
const MIN_WAIT = 3;
const MAX_WAIT = 90;

function itemsWork(items) {
  return items.reduce(
    (sum, it) => sum + it.prepTimeMins * (1 + BATCH_FACTOR * (it.quantity - 1)),
    0
  );
}

function calculateWait({ queuedOrders, cooksOnDuty, newItems }) {
  const cooks = Math.max(1, cooksOnDuty || 1);

  const queueWork = queuedOrders.reduce((sum, order) => {
    const share = order.status === 'preparing' ? 0.5 : 1;
    return sum + itemsWork(order.items) * share;
  }, 0);

  const ownWork = itemsWork(newItems);
  const longestItem = Math.max(...newItems.map((i) => i.prepTimeMins));
  const ownTime = Math.max(longestItem, ownWork / cooks);

  const wait = Math.ceil(queueWork / cooks + ownTime);
  return Math.min(MAX_WAIT, Math.max(MIN_WAIT, wait));
}

module.exports = { calculateWait, itemsWork };
