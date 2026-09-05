const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'autofab_team_terminal';
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!MONGODB_URI) {
  console.error('MONGODB_URI is missing. Add it to the .env file.');
  process.exit(1);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// File Upload Configuration
const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, UPLOAD_DIR),
  filename: (req, file, callback) => {
    const safeExtension = path.extname(file.originalname).slice(0, 20);
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}${safeExtension}`;
    callback(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let mongoClient;
let database;

async function connectDatabase() {
  mongoClient = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000
  });

  await mongoClient.connect();
  database = mongoClient.db(DB_NAME);
  await database.command({ ping: 1 });
  console.log(`MongoDB connected: ${DB_NAME}`);
}

app.get('/api/health', async (req, res) => {
  try {
    if (!database) throw new Error('Database is not initialized.');
    await database.command({ ping: 1 });
    res.json({ ok: true, database: 'online', time: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'offline', message: error.message });
  }
});

// Create File
app.post('/api/files', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file received.' });
    }

    const fileRecord = {
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimeType: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
      uploadedAt: new Date()
    };

    const result = await database.collection('uploaded_files').insertOne(fileRecord);

    res.status(201).json({
      id: result.insertedId.toString(),
      name: fileRecord.originalName,
      type: fileRecord.mimeType,
      bytes: fileRecord.size
    });
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    console.error('File upload failed:', error.message);
    res.status(500).json({ error: 'File upload failed.' });
  }
});

// Read File
app.get('/api/files/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).send('Invalid file ID.');
    }

    const fileRecord = await database.collection('uploaded_files').findOne({
      _id: new ObjectId(req.params.id)
    });

    if (!fileRecord) return res.status(404).send('File not found.');

    const filePath = path.join(UPLOAD_DIR, fileRecord.storedName);
    if (!fs.existsSync(filePath)) return res.status(404).send('Stored file is missing.');

    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', fileRecord.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(fileRecord.originalName)}`
    );
    res.sendFile(filePath);
  } catch (error) {
    console.error('File open failed:', error.message);
    res.status(500).send('Unable to open file.');
  }
});

// Delete File
app.delete('/api/files/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid file ID.' });
    
    const fileRecord = await database.collection('uploaded_files').findOne({ _id: new ObjectId(req.params.id) });
    if (!fileRecord) return res.status(404).json({ error: 'File not found.' });

    const filePath = path.join(UPLOAD_DIR, fileRecord.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await database.collection('uploaded_files').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (error) {
    console.error('File deletion failed:', error.message);
    res.status(500).json({ error: 'Unable to delete file.' });
  }
});

// Normalized Data Architecture
app.get('/api/state', async (req, res) => {
  try {
    const [meta, channels, messages, tasks, tickets] = await Promise.all([
      database.collection('app_state_meta').findOne({ key: 'main' }),
      database.collection('app_channels').findOne({ key: 'main' }),
      database.collection('app_messages').findOne({ key: 'main' }),
      database.collection('app_tasks').findOne({ key: 'main' }),
      database.collection('app_tickets').findOne({ key: 'main' })
    ]);

    const state = {
      ...(meta?.data || {}),
      channels: channels?.data || null,
      messages: messages?.data || null,
      tasks: tasks?.data || null,
      tickets: tickets?.data || null
    };

    res.json({ state, updatedAt: meta?.updatedAt || null });
  } catch (error) {
    console.error('Load state failed:', error.message);
    res.status(500).json({ error: 'Unable to load application data.' });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    const state = req.body;

    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return res.status(400).json({ error: 'Invalid application state.' });
    }

    const { channels, messages, tasks, tickets, ...metaData } = state;
    const updatedAt = new Date();

    await Promise.all([
      database.collection('app_channels').updateOne({ key: 'main' }, { $set: { data: channels } }, { upsert: true }),
      database.collection('app_messages').updateOne({ key: 'main' }, { $set: { data: messages } }, { upsert: true }),
      database.collection('app_tasks').updateOne({ key: 'main' }, { $set: { data: tasks } }, { upsert: true }),
      database.collection('app_tickets').updateOne({ key: 'main' }, { $set: { data: tickets } }, { upsert: true }),
      database.collection('app_state_meta').updateOne({ key: 'main' }, { $set: { data: metaData, updatedAt } }, { upsert: true })
    ]);

    res.json({ ok: true, updatedAt });
  } catch (error) {
    console.error('Save state failed:', error.message);
    res.status(500).json({ error: 'Unable to save application data.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function startServer() {
  try {
    await connectDatabase();
    app.listen(PORT, HOST, () => {
      console.log(`Autofab Terminal running at http://localhost:${PORT}`);
      console.log(`Network access enabled at http://${HOST}:${PORT}`);
    });
  } catch (error) {
    console.error('Server startup failed:', error.message);
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`\n${signal} received. Closing server...`);
  try {
    if (mongoClient) await mongoClient.close();
  } catch (error) {
    console.error('Shutdown error:', error.message);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();