const fs = require('fs');

const CLEAN = `// Check a list of sizes. An empty list means "no sizes".
function cleanSizes(input) {
  if (!Array.isArray(input)) return { error: 'Sizes must be a list' };
  if (input.length === 0) return { sizes: [] };
  if (input.length > 5) return { error: 'An item can have at most 5 sizes' };
  const seen = new Set();
  const out = [];
  for (const s of input) {
    const name = String((s && s.name) || '').trim();
    const price = Number(s && s.price);
    if (!name || name.length > 20) return { error: 'Each size needs a name (max 20 characters)' };
    if (!Number.isFinite(price) || price < 1 || price > 5000) return { error: 'Enter a valid price for ' + name };
    if (seen.has(name.toLowerCase())) return { error: 'Size names must be different' };
    seen.add(name.toLowerCase());
    out.push({ name, price });
  }
  if (out.length < 2) return { error: 'Add at least two sizes, or remove sizes to use one price' };
  return { sizes: out };
}

`;

const MINE_LIST = `// Manager: every dish of their own cart, including ones that still need a price
router.get('/mine/list', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    res.json(await MenuItem.find({ restaurantId: req.user.restaurantId }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

`;

const SIZES_ROUTE = `// Manager: set the sizes of a dish (an empty list removes them)
router.patch('/:itemId/sizes', verifyToken, requireRole('manager'), async (req, res) => {
  try {
    const item = await findOwnItem(req, res);
    if (!item) return;
    const cart = await Restaurant.findById(req.user.restaurantId).select('allowSizes');
    if (!cart || !cart.allowSizes) return res.status(400).json({ error: 'Sizes are not available for this cart' });

    const parsed = cleanSizes(req.body.sizes);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    item.sizes = parsed.sizes;
    if (parsed.sizes.length > 0) item.price = Math.min(...parsed.sizes.map((s) => s.price));
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

`;

const BUILD = `    }

    // One order line per dish and size, priced from the size chosen
    for (const [key, qty] of lines) {
      const cut = key.indexOf('|');
      const item = docs.get(key.slice(0, cut));
      const size = key.slice(cut + 1);
      const sizes = item.sizes || [];
      let price = item.price;
      if (sizes.length > 0) {
        const chosen = sizes.find((s) => s.name === size);
        if (!chosen) {
          await restoreStock(reserved);
          reserved.length = 0;
          return res.status(400).json({ error: 'Choose a size for ' + item.name });
        }
        price = chosen.price;
      } else if (size) {
        await restoreStock(reserved);
        reserved.length = 0;
        return res.status(400).json({ error: item.name + ' does not come in sizes' });
      }
      orderItems.push({
        menuItemId: item._id,
        name: item.name,
        size: size || undefined,
        price,
        quantity: qty,
        prepTimeMins: item.showTime ? item.prepTimeMins || 5 : 0,
        imageVersion: item.hasImage ? item.imageRev || 0 : 0,
      });
    }`;

const OLD_BUILD = `      orderItems.push({
        menuItemId: item._id,
        name: item.name,
        price: item.price,
        quantity: qty,
        prepTimeMins: item.showTime ? item.prepTimeMins || 5 : 0,
        imageVersion: item.hasImage ? item.imageRev || 0 : 0,
      });
    }`;

