const express = require('express');
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'autofab_team_terminal';

if (!MONGODB_URI) {
  console.error('MONGODB_URI is missing. Copy .env.example to .env and add your connection string.');
  process.exit(1);
}

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let client;
let db;
async function connectDatabase() {
  client = new MongoClient(MONGODB_URI, { maxPoolSize: 10 });
  await client.connect();
  db = client.db(DB_NAME);
  await db.collection('app_state').createIndex({ key: 1 }, { unique: true });
  console.log(`MongoDB connected: ${DB_NAME}`);
}

app.get('/api/health', async (req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ ok: true, database: 'online', time: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'offline' });
  }
});

app.get('/api/state', async (req, res) => {
  try {
    const doc = await db.collection('app_state').findOne({ key: 'main' });
    res.json({ state: doc?.state || null, updatedAt: doc?.updatedAt || null });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load application data.' });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    const state = req.body;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return res.status(400).json({ error: 'Invalid application state.' });
    }
    const updatedAt = new Date();
    await db.collection('app_state').updateOne(
      { key: 'main' },
      { $set: { state, updatedAt } },
      { upsert: true }
    );
    res.json({ ok: true, updatedAt });
  } catch (error) {
    res.status(500).json({ error: 'Unable to save application data.' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

connectDatabase()
  .then(() => app.listen(PORT, () => console.log(`Autofab Terminal: http://localhost:${PORT}`)))
  .catch(error => {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  });

async function shutdown() {
  if (client) await client.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
