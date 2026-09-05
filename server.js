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
  await database.collection('app_state').createIndex({ key: 1 }, { unique: true });

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

app.get('/api/state', async (req, res) => {
  try {
    const document = await database.collection('app_state').findOne({ key: 'main' });
    res.json({
      state: document?.state || null,
      updatedAt: document?.updatedAt || null
    });
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

    const updatedAt = new Date();

    await database.collection('app_state').updateOne(
      { key: 'main' },
      { $set: { state, updatedAt } },
      { upsert: true }
    );

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
