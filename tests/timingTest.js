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
  const mgr = await call('POST', '/auth/login', null, { email: 'canteen.manager@test.com', password: 'Manager123' });
  if (cust.status !== 200 || mgr.status !== 200) { console.log('Could not log in. Is the local backend running?'); return; }
  const ct = cust.data.token;
  const mt = mgr.data.token;
  const restaurantId = mgr.data.restaurantId;

  const menu = (await call('GET', '/menu/' + restaurantId)).data;
  const item = menu.find((i) => i.isAvailable && i.quantity >= 2);
  check('Menu items carry the showTime flag', typeof item.showTime === 'boolean');
  const wasShown = !!item.showTime;
  const wasPrep = item.prepTimeMins;

  async function orderOne() {
    const res = await call('POST', '/orders', ct, {
      restaurantId, items: [{ menuItemId: item._id, quantity: 1 }], paymentMethod: 'upi',
    });
    if (res.status === 201) await call('POST', '/payment/abandon', ct, { orderId: res.data.orderId });
    return res;
  }

  const bad = await call('PATCH', '/menu/' + item._id + '/timing', mt, { showTime: true, prepTimeMins: 0 });
  check('A prep time of 0 is refused', bad.status === 400);

  await call('PATCH', '/menu/' + item._id + '/timing', mt, { showTime: false });
  const off = await orderOne();
  check('Time switched OFF: the order shows no wait', off.status === 201 && off.data.estimatedWaitMins === 0, 'wait ' + (off.data && off.data.estimatedWaitMins));

  await call('PATCH', '/menu/' + item._id + '/timing', mt, { showTime: true, prepTimeMins: 7 });
  const on = await orderOne();
  check('Time switched ON at 7 minutes: the wait is at least 7', on.status === 201 && on.data.estimatedWaitMins >= 7, 'wait ' + (on.data && on.data.estimatedWaitMins));

  await call('PATCH', '/menu/' + item._id + '/timing', mt, { showTime: wasShown, prepTimeMins: wasPrep });
  const back = (await call('GET', '/menu/' + restaurantId)).data.find((i) => i._id === item._id);
  check('Item put back as it was', back.showTime === wasShown && back.prepTimeMins === wasPrep);

  console.log(results.every(Boolean) ? 'RESULT: ALL PASS' : 'RESULT: SOMETHING FAILED, paste this output to Claude');
}

run().catch((e) => console.log('Error:', e.message));
