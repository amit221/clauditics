const path = require('path');
const express = require('express');
const { initDb } = require('./db');
const { getPort } = require('./config');
const eventsRouter = require('./routes/events');
const installRouter = require('./routes/install');
const statsRouter = require('./routes/stats');

const app = express();
app.use(express.json());

// Inject db into all requests
const db = initDb();
app.use((req, _res, next) => { req.db = db; next(); });

// Routes (install is unauthenticated, others have per-route auth)
app.use(installRouter);
app.use(eventsRouter);
app.use(statsRouter);

// Serve React UI if built
const UI_DIST = path.join(__dirname, '..', 'ui', 'dist');
try {
  require('fs').accessSync(UI_DIST);
  app.use(express.static(UI_DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(UI_DIST, 'index.html')));
} catch (_) {
  app.get('/', (_req, res) => res.json({ status: 'Clauditics dashboard running. UI not built yet.' }));
}

const port = getPort();
app.listen(port, () => {
  console.log(`Clauditics dashboard running on http://localhost:${port}`);
});

module.exports = app; // for testing
