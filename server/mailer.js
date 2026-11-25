'use strict';
/**
 * Email sender with two ways to deliver (no dependencies).
 *
 * 1) Brevo over HTTPS (port 443). Use this on Render's free plan, which blocks every SMTP port.
 *      BREVO_API_KEY=<API key from Brevo>
 *      MAIL_FROM="Barangay Rizal <verified-sender@gmail.com>"   (the address must be verified in Brevo;
 *                                                                 falls back to SMTP_FROM)
 * 2) Plain SMTP (port 465, encrypted from the start). Fine on your own computer or a paid host.
 *      SMTP_HOST=smtp.gmail.com  SMTP_PORT=465  SMTP_USER=you@gmail.com  SMTP_PASS=<app password>
 *      SMTP_FROM="Barangay Rizal <you@gmail.com>"      (optional, defaults to SMTP_USER)
 *
 * When BREVO_API_KEY is set, it is used and SMTP is ignored.
 */
const tls = require('tls');
const http = require('http');
const https = require('https');

const cfg = () => ({
  host: process.env.SMTP_HOST || '', port: parseInt(process.env.SMTP_PORT || '465', 10),
  user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  // only for automated tests with a self-signed certificate – never set this in real use
  selfSigned: process.env.SMTP_ALLOW_SELF_SIGNED === '1',
});
const apiKey = () => (process.env.BREVO_API_KEY || '').trim();
const apiFrom = () => (process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
const smtpReady = () => { const c = cfg(); return !!(c.host && c.user && c.pass && c.from); };
const enabled = () => !!(apiKey() && apiFrom()) || smtpReady();
const clean = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();           // blocks header injection
const addr = (s) => { const m = /<([^<>]+)>/.exec(s); return clean(m ? m[1] : s); };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function sendSmtp({ to, subject, text }) {
  const c = cfg();
  return new Promise((resolve, reject) => {
    if (!smtpReady()) return reject(new Error('Email is not set up'));
    const sock = tls.connect({ host: c.host, port: c.port, servername: c.host, rejectUnauthorized: !c.selfSigned });
    sock.setEncoding('utf8'); sock.setTimeout(20000, () => done(new Error('SMTP timeout')));
    let buf = '', step = 0, finished = false;
    const done = (err) => { if (finished) return; finished = true; try { sock.destroy(); } catch {} err ? reject(err) : resolve(); };
    const say = (l) => sock.write(l + '\r\n');
    const msg = [`From: ${clean(c.from)}`, `To: ${addr(to)}`, `Subject: ${clean(subject)}`, `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
      b64(text).replace(/(.{76})/g, '$1\r\n')].join('\r\n');
    const plan = [   // [command to send after the previous reply, expected reply code]
      () => say('EHLO emergency-hub'), () => say('AUTH LOGIN'), () => say(b64(c.user)), () => say(b64(c.pass)),
      () => say(`MAIL FROM:<${addr(c.from)}>`), () => say(`RCPT TO:<${addr(to)}>`), () => say('DATA'),
      () => say(msg.replace(/^\./gm, '..') + '\r\n.'), () => say('QUIT'),
    ];
    const expect = [220, 250, 334, 334, 235, 250, 250, 354, 250, 221];
    sock.on('error', done);
    sock.on('close', () => done(step >= plan.length ? null : new Error('SMTP connection closed early')));
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^\d{3}-/.test(line)) continue;                 // continuation of a multi-line reply
        const code = parseInt(line.slice(0, 3), 10);
        if (code !== expect[step]) return done(new Error(`SMTP error: ${line.slice(0, 120)}`));
        if (step >= plan.length) return done();
        plan[step++]();
      }
    });
  });
}

// ---- Brevo transactional email over HTTPS ---------------------------------------------------------
const RECIPIENT = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
function parseFrom(s) {            // "Barangay Rizal <me@x.com>"  ->  { name, email }
  const m = /^\s*"?([^"<]*?)"?\s*<([^<>]+)>\s*$/.exec(s);
  return m ? { name: clean(m[1]), email: clean(m[2]) } : { name: '', email: clean(s) };
}
function sendApi({ to, subject, text }) {
  return new Promise((resolve, reject) => {
    const from = parseFrom(apiFrom());
    if (!RECIPIENT.test(from.email)) return reject(new Error('MAIL_FROM is not a valid email address'));
    // BREVO_API_URL exists only so automated tests can point at a local fake server
    const u = new URL(process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email');
    const payload = JSON.stringify({
      sender: from.name ? { name: from.name, email: from.email } : { email: from.email },
      to: [{ email: addr(to) }], subject: clean(subject), textContent: String(text),
    });
    const req = (u.protocol === 'http:' ? http : https).request({
      hostname: u.hostname, port: u.port || undefined, path: u.pathname, method: 'POST', timeout: 10000,
      headers: { 'api-key': apiKey(), 'content-type': 'application/json', accept: 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      let out = ''; res.setEncoding('utf8'); res.on('data', (d) => { if (out.length < 2000) out += d; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve();
        let why = ''; try { why = JSON.parse(out).message || ''; } catch { /* not JSON */ }
        reject(new Error(`Brevo ${res.statusCode}${why ? ': ' + why.slice(0, 160) : ''}`));   // never includes the API key
      });
    });
    req.on('timeout', () => req.destroy(new Error('Brevo timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

function send(mail) {
  if (!enabled()) return Promise.reject(new Error('Email is not set up'));
  if (!RECIPIENT.test(mail.to)) return Promise.reject(new Error('Bad recipient'));
  return apiKey() ? sendApi(mail) : sendSmtp(mail);
}
module.exports = { enabled, send };
