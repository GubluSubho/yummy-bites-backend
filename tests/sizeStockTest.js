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

async function run() {
  const cust = await call('POST', '/auth/login', null, { email: 'student1@gmail.com', password: 'test1234' });
  const mgr = await call('POST', '/auth/login', null, { email: 'nescafe.manager@test.com', password: 'Manager123' });
  if (cust.status !== 200 || mgr.status !== 200) { console.log('Could not log in. Is the local backend running?'); return; }
  const ct = cust.data.token;
  const mt = mgr.data.token;
  const rid = mgr.data.restaurantId;

  const list = (await call('GET', '/menu/mine/list', mt)).data;
  const tea = list.find((i) => /black tea/i.test(i.name) && (i.sizes || []).length > 0);
  if (!tea) { console.log('Black Tea with sizes not found. Restart the backend once and run again.'); return; }
  const original = tea.sizes.map((s) => ({ name: s.name, price: s.price, quantity: s.quantity }));
  check('Every size has its own stock', original.every((s) => typeof s.quantity === 'number'), JSON.stringify(original));

  const set = await call('PATCH', '/menu/' + tea._id + '/sizes', mt, {
    sizes: [{ name: 'Regular', price: 25, quantity: 10 }, { name: 'Large', price: 50, quantity: 1 }],
  });
  check('Sizes saved with separate stock', set.status === 200 && set.data.sizes[1].quantity === 1);

  const order = (size) => call('POST', '/orders', ct, {
    restaurantId: rid, paymentMethod: 'upi', items: [{ menuItemId: tea._id, size, quantity: 1 }],
  });

  // Only one customer can get the last Large
  const results5 = await Promise.all([1, 2, 3, 4, 5].map(() => order('Large')));
  const won = results5.filter((r) => r.status === 201);
  const lost = results5.filter((r) => r.status !== 201);
  check('5 customers race for the last Large: exactly 1 wins', won.length === 1, 'won ' + won.length);
  check('The others are told it sold out', lost.length === 4 && /sold out|Only/.test((lost[0].data && lost[0].data.error) || ''), lost[0] && lost[0].data && lost[0].data.error);

  const after = (await call('GET', '/menu/mine/list', mt)).data.find((i) => i._id === tea._id);
  check('Large stock is now 0, Regular untouched', after.sizes[1].quantity === 0 && after.sizes[0].quantity === 10);

  const reg = await order('Regular');
  check('Regular can still be ordered while Large is sold out', reg.status === 201);

  // Cancel everything the test created: stock must come back to the right size
  const mine = (await call('GET', '/orders/mine', ct)).data;
  for (const o of mine.filter((x) => x.status === 'placed' && x.paymentStatus === 'pending')) {
    await call('POST', '/payment/abandon', ct, { orderId: o.orderId });
  }
  const back = (await call('GET', '/menu/mine/list', mt)).data.find((i) => i._id === tea._id);
  check('Cancelled orders return stock to their own size', back.sizes[0].quantity === 10 && back.sizes[1].quantity === 1, JSON.stringify(back.sizes.map((s) => s.quantity)));

  await call('PATCH', '/menu/' + tea._id + '/sizes', mt, { sizes: original });
  console.log(results.every(Boolean) ? 'RESULT: ALL PASS' : 'RESULT: SOMETHING FAILED, paste this output to Claude');
}

run().catch((e) => console.log('Error:', e.message));
