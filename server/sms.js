'use strict';
/** SMS through Twilio. Off until TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER are set. */
const cfg = () => ({ sid: process.env.TWILIO_ACCOUNT_SID || '', token: process.env.TWILIO_AUTH_TOKEN || '', from: process.env.TWILIO_FROM_NUMBER || '' });
const enabled = () => { const c = cfg(); return !!(c.sid && c.token && c.from); };

// 09XXXXXXXXX -> +639XXXXXXXXX (Twilio needs E.164)
function toE164(n) {
  const d = String(n || '').replace(/[\s\-()]/g, '');
  if (/^\+\d{8,15}$/.test(d)) return d;
  if (/^09\d{9}$/.test(d)) return '+63' + d.slice(1);
  if (/^63\d{10}$/.test(d)) return '+' + d;
  return null;
}

let client = null;
async function send(to, body) {
  const c = cfg();
  if (!enabled()) throw new Error('SMS is not set up');
  const number = toE164(to);
  if (!number) throw new Error('Not a valid phone number');
  if (!client) client = require('twilio')(c.sid, c.token);
  const m = await client.messages.create({ to: number, from: c.from, body: String(body).slice(0, 300) });
  return m.sid;
}
module.exports = { enabled, send, toE164 };