const MenuItem = require('../models/MenuItem');

const hasSizes = (item) => Array.isArray(item.sizes) && item.sizes.length > 0;
const totalStock = (item) =>
  hasSizes(item) ? item.sizes.reduce((sum, s) => sum + (s.quantity || 0), 0) : item.quantity || 0;

// Put reserved stock back. A line with a size goes back to that size.
async function restoreStock(items) {
  for (const it of items) {
    if (!it.menuItemId) continue;
    if (it.size) {
      await MenuItem.updateOne(
        { _id: it.menuItemId },
        { $inc: { 'sizes.$[s].quantity': it.quantity } },
        { arrayFilters: [{ 's.name': it.size }] }
      );
    } else {
      await MenuItem.updateOne({ _id: it.menuItemId }, { $inc: { quantity: it.quantity } });
    }
  }
}

module.exports = { hasSizes, totalStock, restoreStock };
