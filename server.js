const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const EJSON = require('ejson');

// Simple in-memory client reference; single-tenant local tool
let mongoClient = null;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static frontend
const path = require('path');
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

function ensureConnected(req, res) {
  if (!mongoClient) {
    res.status(400).json({ error: 'Not connected. POST /api/connect with { uri } first.' });
    return false;
  }
  return true;
}

function parseJsonOrEjson(str, fallback = {}) {
  if (!str) return fallback;
  try {
    return EJSON.parse(str);
  } catch (e) {
    try {
      return JSON.parse(str);
    } catch (err) {
      return fallback;
    }
  }
}

function toObjectIdIfPossible(id) {
  if (typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)) {
    try { return new ObjectId(id); } catch (_) { /* noop */ }
  }
  return id;
}

app.post('/api/connect', async (req, res) => {
  const { uri, options } = req.body || {};
  if (!uri) {
    return res.status(400).json({ error: 'Missing uri' });
  }
  try {
    if (mongoClient) {
      try { await mongoClient.close(); } catch (_) {}
      mongoClient = null;
    }
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, ...(options || {}) });
    await client.connect();
    // quick ping
    await client.db('admin').command({ ping: 1 });
    mongoClient = client;
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/api/disconnect', async (req, res) => {
  try {
    if (mongoClient) {
      await mongoClient.close();
      mongoClient = null;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/api/databases', async (req, res) => {
  if (!ensureConnected(req, res)) return;
  try {
    const adminDb = mongoClient.db().admin();
    const result = await adminDb.listDatabases({ nameOnly: false });
    res.json({ databases: result.databases });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/api/databases/:db/collections', async (req, res) => {
  if (!ensureConnected(req, res)) return;
  try {
    const { db } = req.params;
    const collections = await mongoClient.db(db).listCollections().toArray();
    res.json({ collections });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/api/databases/:db/collections/:coll/documents', async (req, res) => {
  if (!ensureConnected(req, res)) return;
  try {
    const { db, coll } = req.params;
    const filter = parseJsonOrEjson(req.query.filter, {});
    const sort = parseJsonOrEjson(req.query.sort, undefined);
    const projection = parseJsonOrEjson(req.query.projection, undefined);
    const skip = Math.max(0, parseInt(req.query.skip || '0', 10) || 0);
    const limit = Math.min(2000, Math.max(0, parseInt(req.query.limit || '50', 10) || 50));

    const collection = mongoClient.db(db).collection(coll);
    let cursor = collection.find(filter, { projection });
    if (sort) cursor = cursor.sort(sort);
    if (skip) cursor = cursor.skip(skip);
    if (limit) cursor = cursor.limit(limit);

    const documents = await cursor.toArray();
    res.json({ documents: EJSON.serialize(documents) });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/api/databases/:db/collections/:coll/documents', async (req, res) => {
  if (!ensureConnected(req, res)) return;
  try {
    const { db, coll } = req.params;
    const body = req.body || {};
    const doc = EJSON.deserialize(body);
    const collection = mongoClient.db(db).collection(coll);
    const result = await collection.insertOne(doc);
    res.json({ insertedId: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.put('/api/databases/:db/collections/:coll/documents/:id', async (req, res) => {
  if (!ensureConnected(req, res)) return;
  try {
    const { db, coll, id } = req.params;
    const body = req.body || {};
    const replacement = EJSON.deserialize(body);
    const collection = mongoClient.db(db).collection(coll);
    const _id = toObjectIdIfPossible(id);
    const result = await collection.replaceOne({ _id }, replacement, { upsert: false });
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.patch('/api/databases/:db/collections/:coll/documents/:id', async (req, res) => {
  if (!ensureConnected(req, res)) return;
  try {
    const { db, coll, id } = req.params;
    const updateDoc = EJSON.deserialize(req.body || {});
    const collection = mongoClient.db(db).collection(coll);
    const _id = toObjectIdIfPossible(id);
    const result = await collection.updateOne({ _id }, updateDoc);
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.delete('/api/databases/:db/collections/:coll/documents/:id', async (req, res) => {
  if (!ensureConnected(req, res)) return;
  try {
    const { db, coll, id } = req.params;
    const collection = mongoClient.db(db).collection(coll);
    const _id = toObjectIdIfPossible(id);
    const result = await collection.deleteOne({ _id });
    res.json({ deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/api/databases/:db/collections/:coll/import', async (req, res) => {
  if (!ensureConnected(req, res)) return;
  try {
    const { db, coll } = req.params;
    const body = req.body;
    let docs = [];
    if (Array.isArray(body)) {
      docs = EJSON.deserialize(body);
    } else if (body && Array.isArray(body.documents)) {
      docs = EJSON.deserialize(body.documents);
    } else if (typeof body === 'string') {
      docs = EJSON.parse(body);
      docs = EJSON.deserialize(docs);
    } else {
      return res.status(400).json({ error: 'Provide an array of documents as JSON/EJSON' });
    }
    const collection = mongoClient.db(db).collection(coll);
    const result = await collection.insertMany(docs);
    res.json({ insertedCount: result.insertedCount });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/api/databases/:db/collections/:coll/export', async (req, res) => {
  if (!ensureConnected(req, res)) return;
  try {
    const { db, coll } = req.params;
    const filter = parseJsonOrEjson(req.query.filter, {});
    const collection = mongoClient.db(db).collection(coll);
    const documents = await collection.find(filter).toArray();
    const ejson = EJSON.stringify(documents, null, 2);
    res.setHeader('Content-Disposition', `attachment; filename="${db}_${coll}_export.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(ejson);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Fallback to index.html for SPA routing using regex to avoid path-to-regexp issues
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mongo Dashboard listening on http://localhost:${PORT}`);
});

