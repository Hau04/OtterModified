'use strict';

const path = require('node:path');
const dotenv = require('dotenv');
const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { DatabaseStore } = require('./database');

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false });

async function startServer() {
  const config = loadConfig();
  const store = await DatabaseStore.open(config.databasePath);
  const app = createApp(config, { store });
  const server = app.listen(config.port, config.host, () => {
    console.log(`OtterHub Node VPS listening on http://${config.host}:${config.port}`);
  });

  function shutdown(signal) {
    console.log(`${signal} received; shutting down`);
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 30_000).unref();
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
