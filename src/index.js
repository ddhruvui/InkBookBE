require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const routes = require('./routes');
const { mongoUri, dbName, assertNotProdLocally } = require('./db');

const app = express();

app.use(cors());
// The whole notebook is saved in one PUT /api/state call, so the JSON limit
// must accommodate the full dataset, not a single note.
app.use(express.json({ limit: '25mb' }));
app.use('/api', routes);

app.use((err, req, res, next) => {
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }
  // Honor client-error statuses attached by body-parser (400 malformed JSON,
  // 413 payload too large) instead of masking them as 500s.
  const status = err.status || err.statusCode;
  if (status && status >= 400 && status < 500) {
    return res.status(status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5001;

// Local safety net: only the Vercel deployment may open the prod database.
// A local server always runs on the test copy (default InkBookTest).
try {
  assertNotProdLocally();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

mongoose
  // dbName pins the database even when MONGO_URI has a path (the option wins
  // over the URI), so a local URI copied from prod can't reach prod either.
  .connect(mongoUri(), { dbName: dbName() })
  .then(() => {
    // Belt and braces: check the database the driver actually opened.
    try {
      assertNotProdLocally(mongoose.connection.name);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    app.listen(PORT, () => {
      console.log(`InkBook API listening on port ${PORT} · database "${dbName()}"`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
