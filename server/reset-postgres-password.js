require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

async function resetPassword() {
  try {
    const newPassword = 'ehbr2026';

    await pool.query(
      `ALTER ROLE postgres WITH PASSWORD '${newPassword.replace(/'/g, "''")}'`
    );

    console.log('Password reset successful.');
  } catch (err) {
    console.error(err.message);
  } finally {
    await pool.end();
  }
}

resetPassword();