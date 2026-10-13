'use strict';

const path = require('node:path');
const dotenv = require('dotenv');
const { loadConfig } = require('./config');
const { createApp } = require('./app');

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false });
const config = loadConfig();
const app = createApp(config);
const server = app.listen(config.port, config.host, () => {
  console.log(`OtterHub Node VPS listening on http://${config.host}:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(() => {
    app.locals.store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 30_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
