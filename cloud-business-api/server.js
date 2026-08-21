'use strict';

const { Pool } = require('pg');
const { createCloudBusinessApp } = require('./src/app');

const port = Number(process.env.PORT || 3002);
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'gewu-postgres17',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'gewu_cloud',
  user: process.env.POSTGRES_USER || 'gewu_app',
  password: process.env.POSTGRES_PASSWORD,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});
const app = createCloudBusinessApp({ query: (text, values) => pool.query(text, values) });
const server = app.listen(port, '0.0.0.0', () => console.log(`cloud business API listening on ${port}`));

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