const PATCHES = [
  { file: 'models/Order.js', edits: [
    { find: `  name: { type: String, required: true },`, replace: `  name: { type: String, required: true },\n  size: { type: String },` },
  ] },
  { file: 'models/Restaurant.js', edits: [
    { find: `isOpen: { type: Boolean, default: true },`, replace: `isOpen: { type: Boolean, default: true },\n  allowSizes: { type: Boolean, default: false },` },
  ] },
  { file: 'routes/restaurants.js', edits: [
    { find: `'name cooksOnDuty liveCounter isOpen hasImage imageRev'`, replace: `'name cooksOnDuty liveCounter isOpen hasImage imageRev allowSizes'` },
    { find: `cooksOnDuty: r.cooksOnDuty,`, replace: `cooksOnDuty: r.cooksOnDuty,\n      allowSizes: !!r.allowSizes,` },
  ] },
  { file: 'utils/bootstrap.js', edits: [
    { find: `await applyItemTiming();`, replace: `await applyItemTiming();\n  await require('./catalog').applyCatalog();` },
  ] },
  { file: 'routes/menu.js', edits: [
    { find: `const ItemImage = require('../models/ItemImage');`, replace: `const ItemImage = require('../models/ItemImage');\nconst Restaurant = require('../models/Restaurant');` },
    { find: `async function findOwnItem(req, res) {`, replace: CLEAN + `async function findOwnItem(req, res) {` },
    { find: `// Public: full menu of a cart, including unavailable items (the app shows them struck off)`, replace: MINE_LIST + `// Public: full menu of a cart, including unavailable items (the app shows them struck off)` },
    { find: `const items = await MenuItem.find({ restaurantId: req.params.restaurantId });`, replace: `const items = await MenuItem.find({ restaurantId: req.params.restaurantId, price: { $gt: 0 } });` },
    { find: `const { name, type, price, quantity, prepTimeMins, showTime } = req.body;`, replace: `const { name, type, subType, sizes, price, quantity, prepTimeMins, showTime } = req.body;` },
    { find: `const item = await MenuItem.create({`, replace: `let sizeList = [];
    if (Array.isArray(sizes) && sizes.length > 0) {
      const cart = await Restaurant.findById(req.user.restaurantId).select('allowSizes');
      if (!cart || !cart.allowSizes) return res.status(400).json({ error: 'Sizes are not available for this cart' });
      const parsed = cleanSizes(sizes);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      sizeList = parsed.sizes;
    }

    const item = await MenuItem.create({` },
    { find: `price: cleanPrice,`, replace: `price: sizeList.length > 0 ? Math.min(...sizeList.map((s) => s.price)) : cleanPrice,
      sizes: sizeList,
      subType: subType ? String(subType).trim().slice(0, 30) : undefined,` },
    { find: `const price = Number(req.body.price);`, replace: `if ((item.sizes || []).length > 0) {
      return res.status(400).json({ error: 'This item has sizes. Change the prices in the sizes list.' });
    }
    const price = Number(req.body.price);` },
    { find: `item.name = name;`, replace: `item.name = name;
    if (req.body.subType !== undefined) item.subType = String(req.body.subType || '').trim().slice(0, 30) || undefined;` },
    { find: `// Manager: change the name and category of a dish`, replace: SIZES_ROUTE + `// Manager: change the name and category of a dish` },
  ] },
  { file: 'routes/orders.js', edits: [
    { find: `return { ...plain, remainingMins: remainingMins(plain) };`, replace: `const items = (plain.items || []).map((it) => ({
    ...it,
    baseName: it.name,
    name: it.size ? it.name + ' (' + it.size + ')' : it.name,
  }));
  return { ...plain, items, remainingMins: remainingMins(plain) };` },
    { find: `const wanted = new Map();`, replace: `const wanted = new Map();\n    const lines = new Map();` },
    { find: `const key = String(line.menuItemId);`, replace: `const key = String(line.menuItemId);
      const size = String(line.size || '').trim().slice(0, 30);
      lines.set(key + '|' + size, (lines.get(key + '|' + size) || 0) + qty);` },
    { find: `const orderItems = [];`, replace: `const orderItems = [];\n    const docs = new Map();` },
    { find: `{ _id: menuItemId, restaurantId, isAvailable: true, quantity: { $gte: qty } },`, replace: `{ _id: menuItemId, restaurantId, isAvailable: true, price: { $gt: 0 }, quantity: { $gte: qty } },` },
    { find: `      reserved.push({ menuItemId: item._id, quantity: qty });\n` + OLD_BUILD, replace: `      reserved.push({ menuItemId: item._id, quantity: qty });\n      docs.set(menuItemId, item);\n` + BUILD },
  ] },
];

let problems = 0;
for (const patch of PATCHES) {
  if (!fs.existsSync(patch.file)) { console.log('MISSING FILE       ' + patch.file); problems++; continue; }
  let text = fs.readFileSync(patch.file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const norm = (s) => s.replace(/\r?\n/g, eol);
  let ok = true;
  let changed = false;
  for (const edit of patch.edits) {
    const find = norm(edit.find);
    const replacement = norm(edit.replace);
    if (text.includes(replacement)) continue;
    const count = text.split(find).length - 1;
    if (count !== 1) {
      console.log('NOT MATCHED        ' + patch.file + '  [' + edit.find.trim().split('\n')[0].slice(0, 70) + ']  found ' + count + 'x');
      ok = false;
      continue;
    }
    text = text.replace(find, () => replacement);
    changed = true;
  }
  if (!ok) { console.log('SKIPPED            ' + patch.file + '  (nothing was changed in this file)'); problems++; }
  else if (changed) { fs.writeFileSync(patch.file, text); console.log('Updated            ' + patch.file); }
  else console.log('Already up to date ' + patch.file);
}
console.log(problems === 0 ? 'ALL BACKEND FILES ARE UP TO DATE' : problems + ' file(s) need attention. Paste this whole output to Claude.');
