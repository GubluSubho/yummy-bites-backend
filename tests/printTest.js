const { PDFDocument } = require('pdf-lib');
const BASE = process.env.API || 'http://127.0.0.1:5000/api';

async function call(method, path, token, body, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
  if (token) h.Authorization = 'Bearer ' + token;
  const isRaw = body instanceof Uint8Array;
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body) });
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
  const jumbo = await call('POST', '/auth/login', null, { email: 'jumbo.manager@test.com', password: 'Manager123' });
  const nescafe = await call('POST', '/auth/login', null, { email: 'nescafe.manager@test.com', password: 'Manager123' });
  if (cust.status !== 200 || jumbo.status !== 200 || nescafe.status !== 200) {
    console.log('Could not log in. Is the local backend running with the local database?');
    return;
  }
  const ct = cust.data.token;
  const rid = jumbo.data.restaurantId;

  const cfg = await call('GET', '/print/config/' + rid, ct);
  check('Jumbo runs the print shop', cfg.status === 200 && cfg.data.enabled === true, cfg.data && JSON.stringify({ bw: cfg.data.bwPerPage, color: cfg.data.colorPerPage }));
  const off = await call('GET', '/print/config/' + nescafe.data.restaurantId, ct);
  check('Other carts do not', off.data && off.data.enabled === false);

  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) pdf.addPage();
  const bytes = await pdf.save();
  const up = await call('POST', '/print/upload', ct, bytes, { 'Content-Type': 'application/pdf', 'X-File-Name': 'test.pdf' });
  check('A 3-page PDF is uploaded and its pages counted', up.status === 200 && up.data.pages === 3 && up.data.pagesExact === true, 'pages ' + (up.data && up.data.pages));
  const fileId = up.data.fileId;

  const junk = await call('POST', '/print/upload', ct, new TextEncoder().encode('this is not a document at all, just plain words'.repeat(5)), { 'X-File-Name': 'a.pdf' });
  check('A fake file is refused', junk.status === 400, junk.data && junk.data.error);

  const quote = (job, service) => call('POST', '/print/quote', ct, { restaurantId: rid, service: service || 'print', job });
  const q1 = await quote({ fileId, copies: 2, color: 'bw', orientation: 'portrait' });
  check('3 pages, B&W, 2 copies = 30', q1.status === 200 && q1.data.price === 30, 'price ' + (q1.data && q1.data.price));
  const q2 = await quote({ fileId, copies: 1, color: 'color', orientation: 'landscape' });
  check('3 pages, colour = 30', q2.data.price === 30);
  const q3 = await quote({ fileId, copies: 1, color: 'bw', range: '1-2' });
  check('Pages 1-2 only = 10', q3.data.price === 10);
  const q4 = await quote({ fileId, copies: 1, color: 'bw', range: '1-9' });
  check('A page range past the end is refused', q4.status === 400);
  const q5 = await quote({ fileId, copies: 0, color: 'bw' });
  check('Zero copies is refused', q5.status === 400);
  const q6 = await quote({ type: 'spiral', pages: 20 }, 'binding');
  check('Spiral binding of 20 pages = 30', q6.status === 200 && q6.data.price === 30, 'price ' + (q6.data && q6.data.price));
  const q7 = await quote({ pages: 4 }, 'lamination');
  check('Lamination of 4 pages = 60', q7.status === 200 && q7.data.price === 60, 'price ' + (q7.data && q7.data.price));

  const order = await call('POST', '/orders', ct, {
    restaurantId: rid, paymentMethod: 'upi',
    items: [{ service: 'print', job: { fileId, copies: 2, color: 'bw' } }, { service: 'lamination', job: { pages: 2 } }],
  });
  check('An order with a print job and lamination is placed (total 60)', order.status === 201 && order.data.total === 60, order.data && (order.data.error || 'total ' + order.data.total));

  if (order.status === 201) {
    const id = order.data.orderId;
    const link = await call('GET', '/print/link/' + id + '/0', jumbo.data.token);
    check("The Jumbo manager gets a link to the customer's file", link.status === 200 && !!link.data.url);
    if (link.status === 200) {
      const file = await fetch(link.data.url);
      const got = Buffer.from(await file.arrayBuffer());
      check('The link serves the same PDF', file.status === 200 && (file.headers.get('content-type') || '').includes('pdf') && got.length === bytes.length);
      const bad = await fetch(link.data.url.replace(/sig=.{6}/, 'sig=000000'));
      check('A tampered link is refused', bad.status === 403);
    }
    const other = await call('GET', '/print/link/' + id + '/0', nescafe.data.token);
    check("Another cart's manager cannot open the file", other.status === 403);
    await call('POST', '/payment/abandon', ct, { orderId: id });
  }

  console.log(results.every(Boolean) ? 'RESULT: ALL PASS' : 'RESULT: SOMETHING FAILED, paste this output to Claude');
}

run().catch((e) => console.log('Error:', e.message));
