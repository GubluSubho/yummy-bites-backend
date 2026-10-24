const BASE = 'http://127.0.0.1:5000/api';

async function call(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data };
}

const results = [];
function check(label, ok, extra) {
  results.push(ok);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '   (' + extra + ')' : ''));
}

async function firstItem(restaurantId) {
  const menu = (await call('GET', '/menu/' + restaurantId)).data;
  return menu.find((i) => i.isAvailable && i.quantity >= 2);
}

async function stockMap(rests) {
  const out = {};
  for (const r of rests) {
    const menu = (await call('GET', '/menu/' + r._id)).data;
    menu.forEach((i) => { out[i._id] = i.quantity; });
  }
  return out;
}

async function run() {
  const cust = await call('POST', '/auth/login', null, { email: 'student1@gmail.com', password: 'test1234' });
  if (cust.status !== 200) { console.log('Could not log in. Is the local backend running?'); return; }
  const token = cust.data.token;

  const list = (await call('GET', '/restaurants')).data;
  const canteen = list.find((r) => /canteen/i.test(r.name));
  const nescafe = list.find((r) => /nescaf/i.test(r.name));
  const panda = list.find((r) => /panda/i.test(r.name));

  check('Nescafe is the live counter and takes parcels', nescafe.liveCounter === true && nescafe.allowParcel === true);
  check('Panda Junction takes parcels, no live counter', panda.allowParcel === true && panda.liveCounter === false);
  check('Canteen has neither', canteen.liveCounter === false && canteen.allowParcel === false);
  check('Parcel fee is 10', nescafe.parcelFee === 10);

  const before = await stockMap([canteen, nescafe, panda]);
  const made = [];

  async function place(rest, item, extra) {
    const res = await call('POST', '/orders', token, Object.assign(
      { restaurantId: rest._id, items: [{ menuItemId: item._id, quantity: 2 }], paymentMethod: 'upi' }, extra));
    if (res.status === 201) made.push(res.data.orderId);
    return res;
  }

  const cItem = await firstItem(canteen._id);
  const nItem = await firstItem(nescafe._id);
  const pItem = await firstItem(panda._id);

  const cash = await place(canteen, cItem, { paymentMethod: 'cash' });
  check('Cash is refused', cash.status === 400, cash.data && cash.data.error);

  const badParcel = await place(canteen, cItem, { parcel: true });
  check('Parcel is refused at the Canteen', badParcel.status === 400, badParcel.data && badParcel.data.error);

  const c = await place(canteen, cItem, { instructions: 'no onion' });
  check('Canteen ignores special instructions', c.status === 201 && c.data.instructions === '');
  check('Canteen shows no wait when the queue is short', c.status === 201 && c.data.estimatedWaitMins === 0, 'wait ' + (c.data && c.data.estimatedWaitMins));

  const n = await place(nescafe, nItem, { parcel: true, instructions: 'less spicy' });
  check('Nescafe keeps its instructions', n.status === 201 && n.data.instructions === 'less spicy');
  check('Nescafe parcel adds exactly 10', n.status === 201 && n.data.parcelFee === 10 && n.data.total === nItem.price * 2 + 10,
    'total ' + (n.data && n.data.total) + ', expected ' + (nItem.price * 2 + 10));
  check('Nescafe gives a wait estimate', n.status === 201 && n.data.estimatedWaitMins >= 3, 'wait ' + (n.data && n.data.estimatedWaitMins));

  const p = await place(panda, pItem, { parcel: true, instructions: 'extra spicy' });
  check('Panda parcel adds 10, instructions ignored', p.status === 201 && p.data.parcelFee === 10 && p.data.instructions === '');

  for (const id of made) {
    await call('POST', '/payment/abandon', token, { orderId: id });
  }
  const after = await stockMap([canteen, nescafe, panda]);
  const same = Object.keys(before).every((k) => before[k] === after[k]);
  check('All test orders cancelled and stock restored', same);

  console.log(results.every(Boolean) ? 'RESULT: ALL PASS' : 'RESULT: SOMETHING FAILED, paste this output to Claude');
}

run().catch((e) => console.log('Error:', e.message));
