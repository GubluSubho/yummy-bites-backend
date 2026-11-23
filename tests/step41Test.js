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
  const other = await call('POST', '/auth/login', null, { email: 'nescafe.manager@test.com', password: 'Manager123' });
  if (cust.status !== 200 || mgr.status !== 200 || other.status !== 200) {
    console.log('Could not log in. Is the local backend running?');
    return;
  }

  const noAuth = await call('POST', '/push/register', null, { token: 'x' });
  check('Registering without logging in is refused', noAuth.status === 401);
  const bad = await call('POST', '/push/register', cust.data.token, { token: 'not-a-token' });
  check('A malformed token is refused', bad.status === 400);
  const fake = 'ExponentPushToken[abcdefghijklmnopqrstuvwxyz]';
  const good = await call('POST', '/push/register', cust.data.token, { token: fake, platform: 'android' });
  check('A valid token is stored', good.status === 200);
  const again = await call('POST', '/push/register', cust.data.token, { token: fake, platform: 'android' });
  check('Registering the same token twice is fine', again.status === 200);
  const gone = await call('POST', '/push/unregister', cust.data.token, { token: fake });
  check('The token can be removed', gone.status === 200);

  const restaurantId = mgr.data.restaurantId;
  const menu = (await call('GET', '/menu/' + restaurantId)).data;
  const item = menu[0];
  const startRev = item.imageRev || 0;

  const notJpeg = Buffer.alloc(2000, 65).toString('base64');
  const r1 = await call('PUT', '/menu/' + item._id + '/image', mgr.data.token, { image: notJpeg });
  check('A non-JPEG file is refused', r1.status === 400);

  const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]);
  const r2 = await call('PUT', '/menu/' + item._id + '/image', mgr.data.token, { image: fakeJpeg.toString('base64') });
  check('A photo is stored for the dish', r2.status === 200 && r2.data.hasImage === true && r2.data.imageRev === startRev + 1);

  const img = await fetch(BASE + '/menu/' + item._id + '/image');
  const bytes = Buffer.from(await img.arrayBuffer());
  check('The photo is served back unchanged',
    img.status === 200 && (img.headers.get('content-type') || '').startsWith('image/jpeg') && bytes.length === fakeJpeg.length);

  const r3 = await call('PUT', '/menu/' + item._id + '/image', other.data.token, { image: fakeJpeg.toString('base64') });
  check("Another cart's manager cannot change it", r3.status === 403);

  const r4 = await call('DELETE', '/menu/' + item._id + '/image', mgr.data.token);
  check('The photo can be removed', r4.status === 200 && r4.data.hasImage === false && r4.data.imageRev === startRev + 2);

  const img2 = await fetch(BASE + '/menu/' + item._id + '/image');
  check('A removed photo is gone', img2.status === 404);

  console.log(results.every(Boolean) ? 'RESULT: ALL PASS' : 'RESULT: SOMETHING FAILED, paste this output to Claude');
}

run().catch((e) => console.log('Error:', e.message));
