'use strict';
// Turns an encrypted Emergency Hub backup (.tar.gz.enc) back into a normal .tar.gz that 7-Zip can open.
//
//   node decrypt-backup.js <backup.tar.gz.enc> <64-character key>
//
// The key is the BACKUP_ENCRYPTION_KEY value from Render. Keep the decrypted file private: it holds resident data.
const fs = require('fs');
const crypto = require('crypto');

const [, , input, keyHex] = process.argv;
if (!input || !keyHex) { console.log('Usage: node decrypt-backup.js <file.tar.gz.enc> <64-character key>'); process.exit(1); }
if (!/^[a-f0-9]{64}$/i.test(keyHex)) { console.log('The key must be exactly 64 characters: digits 0-9 and letters a-f.'); process.exit(1); }

const MAGIC = Buffer.from('EHBK1');
const file = fs.readFileSync(input);
if (file.length < MAGIC.length + 12 + 16 + 1 || !file.subarray(0, MAGIC.length).equals(MAGIC)) {
  console.log('This is not an encrypted Emergency Hub backup (or the file is damaged).'); process.exit(1);
}
const iv = file.subarray(MAGIC.length, MAGIC.length + 12);
const tag = file.subarray(file.length - 16);
const body = file.subarray(MAGIC.length + 12, file.length - 16);
try {
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  d.setAuthTag(tag);
  const out = Buffer.concat([d.update(body), d.final()]);
  const target = input.replace(/\.enc$/i, '') + (/\.enc$/i.test(input) ? '' : '.decrypted.tar.gz');
  if (fs.existsSync(target)) { console.log(`Not overwriting ${target}. Move or delete it first.`); process.exit(1); }
  fs.writeFileSync(target, out, { mode: 0o600 });
  console.log(`Done: ${target}`);
} catch {
  console.log('Could not decrypt: the key is wrong, or the backup file is damaged.'); process.exit(1);
}