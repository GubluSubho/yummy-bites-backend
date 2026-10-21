const BASE = 'http://127.0.0.1:5000/api';

async function call(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data };
}

async function stockOf(restaurantId, itemId) {
  const menu = (await call('GET', '/menu/' + restaurantId)).data;
  return menu.find((i) => i._id === itemId);
}

async function run() {
  const cust = await call('POST', '/auth/login', null, { email: 'student1@gmail.com', password: 'test1234' });
  const mgr = await call('POST', '/auth/login', null, { email: 'canteen.manager@test.com', password: 'Manager123' });
  if (cust.status !== 200 || mgr.status !== 200) {
    console.log('Could not log in. Is the backend running on this laptop?');
    return;
  }
  const customerToken = cust.data.token;
  const managerToken = mgr.data.token;
  const restaurantId = mgr.data.restaurantId;

  const menu = (await call('GET', '/menu/' + restaurantId)).data;
  const item = menu.find((i) => i.isAvailable && i.quantity > 0) || menu[0];
  const originalStock = item.quantity;
  console.log('Testing with:', item.name, '(stock was ' + originalStock + ')');

  await call('PATCH', '/menu/' + item._id + '/quantity', managerToken, { quantity: 1 });

  const attempts = 10;
  const results = await Promise.all(
    Array.from({ length: attempts }, () =>
      call('POST', '/orders', customerToken, {
        restaurantId,
        items: [{ menuItemId: item._id, quantity: 1 }],
        paymentMethod: 'cash',
        instructions: 'race test',
      })
    )
  );

  const won = results.filter((r) => r.status === 201);
  const lost = results.filter((r) => r.status !== 201);
  console.log('Customers ordering at the same moment:', attempts);
  console.log('Orders accepted:', won.length, '(must be exactly 1)');
  console.log('Turned away:', lost.length, '| message:', lost[0] && lost[0].data && lost[0].data.error);

  const after = await stockOf(restaurantId, item._id);
  console.log('Stock after the rush:', after.quantity, '(must be 0)');

  for (const w of won) {
    await call('PATCH', '/orders/' + w.data.orderId + '/status', managerToken, { status: 'cancelled' });
  }
  const back = await stockOf(restaurantId, item._id);
  console.log('After the winner is cancelled: stock', back.quantity, '| can be bought again:', back.isAvailable && back.quantity > 0);

  await call('PATCH', '/menu/' + item._id + '/quantity', managerToken, { quantity: originalStock });
  console.log('Stock put back to', originalStock);

  const ok = won.length === 1 && after.quantity === 0 && back.isAvailable && back.quantity === 1;
  console.log(ok ? 'RESULT: PASS - no overselling' : 'RESULT: FAIL - paste this output to Claude');
}

run().catch((e) => console.log('Error:', e.message));
