require('dotenv').config();
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
  const phone = '9' + String(Math.floor(100000000 + Math.random() * 899999999));

  check('A bad phone number is refused', (await call('POST', '/auth/phone/send', null, { phone: '123' })).status === 400);
  const sent = await call('POST', '/auth/phone/send', null, { phone });
  check('A code is sent (demo mode)', sent.status === 200 && /^\d{6}$/.test(sent.data.devCode || ''), sent.data && (sent.data.error || 'ok'));
  if (!sent.data.devCode) { console.log('Set OTP_PROVIDER=dev and OTP_ALLOW_DEV=true in .env, restart the backend and run again.'); return; }

  const wrong = await call('POST', '/auth/phone/verify', null, { phone, code: '000000', mode: 'signup', name: 'Test User' });
  check('A wrong code is refused', wrong.status === 400);
  const noName = await call('POST', '/auth/phone/verify', null, { phone, code: sent.data.devCode, mode: 'signup' });
  check('Sign-up needs a name', noName.status === 400);
  const sent2 = await call('POST', '/auth/phone/send', null, { phone });
  check('Asking for codes too fast is refused', sent2.status === 429);
  const ok = await call('POST', '/auth/phone/verify', null, { phone, code: sent.data.devCode, mode: 'signup', name: 'Test User' });
  check('The right code creates the account and logs in', ok.status === 200 && ok.data.role === 'customer' && !!ok.data.token && ok.data.isNew === true, ok.data && ok.data.error);

  if (ok.status === 200) {
    const me = await call('GET', '/auth/me', ok.data.token);
    check('The phone login token works on the server', me.status === 200, 'status ' + me.status);
    const bad = await call('DELETE', '/account', ok.data.token, { confirm: 'nope' });
    check('Deleting needs the word DELETE', bad.status === 400);
    const del = await call('DELETE', '/account', ok.data.token, { confirm: 'DELETE' });
    check('The account is deleted', del.status === 200 && del.data.deleted === true);
    const after = await call('GET', '/auth/me', ok.data.token);
    check('The deleted account can no longer be used', after.status !== 200, 'status ' + after.status);
  }

  const admin = await call('POST', '/auth/login', null, { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check('The owner can log in', admin.status === 200 && admin.data.role === 'admin', admin.data && admin.data.error);
  if (admin.status === 200) {
    const t = admin.data.token;
    const ov = await call('GET', '/admin/overview?range=week', t);
    check('Overview has sales, hours and a 7-day series', ov.status === 200 && ov.data.hours.length === 24 && ov.data.series.length === 7, ov.data && ov.data.error);
    check('Top dishes', (await call('GET', '/admin/top-items?range=month', t)).status === 200);
    const carts = await call('GET', '/admin/carts', t);
    check('Carts list', carts.status === 200 && carts.data.length >= 1);
    check('Wallet audit', (await call('GET', '/admin/wallet', t)).status === 200);
  }
  const cust = await call('POST', '/auth/login', null, { email: 'student1@gmail.com', password: 'test1234' });
  if (cust.status === 200) check('A customer cannot open the owner dashboard', (await call('GET', '/admin/overview', cust.data.token)).status === 403);

  console.log(results.every(Boolean) ? 'RESULT: ALL PASS' : 'RESULT: SOMETHING FAILED, paste this output to Claude');
}
run().catch((e) => console.log('Error:', e.message));
