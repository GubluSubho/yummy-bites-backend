const crypto = require('crypto');

const provider = () => String(process.env.OTP_PROVIDER || '').toLowerCase();
const secret = () => String(process.env.JWT_SECRET || '');

function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  const ten = digits.length >= 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

const hashCode = (phone, code) => crypto.createHmac('sha256', secret()).update(phone + ':' + code).digest('hex');
const newCode = () => String(crypto.randomInt(100000, 1000000));
// Twilio Verify makes and checks the code itself. The others use a code made here.
const isManaged = () => provider() === 'twilio';

function available() {
  const p = provider();
  if (p === 'twilio') return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SID);
  if (p === 'msg91') return !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID);
  if (p === 'dev') return process.env.OTP_ALLOW_DEV === 'true';
  return false;
}

async function twilio(path, params) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(sid + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64');
  const res = await fetch('https://verify.twilio.com/v2/Services/' + process.env.TWILIO_VERIFY_SID + path, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return { ok: res.ok, data: await res.json().catch(() => null) };
}

// Send the code. Returns { devCode } only in demo mode.
async function send(phone, code) {
  const p = provider();
  if (p === 'twilio') {
    const r = await twilio('/Verifications', { To: '+91' + phone, Channel: 'sms' });
    if (!r.ok) throw new Error('Twilio: ' + ((r.data && r.data.message) || 'could not send'));
    return {};
  }
  if (p === 'msg91') {
    const url =
      'https://control.msg91.com/api/v5/otp?template_id=' + encodeURIComponent(process.env.MSG91_TEMPLATE_ID) +
      '&mobile=91' + phone + '&authkey=' + encodeURIComponent(process.env.MSG91_AUTH_KEY) +
      '&otp=' + code + '&otp_expiry=5';
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.type === 'error')) throw new Error('MSG91: ' + ((data && data.message) || 'could not send'));
    return {};
  }
  if (p === 'dev') {
    console.log('[OTP demo mode] ' + phone + ' -> ' + code);
    return { devCode: code };
  }
  throw new Error('Phone login is not set up on the server yet');
}

async function checkManaged(phone, code) {
  const r = await twilio('/VerificationCheck', { To: '+91' + phone, Code: code });
  return r.ok && r.data && r.data.status === 'approved';
}

module.exports = { normalizePhone, hashCode, newCode, isManaged, available, send, checkManaged };
