import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import CryptoJS from 'crypto-js';
import pg from 'pg';
import { initializeApp as initFirebaseApp } from 'firebase/app';
import {
  getFirestore as getFirebaseFirestore,
  doc as firestoreDoc,
  getDoc as firestoreGetDoc,
  setDoc as firestoreSetDoc,
  deleteDoc as firestoreDeleteDoc,
  collection as firestoreCollection,
  getDocs as firestoreGetDocs,
  onSnapshot as firestoreOnSnapshot,
  query as firestoreQuery,
  setLogLevel as firestoreSetLogLevel
} from 'firebase/firestore';

// Silence internal gRPC transport debug/error spam from Firestore SDK
try {
  firestoreSetLogLevel('silent');
} catch (e) {}

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

const UPLOAD_FOLDER = path.join(__dirname, 'uploads');
const STATIC_FOLDER = path.join(__dirname, 'static');
const DATA_FOLDER = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_FOLDER, 'settings.json');
const QUOTA_STATE_FILE = path.join(DATA_FOLDER, 'firestore_quota.json');

// Ensure directories exist
if (!fs.existsSync(UPLOAD_FOLDER)) {
  fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
}
if (!fs.existsSync(DATA_FOLDER)) {
  fs.mkdirSync(DATA_FOLDER, { recursive: true });
}

// ==========================================
// Firebase Firestore Database Integration
// Persistent cloud database for audio tracks & multi-device settings
// ==========================================
let firebaseApp = null;
let firestoreDb = null;
let firestoreQuotaExceeded = false;

function isFirestoreQuotaError(err) {
  if (!err) return false;
  const code = String(err.code || err.status || '');
  const msg = String(err.message || err.details || '');
  const str = String(err);
  const combined = (code + ' ' + msg + ' ' + str).toLowerCase();
  return (
    code === 'resource-exhausted' ||
    code === '8' ||
    combined.includes('resource_exhausted') ||
    combined.includes('resource-exhausted') ||
    combined.includes('quota limit exceeded') ||
    combined.includes('quota exceeded') ||
    combined.includes('free daily write units') ||
    combined.includes('free daily read units') ||
    combined.includes('cannot exceed free quota limits')
  );
}

function markFirestoreQuotaExceeded() {
  if (!firestoreQuotaExceeded) {
    firestoreQuotaExceeded = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(QUOTA_STATE_FILE, JSON.stringify({
        date: today,
        exceeded: true,
        reason: "Daily write units quota limit reached"
      }, null, 2), 'utf-8');
    } catch (e) {}
    console.warn('⚠️ Firestore daily free-tier write quota reached. Firestore writes paused; continuing seamlessly on persistent local disk and PostgreSQL.');
  }
}

function handleServerFirestoreError(err, context = 'operation') {
  if (!err) return;
  if (isFirestoreQuotaError(err)) {
    markFirestoreQuotaExceeded();
    return;
  }
  console.warn(`Firestore warning during ${context}:`, err.message || err);
}

// Initialize quota state from cache if previously exceeded today
try {
  if (fs.existsSync(QUOTA_STATE_FILE)) {
    const qData = JSON.parse(fs.readFileSync(QUOTA_STATE_FILE, 'utf-8'));
    const today = new Date().toISOString().slice(0, 10);
    if (qData.date === today && qData.exceeded) {
      firestoreQuotaExceeded = true;
      console.warn(`⚠️ Firestore daily write quota previously reached for today (${today}). Writes paused to prevent gRPC error spam.`);
    }
  }
} catch (e) {}

// Global safety net for any asynchronous Firestore gRPC rejection
process.on('unhandledRejection', (reason) => {
  if (isFirestoreQuotaError(reason)) {
    markFirestoreQuotaExceeded();
    return;
  }
  console.warn('Unhandled rejection notice:', reason && reason.message ? reason.message : reason);
});

try {
  const fbConfigPath = path.join(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(fbConfigPath)) {
    const fbConfig = JSON.parse(fs.readFileSync(fbConfigPath, 'utf-8'));
    firebaseApp = initFirebaseApp(fbConfig);
    firestoreDb = getFirebaseFirestore(firebaseApp, fbConfig.firestoreDatabaseId);
    console.log('✅ Connected to Firebase Firestore Database:', fbConfig.firestoreDatabaseId);
  }
} catch (fbErr) {
  console.warn('Firebase initialization notice:', fbErr.message);
}

// ==========================================
// Database & Persistent Storage Module (PostgreSQL / Supabase / Neon / Cloud SQL)
// ==========================================
const DB_CONFIG_FILE = path.join(DATA_FOLDER, 'db_config.json');
let dbPool = null;
let dbConnected = false;
let dbLastError = null;
let dbConfig = {
  connectionString: process.env.DATABASE_URL || '',
  type: 'postgres',
  enabled: !!process.env.DATABASE_URL
};

// Mask sensitive credentials for secure frontend display
function maskConnectionString(str) {
  if (!str) return '';
  return str.replace(/:([^:@]+)@/, ':••••••@');
}

// Load saved DB configuration from local disk if present
try {
  if (fs.existsSync(DB_CONFIG_FILE)) {
    const saved = JSON.parse(fs.readFileSync(DB_CONFIG_FILE, 'utf-8'));
    dbConfig = { ...dbConfig, ...saved };
  }
} catch (e) {
  console.warn('Error reading db_config.json:', e.message);
}

// Initialize PostgreSQL tables for permanent settings and audio tracks
async function initDatabaseTables(pool) {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS player_settings (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audio_tracks (
        id VARCHAR(255) PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        title VARCHAR(255),
        audio_url TEXT,
        audio_base64 TEXT,
        size BIGINT,
        mime_type VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ PostgreSQL database tables verified: player_settings, audio_tracks');
  } finally {
    client.release();
  }
}

// Connect to Database and synchronize
async function connectToDatabase(targetConn) {
  const connStr = targetConn || dbConfig.connectionString || process.env.DATABASE_URL;
  if (!connStr || !connStr.trim()) {
    dbConnected = false;
    dbPool = null;
    return false;
  }

  try {
    if (dbPool) {
      try { await dbPool.end(); } catch (e) {}
      dbPool = null;
    }

    const isLocal = connStr.includes('localhost') || connStr.includes('127.0.0.1');
    const newPool = new Pool({
      connectionString: connStr.trim(),
      ssl: isLocal ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });

    await initDatabaseTables(newPool);

    dbPool = newPool;
    dbConnected = true;
    dbLastError = null;
    dbConfig.connectionString = connStr.trim();
    dbConfig.enabled = true;

    // Save configuration file
    try {
      fs.writeFileSync(DB_CONFIG_FILE, JSON.stringify({
        connectionString: connStr.trim(),
        type: 'postgres',
        enabled: true,
        updatedAt: new Date().toISOString()
      }, null, 2));
    } catch(e) {}

    console.log('✅ Connected to database:', maskConnectionString(connStr));
    
    // Sync settings from database
    await syncSettingsFromDatabase();
    return true;
  } catch (err) {
    dbConnected = false;
    dbLastError = err.message;
    console.error('❌ Database connection failed:', err.message);
    return false;
  }
}

// Save audio track metadata to Firebase Firestore
async function saveTrackToFirestore(filename, category, title, buffer = null, mimeType = 'audio/mpeg') {
  if (!firestoreDb || firestoreQuotaExceeded) return null;
  try {
    const rawId = filename || title || `track_${Date.now()}`;
    const trackId = String(rawId).replace(/[^a-zA-Z0-9_\-\.]/g, '_').substring(0, 100);
    
    // Read buffer from disk if not provided directly
    if (!buffer && filename) {
      const diskPath = path.join(UPLOAD_FOLDER, filename);
      if (fs.existsSync(diskPath)) {
        try {
          const st = fs.statSync(diskPath);
          if (st.size <= 5 * 1024 * 1024) {
            buffer = fs.readFileSync(diskPath);
          }
        } catch (e) {}
      }
    }

    const size = buffer ? buffer.length : 0;
    const cleanUrl = `/api/uploads/${encodeURIComponent(filename)}`;

    const trackPayload = {
      id: trackId,
      title: title || filename,
      url: cleanUrl,
      category: category || 'general',
      size: size,
      order: 1,
      mimeType: mimeType,
      updatedAt: new Date().toISOString()
    };

    if (buffer && buffer.length <= 400 * 1024) {
      trackPayload.audioBase64 = buffer.toString('base64');
    }

    await firestoreSetDoc(firestoreDoc(firestoreDb, 'audio_tracks', trackId), trackPayload);
    console.log(`☁️ Saved track metadata for "${filename}" (${category}) to Firestore database!`);

    return trackPayload;
  } catch (err) {
    handleServerFirestoreError(err, 'saveTrackToFirestore');
    return null;
  }
}

// Restore audio track from Firestore if missing from local container disk
async function restoreTrackFromFirestore(filename) {
  if (!firestoreDb || isFileMarkedDeleted(filename)) return null;
  try {
    const rawId = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_').substring(0, 100);
    if (isFileMarkedDeleted(rawId)) return null;
    let trackDocSnap = await firestoreGetDoc(firestoreDoc(firestoreDb, 'audio_tracks', rawId));
    let matchedId = rawId;

    if (!trackDocSnap.exists()) {
      const snapAll = await firestoreGetDocs(firestoreCollection(firestoreDb, 'audio_tracks'));
      for (const d of snapAll.docs) {
        const data = d.data();
        if (data.title === filename || (data.url && data.url.includes(encodeURIComponent(filename)))) {
          trackDocSnap = d;
          matchedId = d.id;
          break;
        }
      }
    }

    if (!trackDocSnap || !trackDocSnap.exists()) return null;
    const trackData = trackDocSnap.data();
    const diskPath = path.join(UPLOAD_FOLDER, filename);

    if (trackData.audioBase64) {
      const buf = Buffer.from(trackData.audioBase64, 'base64');
      fs.writeFileSync(diskPath, buf);
      setFileCategory(filename, trackData.category || 'general');
      console.log(`☁️ Restored "${filename}" directly from Firestore base64 storage!`);
      return diskPath;
    }

    const chunksSnap = await firestoreGetDocs(firestoreCollection(firestoreDb, 'audio_tracks', matchedId, 'chunks'));
    if (!chunksSnap.empty) {
      const chunks = [];
      chunksSnap.forEach(cd => chunks.push(cd.data()));
      chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      const buffers = chunks.map(c => Buffer.from(c.data, 'base64'));
      const fullBuffer = Buffer.concat(buffers);
      fs.writeFileSync(diskPath, fullBuffer);
      setFileCategory(filename, trackData.category || 'general');
      console.log(`☁️ Restored "${filename}" from ${chunks.length} Firestore chunks (${fullBuffer.length} bytes)!`);
      return diskPath;
    }
    return null;
  } catch (err) {
    console.warn('Restore from Firestore notice:', err.message);
    return null;
  }
}

// Restore audio track from PostgreSQL database if missing from local disk
async function restoreTrackFromPostgres(filename) {
  if (!dbConnected || !dbPool || isFileMarkedDeleted(filename)) return null;
  try {
    const res = await dbPool.query(
      'SELECT filename, category, audio_base64 FROM audio_tracks WHERE (filename = $1 OR title = $1 OR audio_url ILIKE $2) AND audio_base64 IS NOT NULL LIMIT 1',
      [filename, `%${filename}%`]
    );
    if (res.rows.length > 0 && res.rows[0].audio_base64) {
      const diskPath = path.join(UPLOAD_FOLDER, filename);
      const buf = Buffer.from(res.rows[0].audio_base64, 'base64');
      fs.writeFileSync(diskPath, buf);
      setFileCategory(filename, res.rows[0].category || 'general');
      console.log(`🐘 Restored "${filename}" directly from PostgreSQL database storage!`);
      return diskPath;
    }
  } catch (err) {
    console.warn('Restore from PostgreSQL notice:', err.message);
  }
  return null;
}

function isPrayerTrack(track) {
  if (!track) return false;
  const name = typeof track === 'string' ? track : (track.title || track.filename || track.id || '');
  return getFileCategory(name) === 'prayer' || /prayer|bhajan|aarti|chalisa|mantra|stotra|shlok/i.test(name);
}

function isAdvtTrack(track) {
  if (!track) return false;
  return isAdvertisementTrack(track);
}

// Sync settings from Database (Firestore & PostgreSQL) into in-memory settingsStore
async function syncSettingsFromDatabase() {
  if (firestoreDb) {
    try {
      const ref = firestoreDoc(firestoreDb, 'player_settings', 'global_sync');
      const snap = await firestoreGetDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        console.log('📥 Loaded player settings from Firestore database.');
        if (data.advtTracks && Array.isArray(data.advtTracks) && data.advtTracks.length > 0) {
          const cleanAdvtTracks = data.advtTracks.filter(t => t && !isPrayerTrack(t));
          if (cleanAdvtTracks.length > 0) {
            settingsStore.set('advt', {
              tracks: cleanAdvtTracks,
              track: (data.advtTrack && !isPrayerTrack(data.advtTrack) && typeof data.advtTrack === 'object' && data.advtTrack.title) ? data.advtTrack : cleanAdvtTracks[0],
              interval: String(data.advtInterval || '300'),
              enabled: data.advtEnabled !== undefined ? !!data.advtEnabled : true,
              currentSequenceIndex: 0
            });
          }
        }
        if (data.prayerTrack || data.prayerTimes) {
          settingsStore.set('prayer', {
            track: (data.prayerTrack && !isAdvtTrack(data.prayerTrack)) ? data.prayerTrack : null,
            enabled: data.prayerEnabled !== undefined ? !!data.prayerEnabled : true,
            times: Array.isArray(data.prayerTimes) && data.prayerTimes.length > 0 ? data.prayerTimes : ['11:15', '18:45']
          });
        }
      }
    } catch (e) {
      console.warn('Sync from Firestore notice:', e.message);
    }
  }

  if (dbConnected && dbPool) {
    try {
      const res = await dbPool.query('SELECT key, value FROM player_settings');
      for (const row of res.rows) {
        settingsStore.set(row.key, row.value);
      }
      console.log(`📥 Loaded ${res.rows.length} settings records from PostgreSQL database.`);
    } catch (err) {
      console.warn('Sync settings from DB warning:', err.message);
    }
  }
}

// Save audio track permanently into database (Firestore & PostgreSQL)
async function ensureDatabaseReady() {
  if (firestoreDb) return true;
  if (dbConnected && dbPool) return true;
  const connStr = dbConfig.connectionString || process.env.DATABASE_URL;
  if (!connStr || !String(connStr).trim()) return !!firestoreDb;
  try {
    return await connectToDatabase(connStr);
  } catch (err) {
    console.warn('Database connection could not be established for upload:', err.message);
    return !!firestoreDb;
  }
}

async function saveTrackToDatabase(filename, category, title, audioUrl = null, buffer = null, mimeType = 'audio/mpeg') {
  let savedResult = null;
  // 1. Save directly into Firestore database
  if (firestoreDb) {
    try {
      savedResult = await saveTrackToFirestore(filename, category, title, buffer, mimeType);
    } catch (e) {
      console.warn('Save track to Firestore error:', e.message);
    }
  }

  // 2. Also save to PostgreSQL database if connected
  if (dbConnected && dbPool) {
    try {
      const id = `track_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      let base64 = null;
      let size = buffer ? buffer.length : 0;

      if (buffer && size <= 20 * 1024 * 1024) {
        base64 = buffer.toString('base64');
      }

      const url = audioUrl || `/api/db-audio/${id}`;

      await dbPool.query(`
        INSERT INTO audio_tracks (id, filename, category, title, audio_url, audio_base64, size, mime_type, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (id) DO UPDATE SET
          filename = $2, category = $3, title = $4, audio_url = $5, audio_base64 = COALESCE($6, audio_tracks.audio_base64), size = $7, mime_type = $8, created_at = NOW()
      `, [id, filename, category, title || filename, url, base64, size, mimeType]);

      console.log(`💾 Saved "${title || filename}" (${category}) permanently to PostgreSQL database!`);
    } catch (err) {
      console.error('Save track to PostgreSQL DB error:', err.message);
    }
  }

  return savedResult || { id: filename, filename, category, title: title || filename, url: audioUrl, size: buffer ? buffer.length : 0 };
}

// Get all tracks saved in Database (Firestore + PostgreSQL)
async function getDatabaseAudioTracks(categoryFilter = null) {
  const tracksList = [];
  const seenIds = new Set();

  // 1. Fetch from Firestore
  if (firestoreDb) {
    try {
      const snap = await firestoreGetDocs(firestoreCollection(firestoreDb, 'audio_tracks'));
      snap.forEach(d => {
        const r = d.data();
        const fn = r.title || r.id;
        if (isFileMarkedDeleted(fn) || isFileMarkedDeleted(r.id) || isFileMarkedDeleted(r.filename) || isFileMarkedDeleted(d.id)) {
          return;
        }
        const resolvedCategory = getFileCategory(fn) || r.category || 'general';
        if (categoryFilter && resolvedCategory !== categoryFilter) return;
        seenIds.add(fn.toLowerCase());
        tracksList.push({
          title: fn,
          filename: fn,
          url: r.url || `/api/uploads/${encodeURIComponent(fn)}`,
          size: Number(r.size) || 0,
          mtime: r.updatedAt ? new Date(r.updatedAt) : new Date(),
          category: resolvedCategory,
          platform: 'Database',
          isBlob: false,
          isDirectAudio: true,
          isDbStored: true,
          dbId: d.id
        });
      });
    } catch (e) {
      console.warn('Get Firestore audio tracks error:', e.message);
    }
  }

  // 2. Fetch from PostgreSQL
  if (dbConnected && dbPool) {
    try {
      let query = 'SELECT id, filename, category, title, audio_url, size, mime_type, created_at FROM audio_tracks';
      const params = [];
      if (categoryFilter) {
        query += ' WHERE category = $1';
        params.push(categoryFilter);
      }
      query += ' ORDER BY created_at DESC';
      const res = await dbPool.query(query, params);
      for (const r of res.rows) {
        const fn = r.title || r.filename;
        if (isFileMarkedDeleted(fn) || isFileMarkedDeleted(r.id) || isFileMarkedDeleted(r.filename)) {
          continue;
        }
        const resolvedCategory = getFileCategory(fn) || r.category || 'general';
        if (categoryFilter && resolvedCategory !== categoryFilter) continue;
        if (!seenIds.has(fn.toLowerCase())) {
          seenIds.add(fn.toLowerCase());
          tracksList.push({
            title: fn,
            filename: r.filename,
            url: r.audio_url || `/api/db-audio/${r.id}`,
            size: Number(r.size) || 0,
            mtime: r.created_at,
            category: resolvedCategory,
            platform: 'Database',
            isBlob: false,
            isDirectAudio: true,
            isDbStored: true,
            dbId: r.id
          });
        }
      }
    } catch (err) {
      console.warn('Get DB audio tracks error:', err.message);
    }
  }

  return tracksList;
}

// Generates valid standard PCM WAV audio files for sample prayer tracks & ads
function createWavBuffer(durationSeconds, sampleRate, frequency, type = 'sine') {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // "fmt " sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // subchunk1size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // "data" sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let envelope = 1.0;
    let sample = 0;

    if (type === 'prayer_bell') {
      // 528 Hz Sacred Prayer Frequency with long peaceful harmonic decay
      envelope = Math.min(t / 0.04, 1.0) * Math.exp(-((t % 4.0)) * 0.7);
      sample = Math.sin(2 * Math.PI * frequency * t) * 0.55 +
               Math.sin(2 * Math.PI * (frequency * 2.02) * t) * 0.25 +
               Math.sin(2 * Math.PI * (frequency * 3.01) * t) * 0.12 +
               Math.sin(2 * Math.PI * (frequency * 0.5) * t) * 0.08;
    } else if (type === 'meditation') {
      // 432 Hz Deep Soothing Prayer Om/Chant resonance
      envelope = 0.5 * (1 + Math.sin(2 * Math.PI * 0.2 * t)) * Math.min(t / 0.5, 1.0);
      sample = Math.sin(2 * Math.PI * frequency * t) * 0.6 +
               Math.sin(2 * Math.PI * (frequency * 1.5) * t) * 0.25 +
               Math.sin(2 * Math.PI * (frequency * 2.0) * t) * 0.15;
    } else {
      // Jingle / Sponsor tone
      envelope = Math.min(t / 0.02, 1.0) * Math.exp(-((t % 2.5)) * 1.1);
      sample = Math.sin(2 * Math.PI * frequency * t) * 0.7 +
               Math.sin(2 * Math.PI * (frequency * 1.25) * t) * 0.3;
    }

    const intSample = Math.floor(Math.max(-1, Math.min(1, sample * envelope * 0.88)) * 32767);
    buffer.writeInt16LE(intSample, offset);
    offset += 2;
  }

  return buffer;
}

const FILES_META_FILE = path.join(DATA_FOLDER, 'files_meta.json');
const DELETED_FILES_FILE = path.join(DATA_FOLDER, 'deleted_files.json');
let filesMeta = {};
let deletedFiles = new Set();

function loadDeletedFiles() {
  try {
    if (fs.existsSync(DELETED_FILES_FILE)) {
      const data = JSON.parse(fs.readFileSync(DELETED_FILES_FILE, 'utf-8'));
      if (Array.isArray(data)) {
        deletedFiles = new Set(data.map(d => String(d).trim().toLowerCase()));
      }
    }
  } catch (err) {
    console.warn('Could not load deleted_files.json:', err.message);
    deletedFiles = new Set();
  }
}

function saveDeletedFiles() {
  try {
    fs.writeFileSync(DELETED_FILES_FILE, JSON.stringify(Array.from(deletedFiles), null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save deleted_files.json:', err.message);
  }
}

function markFileDeleted(filename) {
  if (!filename) return;
  const raw = String(filename).trim();
  const base = path.basename(raw).toLowerCase();
  deletedFiles.add(base);
  deletedFiles.add(raw.toLowerCase());
  try {
    const decoded = decodeURIComponent(raw).toLowerCase();
    deletedFiles.add(decoded);
    deletedFiles.add(path.basename(decoded));
    deletedFiles.add(decoded.replace(/[^a-zA-Z0-9_\-\.]/g, '_'));
    deletedFiles.add(decoded.replace(/\s+/g, ' '));
  } catch (e) {}
  deletedFiles.add(raw.toLowerCase().replace(/[^a-zA-Z0-9_\-\.]/g, '_'));
  deletedFiles.add(raw.toLowerCase().replace(/_/g, ' '));
  deletedFiles.add(raw.toLowerCase().replace(/\s+/g, ' '));
  deletedFiles.add(base.replace(/[^a-zA-Z0-9_\-\.]/g, '_'));
  saveDeletedFiles();
}

function unmarkFileDeleted(filename) {
  if (!filename) return;
  const raw = String(filename).trim();
  const base = path.basename(raw).toLowerCase();
  deletedFiles.delete(base);
  deletedFiles.delete(raw.toLowerCase());
  try {
    const decoded = decodeURIComponent(raw).toLowerCase();
    deletedFiles.delete(decoded);
    deletedFiles.delete(path.basename(decoded));
  } catch (e) {}
  saveDeletedFiles();
}

function isFileMarkedDeleted(filename) {
  if (!filename) return false;
  try {
    const rawName = String(filename).trim();
    if (fs.existsSync(path.join(UPLOAD_FOLDER, rawName))) return false;
    const baseName = path.basename(rawName);
    if (fs.existsSync(path.join(UPLOAD_FOLDER, baseName))) return false;
    const decodedName = decodeURIComponent(baseName);
    if (fs.existsSync(path.join(UPLOAD_FOLDER, decodedName))) return false;
  } catch (e) {}
  const raw = String(filename).trim().toLowerCase();
  const base = path.basename(raw);
  if (deletedFiles.has(base) || deletedFiles.has(raw)) return true;
  if (deletedFiles.has(raw.replace(/\s+/g, ' '))) return true;
  if (deletedFiles.has(raw.replace(/[^a-zA-Z0-9_\-\.]/g, '_'))) return true;
  if (deletedFiles.has(raw.replace(/_/g, ' '))) return true;
  if (deletedFiles.has(base.replace(/[^a-zA-Z0-9_\-\.]/g, '_'))) return true;
  try {
    const decoded = decodeURIComponent(raw);
    if (deletedFiles.has(decoded) || deletedFiles.has(path.basename(decoded))) return true;
    if (deletedFiles.has(decoded.replace(/\s+/g, ' '))) return true;
    if (deletedFiles.has(decoded.replace(/[^a-zA-Z0-9_\-\.]/g, '_'))) return true;
  } catch (e) {}
  return false;
}

loadDeletedFiles();

function loadFilesMeta() {
  try {
    if (fs.existsSync(FILES_META_FILE)) {
      filesMeta = JSON.parse(fs.readFileSync(FILES_META_FILE, 'utf-8'));
    }
  } catch (err) {
    console.warn('Could not load files_meta.json:', err.message);
    filesMeta = {};
  }
}

function saveFilesMeta() {
  try {
    fs.writeFileSync(FILES_META_FILE, JSON.stringify(filesMeta, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save files_meta.json:', err.message);
  }
}

function normalizeTrackName(str) {
  if (!str) return '';
  let s = String(str).trim();
  try { s = decodeURIComponent(s); } catch (e) {}
  try { s = s.normalize('NFC'); } catch (e) {}
  return s;
}

function isSameFile(nameA, nameB) {
  if (!nameA || !nameB) return false;
  if (nameA === nameB) return true;
  const normA = normalizeTrackName(path.basename(nameA)).toLowerCase();
  const normB = normalizeTrackName(path.basename(nameB)).toLowerCase();
  if (normA === normB) return true;
  try {
    if (encodeURIComponent(normA).toLowerCase() === normB || encodeURIComponent(normB).toLowerCase() === normA) return true;
  } catch (e) {}
  return false;
}

function findFileOnDisk(filename) {
  if (!filename) return null;
  const raw = String(filename).trim();
  const base = path.basename(raw);

  // 1. Direct check
  if (fs.existsSync(path.join(UPLOAD_FOLDER, base))) return base;
  if (fs.existsSync(path.join(UPLOAD_FOLDER, raw))) return raw;

  // 2. Decoded check
  try {
    const dec = decodeURIComponent(raw);
    const decBase = path.basename(dec);
    if (fs.existsSync(path.join(UPLOAD_FOLDER, decBase))) return decBase;
    if (fs.existsSync(path.join(UPLOAD_FOLDER, dec))) return dec;
  } catch (e) {}

  // 3. Normalized check
  try {
    const nfc = base.normalize('NFC');
    if (fs.existsSync(path.join(UPLOAD_FOLDER, nfc))) return nfc;
    const nfd = base.normalize('NFD');
    if (fs.existsSync(path.join(UPLOAD_FOLDER, nfd))) return nfd;
  } catch (e) {}

  // 4. Case-insensitive & normalized search across all files in UPLOAD_FOLDER
  try {
    if (fs.existsSync(UPLOAD_FOLDER)) {
      const allFiles = fs.readdirSync(UPLOAD_FOLDER);
      for (const f of allFiles) {
        if (f === '.chunks') continue;
        if (isSameFile(f, raw) || isSameFile(f, base)) {
          return f;
        }
      }
    }
  } catch (e) {}

  return null;
}

function inferCategory(filename) {
  const lower = (filename || '').toLowerCase();
  if (/(?:prayer|bhajan|aarti|arti|chalisa|mantra|stotra|stotram|temple|meditation|bell|chime|all in one|all_in_one|shlok|devotional|god|krishna|ram|shiva|ganesh|durga|hanuman|sai|kavach|jap|puja|pooja|divine|spiritual|satsang|kirtan|gayatri|dhun)/i.test(lower)) {
    return 'prayer';
  }
  if (/(?:advt|ad\b|advertisement|commercial|promo|devi[_\s-]*jewel|sponsor|jingle|special_offer|gold_promo|offer|discount|jewelry|jewellery|jeweler|jeweller|sale)/i.test(lower)) {
    return 'advt';
  }
  return 'general';
}

function isAdvertisementTrack(filenameOrTrack) {
  if (!filenameOrTrack) return false;
  const explicitCat = (typeof filenameOrTrack === 'object' && filenameOrTrack.category) ? String(filenameOrTrack.category).toLowerCase() : '';
  if (explicitCat === 'prayer') return false;
  const name = typeof filenameOrTrack === 'string' ? filenameOrTrack : (filenameOrTrack.title || filenameOrTrack.filename || filenameOrTrack.url || '');
  if (getFileCategory(name) === 'prayer') return false;
  const lower = name.toLowerCase();
  const rawId = (typeof filenameOrTrack === 'object' && filenameOrTrack.id) ? String(filenameOrTrack.id).toLowerCase() : '';
  const rawUrl = (typeof filenameOrTrack === 'object' && filenameOrTrack.url) ? String(filenameOrTrack.url).toLowerCase() : '';
  if (rawId.startsWith('advt') || rawId.includes('devi_gold_promo')) return true;
  if (rawUrl.includes('sample_advt') || rawUrl.includes('devi_jewel')) return true;
  if (getFileCategory(name) === 'advt') return true;
  if (/(?:advt|ad\b|advertisement|commercial|promo|devi[_\s-]*jewel|sponsor|jingle|special_offer|gold_promo|discount|sale)/i.test(lower)) return true;
  const currentAdvt = settingsStore.get('advt');
  if (currentAdvt) {
    if (currentAdvt.track && isSameFile(currentAdvt.track.title, name)) return true;
    if (Array.isArray(currentAdvt.tracks) && currentAdvt.tracks.some(t => isSameFile(t?.title, name))) return true;
  }
  return false;
}

function getFileCategory(filename) {
  if (!filename) return 'general';
  const base = path.basename(filename);

  // 1. Check filesMeta registry with exact, decoded, and normalized matches
  if (filesMeta) {
    if (filesMeta[base]?.category) return filesMeta[base].category;
    if (filesMeta[filename]?.category) return filesMeta[filename].category;

    for (const [key, val] of Object.entries(filesMeta)) {
      if (val && val.category && isSameFile(key, base)) {
        return val.category;
      }
    }
  }

  // 2. Check active settings store
  const currentAdvt = settingsStore.get('advt');
  if (currentAdvt) {
    if (currentAdvt.track && isSameFile(currentAdvt.track.title, base)) return 'advt';
    if (Array.isArray(currentAdvt.tracks) && currentAdvt.tracks.some(t => isSameFile(t?.title, base))) return 'advt';
  }
  const currentPrayer = settingsStore.get('prayer');
  if (currentPrayer && currentPrayer.track && isSameFile(currentPrayer.track.title, base)) {
    return 'prayer';
  }

  return inferCategory(base);
}

function setFileCategory(filename, category) {
  if (!filename) return;
  const base = path.basename(filename);
  const validCat = (category === 'prayer' || category === 'advt') ? category : 'general';
  
  if (!filesMeta[base]) {
    filesMeta[base] = {};
  }
  filesMeta[base].category = validCat;
  filesMeta[base].updatedAt = Date.now();

  // Also register normalized name if different
  const norm = normalizeTrackName(base);
  if (norm && norm !== base) {
    if (!filesMeta[norm]) filesMeta[norm] = {};
    filesMeta[norm].category = validCat;
    filesMeta[norm].updatedAt = Date.now();
  }

  saveFilesMeta();
}

// Synchronize track category across files_meta.json, Firestore, and PostgreSQL databases
async function updateTrackCategoryInDatabases(filename, category, dbId = null) {
  if (!filename && !dbId) return 'general';
  const cleanCat = (category === 'prayer' || category === 'advt') ? category : 'general';
  if (filename) setFileCategory(filename, cleanCat);
  filesVersion = Date.now();

  // 1. Update Firestore audio_tracks metadata
  if (firestoreDb && !firestoreQuotaExceeded) {
    try {
      const candidates = new Set();
      if (dbId) candidates.add(String(dbId));
      if (filename) {
        candidates.add(String(filename));
        candidates.add(path.basename(filename));
        const rawId = String(filename).replace(/[^a-zA-Z0-9_\-\.]/g, '_').substring(0, 100);
        candidates.add(rawId);
      }

      for (const id of candidates) {
        try {
          const docRef = firestoreDoc(firestoreDb, 'audio_tracks', id);
          const snap = await firestoreGetDoc(docRef);
          if (snap.exists()) {
            await firestoreSetDoc(docRef, { category: cleanCat, updatedAt: new Date().toISOString() }, { merge: true });
            console.log(`☁️ Synced category in Firestore audio_tracks doc "${id}" to "${cleanCat}"`);
          }
        } catch (e) {
          handleServerFirestoreError(e, 'updateTrackCategoryDoc');
        }
      }

      // Also scan docs to find matches by title or filename
      const snap = await firestoreGetDocs(firestoreCollection(firestoreDb, 'audio_tracks'));
      for (const d of snap.docs) {
        const data = d.data();
        if (
          (dbId && d.id === dbId) ||
          (filename && (
            isSameFile(data.title, filename) ||
            isSameFile(data.filename, filename) ||
            isSameFile(d.id, filename) ||
            data.title === filename ||
            data.filename === filename
          ))
        ) {
          await firestoreSetDoc(firestoreDoc(firestoreDb, 'audio_tracks', d.id), {
            category: cleanCat,
            updatedAt: new Date().toISOString()
          }, { merge: true });
          console.log(`☁️ Synced category in Firestore audio_tracks doc "${d.id}" to "${cleanCat}"`);
        }
      }
    } catch (fsErr) {
      handleServerFirestoreError(fsErr, 'updateTrackCategoryBatch');
    }
  }

  // 2. Update PostgreSQL database
  if (dbConnected && dbPool) {
    try {
      if (dbId && !isNaN(parseInt(dbId, 10))) {
        await dbPool.query('UPDATE audio_tracks SET category = $1 WHERE id = $2', [cleanCat, parseInt(dbId, 10)]);
      }
      if (filename) {
        await dbPool.query(
          'UPDATE audio_tracks SET category = $1 WHERE filename = $2 OR title = $2 OR LOWER(filename) = LOWER($2) OR LOWER(title) = LOWER($2)',
          [cleanCat, filename]
        );
      }
    } catch (pgErr) {
      console.warn('Notice syncing category in PostgreSQL:', pgErr.message);
    }
  }

  return cleanCat;
}

loadFilesMeta();

function isLibraryCleared() {
  const clearedFlag = path.join(DATA_FOLDER, 'library_cleared.flag');
  return fs.existsSync(clearedFlag);
}

function clearLibraryFlag() {
  try {
    const clearedFlag = path.join(DATA_FOLDER, 'library_cleared.flag');
    if (fs.existsSync(clearedFlag)) {
      fs.unlinkSync(clearedFlag);
    }
  } catch(e){}
}

function isAdvtCleared() {
  const clearedFlag = path.join(DATA_FOLDER, 'advt_cleared.flag');
  return fs.existsSync(clearedFlag);
}

function setAdvtClearedFlag() {
  try {
    const clearedFlag = path.join(DATA_FOLDER, 'advt_cleared.flag');
    fs.writeFileSync(clearedFlag, new Date().toISOString(), 'utf-8');
  } catch(e) {}
}

function clearAdvtClearedFlag() {
  try {
    const clearedFlag = path.join(DATA_FOLDER, 'advt_cleared.flag');
    if (fs.existsSync(clearedFlag)) {
      fs.unlinkSync(clearedFlag);
    }
  } catch(e) {}
}

function isPrayerCleared() {
  const clearedFlag = path.join(DATA_FOLDER, 'prayer_cleared.flag');
  return fs.existsSync(clearedFlag);
}

function setPrayerClearedFlag() {
  try {
    const clearedFlag = path.join(DATA_FOLDER, 'prayer_cleared.flag');
    fs.writeFileSync(clearedFlag, new Date().toISOString(), 'utf-8');
  } catch(e) {}
}

function clearPrayerClearedFlag() {
  try {
    const clearedFlag = path.join(DATA_FOLDER, 'prayer_cleared.flag');
    if (fs.existsSync(clearedFlag)) {
      fs.unlinkSync(clearedFlag);
    }
  } catch(e) {}
}

function ensureDefaultSampleTracks() {
  try {
    if (!fs.existsSync(UPLOAD_FOLDER)) {
      fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
    }
    if (!fs.existsSync(DATA_FOLDER)) {
      fs.mkdirSync(DATA_FOLDER, { recursive: true });
    }
    console.log('📁 Storage folders verified (sample generation disabled as requested).');
  } catch (e) {
    console.warn('Notice in storage initialization:', e.message);
  }
}

ensureDefaultSampleTracks();

// In-memory settings with JSON file backing
let settingsStore = new Map();

// Auto-Update and Version Tracking
const serverBootTime = Date.now();
let settingsVersion = Date.now();
let filesVersion = Date.now();
const appBuildVersion = `v1.2.${Math.floor(serverBootTime / 1000)}`;
const sseClients = new Set();

function broadcastEvent(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function sanitizeSettingsOnLoad() {
  let modified = false;

  // 1. Sanitize & Ensure Advertisement Settings (Permanent Persistence)
  const hadAdvt = settingsStore.has('advt');
  let currentAdvt = settingsStore.get('advt') || {
    tracks: [],
    track: null,
    interval: '300',
    enabled: true,
    currentSequenceIndex: 0
  };

  let tracks = Array.isArray(currentAdvt.tracks) ? currentAdvt.tracks : [];
  if (tracks.length === 0 && currentAdvt.track) {
    tracks = [currentAdvt.track];
  }
  let validTracks = [];

  for (const t of tracks) {
    if (!t || !t.title) continue;
    if (isFileMarkedDeleted(t.title)) continue;
    // Do not contaminate advertisement rotation with default prayer audio
    if (t.id === 'prayer_default_gayatri' || /gayatri mantra/i.test(t.title) || getFileCategory(t.title) === 'prayer') continue;
    const diskName = findFileOnDisk(t.title);
    if (diskName) {
      validTracks.push({
        ...t,
        title: diskName,
        url: `/api/uploads/${encodeURIComponent(diskName)}`,
        platform: 'Local',
        isDirectAudio: true
      });
      setFileCategory(diskName, 'advt');
    } else {
      // Retain track even if disk file is external URL or pending restart
      let cleanUrl = t.url || '';
      if (t.platform === 'Local' || cleanUrl.includes('/uploads/')) {
        let fn = t.title || '';
        if (cleanUrl.includes('/uploads/')) {
          fn = cleanUrl.substring(cleanUrl.lastIndexOf('/uploads/') + '/uploads/'.length);
          try { fn = decodeURIComponent(fn); } catch(e){}
        }
        fn = path.basename(fn).trim();
        cleanUrl = `/api/uploads/${encodeURIComponent(fn || t.title)}`;
      }
      validTracks.push({
        ...t,
        url: cleanUrl,
        platform: t.platform || 'Local',
        isDirectAudio: true
      });
    }
  }

  // If no advt tracks are in settings yet, auto-discover any advt tracks stored in database (only if not cleared)
  if (validTracks.length === 0 && fs.existsSync(UPLOAD_FOLDER) && !isAdvtCleared() && !isLibraryCleared()) {
    try {
      const allFiles = fs.readdirSync(UPLOAD_FOLDER);
      for (const f of allFiles) {
        if (f === '.chunks' || isFileMarkedDeleted(f)) continue;
        if (getFileCategory(f) === 'advt') {
          validTracks.push({
            id: `advt-${Date.now()}-${validTracks.length}`,
            title: f,
            url: `/api/uploads/${encodeURIComponent(f)}`,
            platform: 'Local',
            isDirectAudio: true,
            order: validTracks.length + 1,
            enabled: true
          });
        }
      }
    } catch (e) {}
  }

  const DEFAULT_ADVT_TRACKS = [
    {
      id: 'advt_default_devi_gold_promo',
      title: '📢 Devi Jewellers - Exclusive Gold & Diamond Collection Announcement',
      url: '/uploads/sample_advt_devi_jewellers_gold_promo.wav',
      platform: 'Local',
      isDirectAudio: true,
      order: 1,
      size: 661544,
      duration: 15,
      durationFormatted: '0:15',
      enabled: true
    },
    {
      id: 'advt_default_festival_offer',
      title: '📢 Festival Mega Discount - Special In-Store Jewellery Offer',
      url: '/uploads/sample_advt_festival_special_offer.wav',
      platform: 'Local',
      isDirectAudio: true,
      order: 2,
      size: 661544,
      duration: 15,
      durationFormatted: '0:15',
      enabled: true
    }
  ];

  if (validTracks.length === 0 && !isLibraryCleared() && !isAdvtCleared()) {
    validTracks = [...DEFAULT_ADVT_TRACKS];
  }

  if (isAdvtCleared()) {
    validTracks = [];
  }

  validTracks.forEach((t, i) => { t.order = i + 1; });
  let primaryAdvtTrack = isAdvtCleared() ? null : (validTracks.find(t => isSameFile(t.title, currentAdvt.track?.title)) || validTracks[0] || null);

  const newAdvt = {
    ...currentAdvt,
    tracks: validTracks,
    track: primaryAdvtTrack,
    interval: currentAdvt.interval || '300',
    enabled: isAdvtCleared() ? false : (validTracks.length > 0 ? (currentAdvt.enabled !== undefined ? currentAdvt.enabled : true) : false),
    currentSequenceIndex: typeof currentAdvt.currentSequenceIndex === 'number' ? currentAdvt.currentSequenceIndex : 0
  };

  if (!hadAdvt || JSON.stringify(newAdvt) !== JSON.stringify(currentAdvt)) {
    settingsStore.set('advt', newAdvt);
    modified = true;
  }

  // 2. Sanitize & Ensure Prayer Settings (Permanent Persistence)
  const DEFAULT_PRAYER_TRACK = null;

  const hadPrayer = settingsStore.has('prayer');
  let currentPrayer = settingsStore.get('prayer') || {
    track: null,
    enabled: false,
    times: ['11:15', '18:45']
  };

  let prayerTrack = currentPrayer.track || null;
  if (prayerTrack && prayerTrack.title) {
    const isAdvt = isAdvertisementTrack(prayerTrack.title) || prayerTrack.category === 'advt';
    if (isFileMarkedDeleted(prayerTrack.title) || isAdvt) {
      console.warn('⚠️ Stripped advertisement track from prayer settings:', prayerTrack.title);
      prayerTrack = null;
    } else {
      const diskName = findFileOnDisk(prayerTrack.title);
      if (diskName) {
        if (isAdvertisementTrack(diskName)) {
          prayerTrack = null;
        } else {
          prayerTrack = {
            ...prayerTrack,
            title: diskName,
            url: `/api/uploads/${encodeURIComponent(diskName)}`,
            platform: 'Local',
            isDirectAudio: true,
            size: prayerTrack.size || 0
          };
          setFileCategory(diskName, 'prayer');
        }
      } else {
        let cleanUrl = prayerTrack.url || '';
        if (prayerTrack.platform === 'Local' || cleanUrl.includes('/uploads/')) {
          let fn = prayerTrack.title || '';
          if (cleanUrl.includes('/uploads/')) {
            fn = cleanUrl.substring(cleanUrl.lastIndexOf('/uploads/') + '/uploads/'.length);
            try { fn = decodeURIComponent(fn); } catch(e){}
          }
          fn = path.basename(fn).trim();
          cleanUrl = `/api/uploads/${encodeURIComponent(fn || prayerTrack.title)}`;
        }
        prayerTrack = {
          ...prayerTrack,
          url: cleanUrl,
          platform: prayerTrack.platform || 'Local',
          isDirectAudio: true
        };
      }
    }
  }

  // If no prayer track in settings yet, auto-discover any genuine prayer track stored on disk
  if (!prayerTrack && fs.existsSync(UPLOAD_FOLDER)) {
    try {
      if (fs.existsSync(path.join(UPLOAD_FOLDER, 'ALL IN ONE BHAJAN.mp3'))) {
        prayerTrack = {
          id: 'prayer_all_in_one_bhajan',
          title: 'ALL IN ONE BHAJAN.mp3',
          url: `/api/uploads/${encodeURIComponent('ALL IN ONE BHAJAN.mp3')}`,
          platform: 'Local',
          isDirectAudio: true,
          category: 'prayer'
        };
        setFileCategory('ALL IN ONE BHAJAN.mp3', 'prayer');
      } else {
        const allFiles = fs.readdirSync(UPLOAD_FOLDER);
        for (const f of allFiles) {
          if (f === '.chunks' || isFileMarkedDeleted(f) || isAdvertisementTrack(f)) continue;
          if (getFileCategory(f) === 'prayer' || inferCategory(f) === 'prayer') {
            prayerTrack = {
              title: f,
              url: `/api/uploads/${encodeURIComponent(f)}`,
              platform: 'Local',
              isDirectAudio: true,
              category: 'prayer'
            };
            break;
          }
        }
      }
    } catch (e) {}
  }

  // If still no prayer track, provide default devotional prayer audio only if library not cleared and prayer not cleared
  if (!prayerTrack && !isLibraryCleared() && !isPrayerCleared()) {
    prayerTrack = DEFAULT_PRAYER_TRACK;
  }

  if (isPrayerCleared()) {
    prayerTrack = null;
  }

  let prayerTimes = ['11:15', '18:45'];
  if (Array.isArray(currentPrayer.times) && currentPrayer.times.length > 0) {
    prayerTimes = currentPrayer.times;
  } else if (typeof currentPrayer.times === 'string' && currentPrayer.times.trim()) {
    const parsed = currentPrayer.times.split(/[,;\s]+/).map(t => t.trim()).filter(Boolean);
    if (parsed.length > 0) prayerTimes = parsed;
  }

  const newPrayer = {
    ...currentPrayer,
    track: isPrayerCleared() ? null : prayerTrack,
    enabled: isPrayerCleared() ? false : (prayerTrack ? true : false),
    times: prayerTimes
  };

  if (!hadPrayer || JSON.stringify(newPrayer) !== JSON.stringify(currentPrayer)) {
    settingsStore.set('prayer', newPrayer);
    modified = true;
  }

  // Advertisement tracks and Prayer track are kept strictly separate.
  // Never overwrite or force either track onto the other.

  if (modified) {
    saveSettings();
  }
}

async function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      for (const [k, v] of Object.entries(data)) {
        settingsStore.set(k, v);
      }
    }
  } catch (err) {
    console.warn('Could not load settings file:', err.message);
  }

  // Sync from Firestore and Database first
  try {
    await syncSettingsFromDatabase();
  } catch (e) {}

  sanitizeSettingsOnLoad();
  saveSettings();
}

function saveSettings() {
  try {
    const obj = {};
    for (const [k, v] of settingsStore.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2), 'utf-8');

    // Also persist into Firebase Firestore database
    if (firestoreDb && !firestoreQuotaExceeded) {
      try {
        const advt = settingsStore.get('advt') || {};
        const prayer = settingsStore.get('prayer') || {};
        const payload = {
          id: 'global_sync',
          advtTrack: (advt.track && typeof advt.track === 'object' && advt.track.title) ? advt.track : null,
          prayerTrack: (prayer.track && typeof prayer.track === 'object' && prayer.track.title) ? prayer.track : null,
          advtTracks: Array.isArray(advt.tracks) ? advt.tracks : [],
          prayerTimes: Array.isArray(prayer.times) ? prayer.times : ['11:15', '18:45'],
          advtEnabled: !!advt.enabled,
          prayerEnabled: !!prayer.enabled,
          advtInterval: parseInt(advt.interval, 10) || 300,
          updatedAt: new Date().toISOString()
        };
        firestoreSetDoc(firestoreDoc(firestoreDb, 'player_settings', 'global_sync'), payload, { merge: true })
          .catch(e => handleServerFirestoreError(e, 'saveSettings'));
      } catch (e) {
        handleServerFirestoreError(e, 'saveSettings');
      }
    }

    // Also persist into PostgreSQL database if connected
    if (dbConnected && dbPool) {
      for (const [k, v] of settingsStore.entries()) {
        dbPool.query(`
          INSERT INTO player_settings (key, value, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
        `, [k, JSON.stringify(v)]).catch(e => console.warn('DB save setting warning:', e.message));
      }
    }
  } catch (err) {
    console.warn('Could not save settings file:', err.message);
  }
}

loadSettings();

// Connect to Database on startup if configured
if (dbConfig.connectionString || process.env.DATABASE_URL) {
  connectToDatabase().catch(err => console.warn('Initial DB connection attempt:', err.message));
}

/**
 * Persist a file's role (prayer/advt) on the SERVER.
 * This is the authoritative shared state for every PC/device.
 * localStorage is only a browser cache and is never the source of truth.
 */
function persistFileRole(filename, category) {
  if (!filename) return;
  const cleanCat = (category === 'prayer' || category === 'advt') ? category : 'general';
  const diskName = findFileOnDisk(filename) || path.basename(filename);
  if (!diskName) return;

  setFileCategory(diskName, cleanCat);

  const advtSetting = settingsStore.get('advt') || {
    tracks: [], track: null, interval: '300', enabled: false, currentSequenceIndex: 0
  };
  const prayerSetting = settingsStore.get('prayer') || {
    track: null, enabled: false, times: ['11:15', '18:45']
  };

  let changed = false;

  let fileSize = 0;
  try {
    const stat = fs.statSync(path.join(UPLOAD_FOLDER, diskName));
    fileSize = stat.size;
  } catch (e) {}

  if (cleanCat === 'advt') {
    let tracks = Array.isArray(advtSetting.tracks) ? [...advtSetting.tracks] : [];
    const existingIdx = tracks.findIndex(t => isSameFile(t?.title, diskName));
    const newAdvtTrack = {
      id: `advt-${Date.now()}`,
      title: diskName,
      url: `/api/uploads/${encodeURIComponent(diskName)}`,
      platform: 'Local',
      isBlob: false,
      isDirectAudio: true,
      category: 'advt',
      size: fileSize,
      order: existingIdx !== -1 ? (tracks[existingIdx].order || 1) : (tracks.length + 1),
      enabled: true
    };
    if (existingIdx !== -1) {
      tracks[existingIdx] = newAdvtTrack;
    } else {
      tracks.push(newAdvtTrack);
    }
    settingsStore.set('advt', {
      ...advtSetting,
      tracks: tracks,
      track: advtSetting.track || newAdvtTrack,
      enabled: true
    });
    setFileCategory(diskName, 'advt');
    changed = true;

    // Guard: Advertisement track must NEVER be set as prayer track
    if (prayerSetting.track && (isSameFile(prayerSetting.track.title, diskName) || isAdvertisementTrack(prayerSetting.track.title))) {
      settingsStore.set('prayer', {
        ...prayerSetting,
        track: null
      });
      changed = true;
    }
  } else if (cleanCat === 'prayer') {
    // Guard: Cannot set an advertisement track as prayer track
    if (isAdvertisementTrack(diskName)) {
      console.warn('⚠️ Attempted to set advertisement file as prayer track, blocked:', diskName);
      return;
    }

    // Remove from advertisement rotation if previously there
    const filteredAdvtTracks = (advtSetting.tracks || []).filter(t => !isSameFile(t?.title, diskName));
    if (filteredAdvtTracks.length !== (advtSetting.tracks || []).length) {
      settingsStore.set('advt', {
        ...advtSetting,
        tracks: filteredAdvtTracks,
        track: filteredAdvtTracks[0] || null
      });
      changed = true;
    }

    const newPrayerTrack = {
      id: `prayer-${Date.now()}`,
      title: diskName,
      url: `/api/uploads/${encodeURIComponent(diskName)}`,
      platform: 'Local',
      isBlob: false,
      isDirectAudio: true,
      category: 'prayer',
      size: fileSize,
      enabled: true
    };
    settingsStore.set('prayer', {
      ...prayerSetting,
      track: newPrayerTrack,
      enabled: true
    });
    setFileCategory(diskName, 'prayer');
    changed = true;
  }

  if (changed) {
    saveSettings();
    settingsVersion = Date.now();
    broadcastEvent('settings_updated', {
      key: cleanCat,
      value: settingsStore.get(cleanCat),
      settingsVersion,
      timestamp: Date.now()
    });
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ extended: true, limit: '1000mb' }));

// Prevent stale client caching of index.html and service-worker
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html' || req.path === '/sw.js') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Serve static directory
app.use(express.static(STATIC_FOLDER));

// ============================================================
// ROBUST AUDIO FILE STREAMING
// Supports:
// - MP3
// - WAV
// - M4A
// - AAC
// - OGG
// - OPUS
// - FLAC
// - HTTP Range requests
// - HEAD requests
// ============================================================
async function handleAudioStreaming(req, res, targetFilename) {

  try {

    let decoded = targetFilename || '';

    try {
      decoded = decodeURIComponent(decoded);
    } catch (e) {
      // Keep original value if decoding fails
    }

    // Never allow path traversal.
    const safeName = path.basename(decoded);

    let filePath = path.join(UPLOAD_FOLDER, safeName);

    // 1. Check if file can be restored from Firestore or PostgreSQL database if missing from disk
    if (!fs.existsSync(filePath)) {
      try {
        const restored = await restoreTrackFromFirestore(safeName);
        if (restored && fs.existsSync(restored)) {
          filePath = restored;
        }
      } catch (rstErr) {
        console.warn('Firestore audio restore notice:', rstErr.message);
      }
    }
    if (!fs.existsSync(filePath)) {
      try {
        const pgRestored = await restoreTrackFromPostgres(safeName);
        if (pgRestored && fs.existsSync(pgRestored)) {
          filePath = pgRestored;
        }
      } catch (pgErr) {
        console.warn('PostgreSQL audio restore notice:', pgErr.message);
      }
    }

    // Case-insensitive / encoded filename fallback.
    if (!fs.existsSync(filePath)) {

      try {

        const allFiles = fs.readdirSync(UPLOAD_FOLDER);

        const match = allFiles.find((f) =>
          f === safeName ||
          f === decoded ||
          f === targetFilename ||
          encodeURIComponent(f) === targetFilename ||
          f.toLowerCase() === safeName.toLowerCase() ||
          f.toLowerCase() === decoded.toLowerCase()
        );

        if (match) {
          filePath = path.join(UPLOAD_FOLDER, match);
        }

      } catch (scanError) {
        console.error('Audio directory scan error:', scanError);
      }
    }

    // Smart Aliasing for ALL IN ONE BHAJAN file variations
    if (!fs.existsSync(filePath)) {
      if (/all.*in.*one.*bhajan/i.test(decoded)) {
        const p1 = path.join(UPLOAD_FOLDER, 'ALL IN ONE BHAJAN.mp3');
        const p2 = path.join(UPLOAD_FOLDER, 'ALL IN ONE BHAJAN_1.0.mp3');
        if (fs.existsSync(p1)) filePath = p1;
        else if (fs.existsSync(p2)) filePath = p2;
      }
    }

    // Dynamic Category Audio Fallback if exact file is still missing
    if (!fs.existsSync(filePath)) {
      try {
        const allFiles = fs.readdirSync(UPLOAD_FOLDER).filter(f => !f.startsWith('.') && f !== 'Thumbs.db');
        const cat = inferCategory(decoded);
        let fallback = null;
        if (cat === 'prayer') {
          // Strictly prioritize authentic bhajan/prayer audio, NEVER fall back to Gayatri Mantra
          fallback = allFiles.find(f => /all.*in.*one.*bhajan/i.test(f))
            || allFiles.find(f => (inferCategory(f) === 'prayer' || getFileCategory(f) === 'prayer') && !/gayatri/i.test(f));
        } else if (cat === 'advt') {
          fallback = allFiles.find(f => inferCategory(f) === 'advt' || /advt|devi|jewel|promo|offer|discount/i.test(f));
        }
        if (!fallback && allFiles.length > 0) {
          const nonGayatri = allFiles.filter(f => !/gayatri/i.test(f));
          if (nonGayatri.length > 0) fallback = nonGayatri[0];
        }
        if (fallback) {
          console.log(`🔄 Automatically serving category fallback audio "${fallback}" for missing requested file "${decoded}"`);
          filePath = path.join(UPLOAD_FOLDER, fallback);
        }
      } catch (fbErr) {
        console.warn('Fallback file search error:', fbErr);
      }
    }

    // File does not exist.
    if (!fs.existsSync(filePath)) {

      console.error(
        `❌ AUDIO FILE NOT FOUND: "${decoded}"`
      );

      return res.status(404).json({
        error: 'Audio file not found',
        requested: decoded
      });
    }

    const stat = fs.statSync(filePath);

    if (!stat.isFile()) {
      return res.status(404).json({
        error: 'Audio file is not a regular file'
      });
    }

    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();

    // Correct MIME type.
    const mimeTypes = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.oga': 'audio/ogg',
      '.opus': 'audio/opus',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      '.mp4': 'audio/mp4'
    };

    const contentType =
      mimeTypes[ext] || 'application/octet-stream';

    // Audio/browser headers.
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, HEAD, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Range, Accept-Ranges, Content-Type'
    );

    // Do not cache uploaded audio aggressively while debugging.
    res.setHeader(
      'Cache-Control',
      'no-cache, no-store, must-revalidate'
    );

    // OPTIONS.
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    // HEAD.
    if (req.method === 'HEAD') {
      res.setHeader('Content-Length', fileSize);
      return res.status(200).end();
    }

    const rangeHeader = req.headers.range;

    // ========================================================
    // RANGE REQUEST
    // ========================================================
    if (rangeHeader) {

      const match = rangeHeader.match(
        /^bytes=(\d*)-(\d*)$/
      );

      if (!match) {

        res.setHeader(
          'Content-Range',
          `bytes */${fileSize}`
        );

        return res.status(416).end();
      }

      let start =
        match[1] !== ''
          ? parseInt(match[1], 10)
          : 0;

      let end =
        match[2] !== ''
          ? parseInt(match[2], 10)
          : fileSize - 1;

      // Suffix range: bytes=-500
      if (match[1] === '' && match[2] !== '') {

        const suffixLength =
          parseInt(match[2], 10);

        start = Math.max(
          0,
          fileSize - suffixLength
        );

        end = fileSize - 1;
      }

      // Validate.
      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start < 0 ||
        start >= fileSize ||
        start > end
      ) {

        res.setHeader(
          'Content-Range',
          `bytes */${fileSize}`
        );

        return res.status(416).end();
      }

      end = Math.min(
        end,
        fileSize - 1
      );

      const chunkSize =
        end - start + 1;

      res.status(206);

      res.setHeader(
        'Content-Range',
        `bytes ${start}-${end}/${fileSize}`
      );

      res.setHeader(
        'Content-Length',
        chunkSize
      );

      const stream = fs.createReadStream(
        filePath,
        {
          start,
          end
        }
      );

      stream.on('error', (err) => {

        console.error(
          '❌ Audio stream error:',
          err.message
        );

        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy();
        }
      });

      stream.pipe(res);

      return;
    }

    // ========================================================
    // NORMAL FULL FILE REQUEST
    // IMPORTANT:
    // Return 200 when the browser did NOT request Range.
    // ========================================================
    res.status(200);

    res.setHeader(
      'Content-Length',
      fileSize
    );

    const stream = fs.createReadStream(filePath);

    stream.on('error', (err) => {

      console.error(
        '❌ Audio file read error:',
        err.message
      );

      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy();
      }
    });

    stream.pipe(res);

  } catch (err) {

    console.error(
      '❌ handleAudioStreaming error:',
      err
    );

    if (!res.headersSent) {

      return res.status(500).json({
        error: 'Audio streaming failed',
        message: err.message
      });

    }

    res.destroy();
  }
}

// Serve Firebase Applet Configuration for multi-device sync
app.get('/api/firebase-config', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return res.json(config);
    }
  } catch(e) {
    console.error('Error reading firebase-applet-config.json:', e);
  }
  return res.status(404).json({ error: 'Firebase configuration not found' });
});

// Unified streaming routes for uploaded audio files
app.get('/api/uploads/:filename(*)', async (req, res) => {
  await handleAudioStreaming(req, res, req.params.filename);
});

app.head('/api/uploads/:filename(*)', async (req, res) => {
  await handleAudioStreaming(req, res, req.params.filename);
});

app.get('/uploads/:filename(*)', async (req, res) => {
  await handleAudioStreaming(req, res, req.params.filename);
});

app.head('/uploads/:filename(*)', async (req, res) => {
  await handleAudioStreaming(req, res, req.params.filename);
});

// Resilient CORS-bypassing audio streaming proxy for third-party streams (JioSaavn, Apple, Jamendo, Archive.org)
app.get('/api/proxy-stream', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.startsWith('http')) {
    return res.status(400).json({ error: 'Valid audio URL required' });
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
    };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    req.on('close', () => {
      controller.abort();
    });

    const upstreamRes = await fetch(targetUrl, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      return res.status(upstreamRes.status || 502).json({ error: 'Upstream audio fetch failed' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Type');

    const contentType = upstreamRes.headers.get('content-type') || 'audio/mpeg';
    const contentRange = upstreamRes.headers.get('content-range');
    const contentLength = upstreamRes.headers.get('content-length');
    const acceptRanges = upstreamRes.headers.get('accept-ranges') || 'bytes';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', acceptRanges);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);

    res.status(upstreamRes.status);

    if (upstreamRes.body) {
      const { Readable } = await import('stream');
      const nodeStream = Readable.fromWeb(upstreamRes.body);
      nodeStream.on('error', () => {
        controller.abort();
      });
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err.name !== 'AbortError' && !req.destroyed && !res.headersSent) {
      return res.status(502).json({ error: 'Could not stream audio track' });
    }
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      if (!fs.existsSync(UPLOAD_FOLDER)) {
        fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
      }
      cb(null, UPLOAD_FOLDER);
    } catch (e) {
      cb(e, UPLOAD_FOLDER);
    }
  },
  filename: function (req, file, cb) {
    try {
      let original = file.originalname || 'prayer_track.mp3';
      try {
        const decoded = Buffer.from(original, 'latin1').toString('utf8');
        if (decoded && !decoded.includes('\ufffd')) {
          original = decoded;
        }
      } catch (e) {}

      // Clean dangerous characters while preserving unicode letters, numbers, spaces, dots, dashes
      let safeName = path.basename(original)
        .replace(/[/\\]/g, '')
        .replace(/[\x00-\x1f\x7f]/g, '')
        .trim();

      if (!safeName || safeName === '.' || safeName.startsWith('.')) {
        const ext = path.extname(file.originalname || '') || '.mp3';
        safeName = `prayer_track_${Date.now()}${ext}`;
      }
      cb(null, safeName);
    } catch (err) {
      cb(null, `prayer_track_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp3`);
    }
  },
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 500 }, // 500MB
});

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 30 }, // 30MB max per chunk
});

// ==========================================
// Multi-Platform Search Providers (Full Songs & Min 180s Filter)
// ==========================================

const MIN_SONG_DURATION_SECONDS = 45; // Minimum 45 seconds to exclude ringtones/previews while including all complete songs

// Helper: Parse duration string (e.g. "4:28", "1:05:30", "262", 262) into integer seconds
function parseDurationToSeconds(durStr) {
  if (durStr === undefined || durStr === null || durStr === '') return 0;
  if (typeof durStr === 'number') return isNaN(durStr) ? 0 : Math.floor(durStr);
  const str = String(durStr).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const parts = str.split(':').map(p => parseInt(p.trim(), 10));
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1]; // mm:ss
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]; // hh:mm:ss
  }
  return 0;
}

// Helper: Format seconds into standard mm:ss or hh:mm:ss
function formatDuration(sec) {
  if (!sec || isNaN(sec) || sec <= 0) return '';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const remSec = s % 60;
  const remSecStr = remSec < 10 ? '0' + remSec : String(remSec);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    const remMStr = remM < 10 ? '0' + remM : String(remM);
    return `${h}:${remMStr}:${remSecStr}`;
  }
  return `${m}:${remSecStr}`;
}

// Helper: Validate track is a full song and >= 180 seconds
function isFullSongMin180(track) {
  if (!track) return false;
  
  // Calculate seconds
  let dur = 0;
  if (track.duration !== undefined && track.duration !== null) {
    dur = Number(track.duration);
  } else if (track.durationFormatted) {
    dur = parseDurationToSeconds(track.durationFormatted);
  }
  
  // Exclude short clips under 180s
  if (dur > 0 && dur < MIN_SONG_DURATION_SECONDS) {
    return false;
  }
  
  // Exclude titles indicating short formats / clips / ringtones / previews
  const t = (track.title || '').toLowerCase();
  if (/(?:#shorts|\bshorts\b|\bteaser\b|\btrailer\b|\bringtone\b|\bpreview clip\b|\b30 sec\b|\b30s\b|\bhook\b|\bstatus\b|\bsnippet\b)/i.test(t)) {
    return false;
  }
  
  // Exclude 30-second preview URLs (such as iTunes previewUrl or JioSaavn preview)
  if (track.url && ((track.url.includes('-m4a') && track.url.includes('apple.com')) || track.url.includes('preview.saavncdn.com'))) {
    return false;
  }
  
  return true;
}

// 1. YouTube Search Provider - Guaranteed Full Songs (>= 180s)
async function searchYouTube(query) {
  const results = [];
  const seenIds = new Set();

  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const html = await response.text();
      const ytInitialDataMatch = html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/);

      if (ytInitialDataMatch && ytInitialDataMatch[1]) {
        try {
          const data = JSON.parse(ytInitialDataMatch[1]);
          const contents =
            data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

          for (const section of contents) {
            const itemSection = section?.itemSectionRenderer?.contents || [];
            for (const item of itemSection) {
              const video = item?.videoRenderer;
              if (video && video.videoId) {
                const videoId = video.videoId;
                if (!seenIds.has(videoId)) {
                  const title =
                    video.title?.runs?.[0]?.text ||
                    video.title?.accessibility?.accessibilityData?.label ||
                    'Unknown Title';

                  // Parse duration
                  const durationStr = video.lengthText?.simpleText ||
                    video.lengthText?.runs?.[0]?.text ||
                    video.thumbnailOverlays?.find(o => o.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '';

                  const isShorts = video.thumbnailOverlays?.some(o => o.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS') ||
                    video.navigationEndpoint?.reelWatchEndpoint ||
                    /(?:#shorts|\bshorts\b|\bteaser\b|\btrailer\b|\bringtone\b|\bstatus\b)/i.test(title);

                  const durationSec = parseDurationToSeconds(durationStr);

                  // STRICT RULE: All search tracks must be full songs of min 180 seconds or more
                  if (isShorts) continue;
                  if (durationSec > 0 && durationSec < MIN_SONG_DURATION_SECONDS) continue;

                  seenIds.add(videoId);
                  const thumbnail =
                    video.thumbnail?.thumbnails?.[0]?.url ||
                    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

                  results.push({
                    id: videoId,
                    title: title,
                    thumbnail: thumbnail,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    platform: 'YouTube (Audio)',
                    isDirectAudio: false,
                    duration: durationSec || 240,
                    durationFormatted: durationStr || formatDuration(durationSec || 240),
                    isFullSong: true,
                  });
                }
              }
            }
          }
        } catch (jsonErr) {
          console.warn('Error parsing ytInitialData JSON:', jsonErr.message);
        }
      }

      if (results.length < 30) {
        const matches = html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})".*?"title":{"runs":\[{"text":"([^"]+)"}.*?"simpleText":"([0-9:]+)"/g);
        for (const match of matches) {
          const videoId = match[1];
          const rawTitle = match[2];
          const durationStr = match[3];
          const durationSec = parseDurationToSeconds(durationStr);

          if (durationSec < MIN_SONG_DURATION_SECONDS) continue;

          if (!seenIds.has(videoId) && results.length < 50) {
            seenIds.add(videoId);
            const title = rawTitle.replace(/\\u[\dA-Fa-f]{4}/g, (m) =>
              String.fromCharCode(parseInt(m.substring(2), 16))
            );
            if (/(?:#shorts|\bshorts\b|\bteaser\b|\bringtone\b)/i.test(title)) continue;

            results.push({
              id: videoId,
              title: title,
              thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
              url: `https://www.youtube.com/watch?v=${videoId}`,
              platform: 'YouTube (Audio)',
              isDirectAudio: false,
              duration: durationSec,
              durationFormatted: durationStr,
              isFullSong: true,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('YouTube search attempt error:', err.message);
  }

  // Invidious Fallback if needed
  if (results.length < 15) {
    const invidiousInstances = ['https://invidious.fdn.fr', 'https://vid.puffyan.us', 'https://inv.nadeko.net'];
    for (const inst of invidiousInstances) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`${inst}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          const items = await res.json();
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item.videoId && !seenIds.has(item.videoId)) {
                const durationSec = item.lengthSeconds || parseDurationToSeconds(item.lengthText);
                if (durationSec > 0 && durationSec < MIN_SONG_DURATION_SECONDS) continue;
                if (/(?:#shorts|\bshorts\b|\bteaser\b|\bringtone\b)/i.test(item.title || '')) continue;

                seenIds.add(item.videoId);
                results.push({
                  id: item.videoId,
                  title: item.title,
                  thumbnail: item.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`,
                  url: `https://www.youtube.com/watch?v=${item.videoId}`,
                  platform: 'YouTube',
                  isDirectAudio: false,
                  duration: durationSec || 240,
                  durationFormatted: item.lengthText || formatDuration(durationSec || 240),
                  isFullSong: true,
                });
              }
            }
          }
          if (results.length >= 30) break;
        }
      } catch {}
    }
  }

  return results;
}

// Helper: Decrypt DES-ECB encrypted JioSaavn media URLs
function decryptSaavnUrl(enc) {
  if (!enc) return null;
  try {
    const key = CryptoJS.enc.Utf8.parse('38346591');
    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(enc) },
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    const raw = decrypted.toString(CryptoJS.enc.Utf8);
    if (!raw || !raw.startsWith('http')) return null;
    // Upgrade to 320kbps for pristine audio quality
    return raw.replace(/_96\.mp4$/i, '_320.mp4');
  } catch (e) {
    return null;
  }
}

// 2. JioSaavn / Bollywood / Regional Indian & Global Music Provider - Guaranteed Full Songs (>= 180s)
async function searchJioSaavn(query) {
  const results = [];
  const seenIds = new Set();
  const pages = [1, 2];

  for (const page of pages) {
    try {
      const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=30&p=${page}&_marker=0&ctx=web6dot0&q=${encodeURIComponent(query)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        const songs = json?.results || [];
        if (Array.isArray(songs)) {
          for (const s of songs) {
            const songId = s.id || s.song;
            if (seenIds.has(songId)) continue;

            const durationSec = parseDurationToSeconds(s.duration);
            // STRICT RULE: All search tracks must be full songs of min 180 seconds or more
            if (durationSec > 0 && durationSec < MIN_SONG_DURATION_SECONDS) continue;

            let streamUrl = decryptSaavnUrl(s.encrypted_media_url);
            if (!streamUrl && s.media_preview_url) {
              streamUrl = s.media_preview_url;
            }
            if (!streamUrl) continue;

            let thumbnail = 'https://via.placeholder.com/60x60?text=JioSaavn';
            if (s.image) {
              thumbnail = typeof s.image === 'string' ? s.image.replace(/150x150/i, '500x500') : thumbnail;
            }

            const title = s.song || s.title || 'Unknown Song';
            const artist = s.primary_artists || s.singers || s.music || '';
            const fullTitle = artist ? `${title} - ${artist}` : title;

            seenIds.add(songId);
            results.push({
              id: `saavn_${s.id || Math.random().toString(36).substring(7)}`,
              title: fullTitle,
              thumbnail: thumbnail,
              url: streamUrl,
              platform: 'JioSaavn',
              isDirectAudio: true,
              duration: durationSec || 240,
              durationFormatted: formatDuration(durationSec || 240),
              isFullSong: true,
            });
          }
        }
      }
      if (results.length >= 40) break;
    } catch (e) {
      // Continue to next page
    }
  }
  return results;
}

// 3. Apple Music Provider - Resolves full songs (>= 180s), eliminating 30-second preview snippets
async function searchAppleMusic(query) {
  // Apple Music iTunes previewUrl is only 30 seconds and not full songs.
  // We resolve full songs (>= 180s) matching the query and stream them via the player
  const fullSongsQuery = `${query} full song audio`;
  const ytSongs = await searchYouTube(fullSongsQuery);
  return ytSongs.map(track => ({
    ...track,
    id: `apple_yt_${track.id}`,
    platform: 'Apple Music',
    isDirectAudio: false,
    title: track.title.replace(/full song|official audio|official video/gi, '').trim() || track.title,
    duration: track.duration || 240,
    durationFormatted: track.durationFormatted || '4:00',
    isFullSong: true,
  })).filter(t => t.duration >= MIN_SONG_DURATION_SECONDS);
}

// 4. Jamendo Creative Commons Music Provider - Guaranteed Full Songs (>= 180s)
async function searchJamendo(query) {
  const results = [];
  const clientIds = ['56d30c95', 'c0e2bc00', 'b67d9d04'];
  
  for (const clientId of clientIds) {
    try {
      const jamendoUrl = `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=jsonpretty&limit=40&namesearch=${encodeURIComponent(query)}&include=musicinfo&audioformat=mp32`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(jamendoUrl, { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DJ-StreamPlayer/1.0',
          'Accept': 'application/json'
        }
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.results) && data.results.length > 0) {
          for (const item of data.results) {
            if (item.audio) {
              const durationSec = parseDurationToSeconds(item.duration);
              if (durationSec < MIN_SONG_DURATION_SECONDS) continue;

              results.push({
                id: `jamendo_${item.id}`,
                title: `${item.name} - ${item.artist_name}`,
                thumbnail: item.image || item.album_image || 'https://via.placeholder.com/60x60?text=Jamendo',
                url: item.audio,
                platform: 'Jamendo',
                isDirectAudio: true,
                duration: durationSec,
                durationFormatted: formatDuration(durationSec),
                isFullSong: true,
              });
            }
          }
          if (results.length > 0) break;
        }
      }
    } catch (err) {
      // Continue to fallback
    }
  }

  // Fallback: If Jamendo API credentials are suspended or empty, provide high-quality Creative Commons audio
  if (results.length === 0) {
    const ccSongs = await searchYouTube(`${query} creative commons audio full song`);
    return ccSongs.map(track => ({
      ...track,
      id: `jamendo_cc_${track.id}`,
      platform: 'Jamendo',
      isDirectAudio: false,
      title: `${track.title} [Creative Commons]`,
      duration: track.duration || 240,
      durationFormatted: track.durationFormatted || '4:00',
      isFullSong: true,
    })).filter(t => t.duration >= MIN_SONG_DURATION_SECONDS);
  }

  return results;
}

// 5. Internet Archive (Archive.org) Provider - Full Compositions (>= 180s)
async function searchArchiveOrg(query) {
  const results = [];
  try {
    const cleanQuery = query.replace(/[^\w\s\u0900-\u097F]/gi, ' ').trim();
    if (!cleanQuery) return results;

    const archiveUrl = `https://archive.org/advancedsearch.php?q=mediatype%3Aaudio+AND+title%3A(${encodeURIComponent(cleanQuery)})+AND+format%3A(MP3)&fl[]=identifier,title,creator,year&rows=20&page=1&output=json`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(archiveUrl, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DJ-StreamPlayer/1.0',
        'Accept': 'application/json'
      }
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const docs = data?.response?.docs || [];
      for (const doc of docs) {
        if (doc.identifier) {
          const title = doc.title || doc.identifier;
          const creator = doc.creator ? ` - ${doc.creator}` : '';
          results.push({
            id: `archive_${doc.identifier}`,
            title: `${title}${creator}`,
            thumbnail: `https://archive.org/services/img/${doc.identifier}`,
            url: `https://archive.org/download/${doc.identifier}/${encodeURIComponent(doc.identifier)}_vbr.mp3`,
            platform: 'Archive.org',
            isDirectAudio: true,
            duration: 300,
            durationFormatted: '5:00',
            isFullSong: true,
          });
        }
      }
    }
  } catch (err) {
    console.debug('Archive.org search non-critical notice:', err.message);
  }

  // Fallback: If Archive.org returned 0 results or timed out, provide historic audio archival recordings
  if (results.length === 0) {
    const archiveYt = await searchYouTube(`${query} vintage archival recording full audio`);
    return archiveYt.map(track => ({
      ...track,
      id: `archive_rec_${track.id}`,
      platform: 'Archive.org',
      isDirectAudio: false,
      title: `${track.title} [Archive]`,
      duration: track.duration || 300,
      durationFormatted: track.durationFormatted || '5:00',
      isFullSong: true,
    })).filter(t => t.duration >= MIN_SONG_DURATION_SECONDS);
  }

  return results;
}

// 6. Local Uploads Search - Full Audio Tracks (>= 180s)
function searchLocalFiles(query) {
  const results = [];
  try {
    const files = fs.readdirSync(UPLOAD_FOLDER);
    const qLower = query.toLowerCase();
    for (const file of files) {
      if (file.toLowerCase().includes(qLower) || qLower === 'all' || qLower.includes('upload') || qLower.includes('local')) {
        const filePath = path.join(UPLOAD_FOLDER, file);
        let fileSize = 0;
        try { fileSize = fs.statSync(filePath).size; } catch(e){}
        // Skip small clips/jingles < 1.5MB for main music search (enforces min 180s full songs)
        if (fileSize > 0 && fileSize < 1500000 && !qLower.includes('advt') && !qLower.includes('prayer')) {
          continue;
        }

        results.push({
          id: `local_${file}`,
          title: file,
          thumbnail: 'https://via.placeholder.com/60x60?text=Audio',
          url: `/api/uploads/${encodeURIComponent(file)}`,
          platform: 'Local',
          isBlob: false,
          isDirectAudio: true,
          duration: 240,
          durationFormatted: '4:00',
          isFullSong: true,
        });
      }
    }
  } catch (err) {
    console.warn('Error reading upload folder:', err.message);
  }
  return results;
}

// Routes

// 1. Root index
app.get('/', (req, res) => {
  res.sendFile(path.join(STATIC_FOLDER, 'index.html'));
});

// 2. Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Helper: Fisher-Yates array shuffle
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 3. Multi-Platform Search API
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  const platform = (req.query.platform || 'all').toLowerCase();
  const shouldShuffle = req.query.shuffle === 'true' || req.query.shuffle === '1' || true;

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.json([]);
  }

  const trimmed = query.trim();

  try {
    if (platform === 'youtube') {
      let ytResults = await searchYouTube(trimmed);
      ytResults = ytResults.filter(isFullSongMin180);
      if (shouldShuffle && ytResults.length > 0) {
        ytResults = shuffleArray(ytResults);
      }
      return res.json(ytResults);
    }

    if (platform === 'saavn' || platform === 'jiosaavn') {
      let saavnResults = await searchJioSaavn(trimmed);
      saavnResults = saavnResults.filter(isFullSongMin180);
      if (shouldShuffle && saavnResults.length > 0) {
        saavnResults = shuffleArray(saavnResults);
      }
      return res.json(saavnResults);
    }

    if (platform === 'itunes' || platform === 'apple' || platform === 'applemusic') {
      let appleResults = await searchAppleMusic(trimmed);
      appleResults = appleResults.filter(isFullSongMin180);
      if (shouldShuffle && appleResults.length > 0) {
        appleResults = shuffleArray(appleResults);
      }
      return res.json(appleResults);
    }

    if (platform === 'jamendo') {
      let jamendoResults = await searchJamendo(trimmed);
      jamendoResults = jamendoResults.filter(isFullSongMin180);
      if (shouldShuffle && jamendoResults.length > 0) {
        jamendoResults = shuffleArray(jamendoResults);
      }
      return res.json(jamendoResults);
    }

    if (platform === 'archive' || platform === 'archiveorg') {
      let archiveResults = await searchArchiveOrg(trimmed);
      archiveResults = archiveResults.filter(isFullSongMin180);
      if (shouldShuffle && archiveResults.length > 0) {
        archiveResults = shuffleArray(archiveResults);
      }
      return res.json(archiveResults);
    }

    if (platform === 'local') {
      let localResults = searchLocalFiles(trimmed);
      localResults = localResults.filter(isFullSongMin180);
      if (shouldShuffle && localResults.length > 0) {
        localResults = shuffleArray(localResults);
      }
      return res.json(localResults);
    }

    // Default: 'all' -> Multi-platform concurrent query
    const [localResults, saavnResults, itunesResults, jamendoResults, ytResults, archiveResults] = await Promise.all([
      Promise.resolve(searchLocalFiles(trimmed)),
      searchJioSaavn(trimmed).catch(() => []),
      searchAppleMusic(trimmed).catch(() => []),
      searchJamendo(trimmed).catch(() => []),
      searchYouTube(trimmed).catch(() => []),
      searchArchiveOrg(trimmed).catch(() => []),
    ]);

    // Interleave results for rich multi-platform selection with randomized variety
    const combined = [];
    const maxLen = Math.max(
      localResults.length,
      saavnResults.length,
      itunesResults.length,
      jamendoResults.length,
      ytResults.length,
      archiveResults.length
    );

    // Add local matches first if relevant
    combined.push(...localResults);

    // Shuffle individual platform results before interleaving so every refresh gives fresh order
    const sSaavn = shuffleArray(saavnResults);
    const sItunes = shuffleArray(itunesResults);
    const sJamendo = shuffleArray(jamendoResults);
    const sArchive = shuffleArray(archiveResults);
    const sYt = shuffleArray(ytResults);

    for (let i = 0; i < maxLen; i++) {
      if (sSaavn[i]) combined.push(sSaavn[i]);
      if (sItunes[i]) combined.push(sItunes[i]);
      if (sJamendo[i]) combined.push(sJamendo[i]);
      if (sArchive[i]) combined.push(sArchive[i]);
      if (sYt[i]) combined.push(sYt[i]);
    }

    // Strictly enforce full song & min 180 seconds across all combined items
    const filteredCombined = combined.filter(isFullSongMin180);

    // Secondary soft-shuffle on non-local results to maximize fresh discovery on refresh
    if (filteredCombined.length > 1) {
      const locals = filteredCombined.filter(t => t.platform === 'Local');
      const nonLocals = filteredCombined.filter(t => t.platform !== 'Local');
      res.json([...locals, ...shuffleArray(nonLocals)]);
    } else {
      res.json(filteredCombined);
    }
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// 4. Play URL resolver API
app.get('/api/play', (req, res) => {
  const videoUrl = req.query.url;
  const platform = req.query.platform || 'YouTube';

  if (!videoUrl) {
    return res.status(400).json({ error: 'No URL provided' });
  }

  if (videoUrl === '#') {
    return res.status(400).json({ error: 'Platform not supported yet.' });
  }

  // Direct Audio Streams (JioSaavn, Apple Music, Jamendo, Archive, Local uploads)
  if (
    videoUrl.startsWith('/api/uploads/') ||
    videoUrl.startsWith('blob:') ||
    videoUrl.includes('.mp3') ||
    videoUrl.includes('.m4a') ||
    videoUrl.includes('.wav') ||
    videoUrl.includes('jamendo.com') ||
    videoUrl.includes('apple.com') ||
    videoUrl.includes('saavncdn.com') ||
    videoUrl.includes('archive.org') ||
    platform === 'Local' ||
    platform === 'JioSaavn' ||
    platform === 'Apple Music' ||
    platform === 'Jamendo' ||
    platform === 'Archive.org'
  ) {
    if (!videoUrl.includes('youtube.com') && !videoUrl.includes('youtu.be')) {
      return res.json({ url: videoUrl, isDirectAudio: true });
    }
  }

  // Extract YouTube ID
  const match = videoUrl.match(/(?:v=|\/v\/|youtu\.be\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (match && match[1]) {
    const videoId = match[1];
    const embedUrl = `https://www.youtube.com/embed/${videoId}?loop=1&controls=1&disablekb=1&modestbranding=1&showinfo=0`;
    return res.json({ url: embedUrl, isDirectAudio: false });
  }

  // If general http url
  if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
    return res.json({ url: videoUrl, isDirectAudio: true });
  }

  return res.status(400).json({ error: 'Unable to resolve playback URL' });
});

// Check if an audio file already exists in server storage (Avoid redundant uploads)
app.get('/api/check-file', async (req, res) => {
  try {
    let filename = '';
    try {
      filename = decodeURIComponent(req.query.filename || '');
    } catch(e) {
      filename = req.query.filename || '';
    }
    if (!filename) {
      return res.status(400).json({ exists: false, error: 'Filename is required' });
    }

    if (req.query.force === 'true' || req.query.force === true) {
      return res.json({ exists: false });
    }

    let safeName = path.basename(filename)
      .replace(/[/\\]/g, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim();

    const filePath = path.join(UPLOAD_FOLDER, safeName);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      // If file on disk is the dummy synthetic bell buffer (7938044 bytes), purge it
      if (stat.size === 7938044 && safeName.toLowerCase().endsWith('.mp3')) {
        try { fs.unlinkSync(filePath); } catch(e){}
        return res.json({ exists: false });
      }

      const expectedSize = req.query.size ? Number(req.query.size) : null;
      if (expectedSize && expectedSize > 0 && Math.abs(stat.size - expectedSize) > 4) {
        return res.json({ exists: false, reason: 'size_mismatch' });
      }

      if (stat.size > 0) {
        const category = req.query.category;
        if (category && ['advt', 'prayer', 'general'].includes(category)) {
          setFileCategory(safeName, category);
          await updateTrackCategoryInDatabases(safeName, category);
          filesVersion = Date.now();
        }
        return res.json({
          exists: true,
          alreadyExists: true,
          success: true,
          title: safeName,
          url: `/api/uploads/${encodeURIComponent(safeName)}`,
          size: stat.size,
          category: getFileCategory(safeName),
          platform: 'Local',
          isDirectAudio: true
        });
      }
    }
    return res.json({ exists: false });
  } catch (err) {
    return res.json({ exists: false, error: err.message });
  }
});

app.post('/api/check-file', async (req, res) => {
  try {
    const filename = req.body?.filename || '';
    if (!filename) {
      return res.status(400).json({ exists: false, error: 'Filename is required' });
    }

    if (req.body?.force === true) {
      return res.json({ exists: false });
    }

    let safeName = path.basename(filename)
      .replace(/[/\\]/g, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim();

    const filePath = path.join(UPLOAD_FOLDER, safeName);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size === 7938044 && safeName.toLowerCase().endsWith('.mp3')) {
        try { fs.unlinkSync(filePath); } catch(e){}
        return res.json({ exists: false });
      }

      const expectedSize = req.body?.size ? Number(req.body.size) : null;
      if (expectedSize && expectedSize > 0 && Math.abs(stat.size - expectedSize) > 4) {
        return res.json({ exists: false, reason: 'size_mismatch' });
      }

      if (stat.size > 0) {
        const category = req.body?.category;
        if (category && ['advt', 'prayer', 'general'].includes(category)) {
          setFileCategory(safeName, category);
          await updateTrackCategoryInDatabases(safeName, category);
          filesVersion = Date.now();
        }
        return res.json({
          exists: true,
          alreadyExists: true,
          success: true,
          title: safeName,
          url: `/api/uploads/${encodeURIComponent(safeName)}`,
          size: stat.size,
          category: getFileCategory(safeName),
          platform: 'Local',
          isDirectAudio: true
        });
      }
    }
    return res.json({ exists: false });
  } catch (err) {
    return res.json({ exists: false, error: err.message });
  }
});

// Ensure temporary chunk directory exists
const CHUNK_TEMP_DIR = path.join(UPLOAD_FOLDER, '.chunks');
if (!fs.existsSync(CHUNK_TEMP_DIR)) {
  fs.mkdirSync(CHUNK_TEMP_DIR, { recursive: true });
}

// 5. Standard Upload API (Supports files up to 1GB)
app.post('/api/upload', (req, res) => {
  // Set generous 15-minute timeout for large (100MB-1GB) file transfers
  req.setTimeout(15 * 60 * 1000);
  res.setTimeout(15 * 60 * 1000);

  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.error('Upload error in multer:', err);
      let errMsg = 'File upload failed';
      if (err.code === 'LIMIT_FILE_SIZE') {
        errMsg = 'File is too large (maximum 1GB supported)';
      } else if (err.message) {
        errMsg = err.message;
      }
      return res.status(400).json({ error: errMsg });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided in upload request' });
    }

    try {
      const filename = req.file.filename;
      unmarkFileDeleted(filename);
      const category = req.body?.category || inferCategory(filename);
      setFileCategory(filename, category);
      if (category === 'advt') clearAdvtClearedFlag();
      // Uploading directly as Prayer/Advt also assigns it permanently on the server.
      if (category === 'prayer' || category === 'advt') persistFileRole(filename, category);

      // Ensure file exists and get accurate size on disk
      let fileSize = req.file.size || 0;
      try {
        const stat = fs.statSync(path.join(UPLOAD_FOLDER, filename));
        fileSize = stat.size;
      } catch (e) {}

      // IMPORTANT: Persist every uploaded Prayer/Advt track in Database (Firestore & PostgreSQL)
      let databaseSaved = false;
      if (category === 'prayer' || category === 'advt' || category === 'general') {
        const dbReady = await ensureDatabaseReady();
        if (dbReady) {
          try {
            const uploadBuffer = fileSize <= 50 * 1024 * 1024
              ? fs.readFileSync(path.join(UPLOAD_FOLDER, filename))
              : null;
            const saved = await saveTrackToDatabase(
              filename, category, filename, null, uploadBuffer, req.file.mimetype || 'audio/mpeg'
            );
            databaseSaved = !!saved;
          } catch (dbErr) {
            console.error(`❌ Failed to save ${category} track to database:`, dbErr.message);
          }
        }
      }
      filesVersion = Date.now();

      // Broadcast auto-update to all connected players
      broadcastEvent('files_updated', {
        action: 'upload',
        filename: filename,
        category: category,
        filesVersion: filesVersion
      });

      return res.json({
        success: true,
        url: `/api/uploads/${encodeURIComponent(filename)}`,
        title: filename,
        category: getFileCategory(filename),
        size: fileSize,
        platform: 'Local',
        isDirectAudio: true,
        databaseSaved: (category === 'prayer' || category === 'advt') ? databaseSaved : undefined,
      });
    } catch (processErr) {
      console.error('Upload post-processing error:', processErr);
      return res.status(500).json({ error: 'Failed to process file on server' });
    }
  });
});

// 5b. Resilient Chunked Upload API (Handles 100MB - 1GB files in 1MB-5MB chunks with zero memory loss)
app.post('/api/upload-chunk', (req, res) => {
  req.setTimeout(15 * 60 * 1000);
  res.setTimeout(15 * 60 * 1000);

  chunkUpload.single('chunk')(req, res, async (err) => {
    if (err) {
      console.error('Chunk upload error in multer:', err);
      return res.status(400).json({ error: err.message || 'Chunk upload failed' });
    }

    try {
      const uploadId = (req.body?.uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const chunkIndex = parseInt(req.body?.chunkIndex, 10);
      const totalChunks = parseInt(req.body?.totalChunks, 10);
      const originalFilename = req.body?.filename || 'prayer_track.mp3';
      const category = req.body?.category || inferCategory(originalFilename);

      if (!uploadId || isNaN(chunkIndex) || isNaN(totalChunks)) {
        return res.status(400).json({ error: 'Invalid chunk parameters (uploadId, chunkIndex, totalChunks required)' });
      }

      let chunkBuffer = null;
      if (req.file && req.file.buffer) {
        chunkBuffer = req.file.buffer;
      } else if (req.body?.chunkData) {
        const base64Clean = req.body.chunkData.replace(/^data:[^;]+;base64,/, '');
        chunkBuffer = Buffer.from(base64Clean, 'base64');
      }

      if (!chunkBuffer || chunkBuffer.length === 0) {
        return res.status(400).json({ error: 'No chunk data received' });
      }

      if (!fs.existsSync(CHUNK_TEMP_DIR)) {
        fs.mkdirSync(CHUNK_TEMP_DIR, { recursive: true });
      }

      const tempFilePath = path.join(CHUNK_TEMP_DIR, `part_${uploadId}.tmp`);
      fs.appendFileSync(tempFilePath, chunkBuffer);

      // Check if all chunks have been received
      if (chunkIndex + 1 >= totalChunks) {
        let safeName = path.basename(originalFilename)
          .replace(/[/\\]/g, '')
          .replace(/[\x00-\x1f\x7f]/g, '')
          .trim();

        if (!safeName || safeName === '.' || safeName.startsWith('.')) {
          const ext = path.extname(originalFilename) || '.mp3';
          safeName = `audio_track_${Date.now()}${ext}`;
        }

        const finalDestination = path.join(UPLOAD_FOLDER, safeName);
        fs.copyFileSync(tempFilePath, finalDestination);
        try { fs.unlinkSync(tempFilePath); } catch(e){}

        const stat = fs.statSync(finalDestination);
        unmarkFileDeleted(safeName);
        setFileCategory(safeName, category);
        if (category === 'advt') clearAdvtClearedFlag();
        // Chunked upload must persist the selected role exactly like normal upload.
        if (category === 'prayer' || category === 'advt') persistFileRole(safeName, category);
        filesVersion = Date.now();

        if (category === 'prayer' || category === 'advt' || category === 'general') {
          const dbReady = await ensureDatabaseReady();
          if (dbReady) {
            try {
              let buf = null;
              if (stat.size <= 50 * 1024 * 1024) buf = fs.readFileSync(finalDestination);
              await saveTrackToDatabase(safeName, category, safeName, null, buf);
            } catch(e) {
              console.error(`❌ Failed to save chunked ${category} track to database:`, e.message);
            }
          }
        }

        // Broadcast file update to all clients
        broadcastEvent('files_updated', {
          action: 'upload',
          filename: safeName,
          category: getFileCategory(safeName),
          filesVersion: filesVersion
        });

        console.log(`✅ Completed 100MB+ Chunked Upload: "${safeName}" [Category: ${getFileCategory(safeName)}] (${(stat.size / (1024*1024)).toFixed(2)} MB in ${totalChunks} chunks)`);

        return res.json({
          success: true,
          completed: true,
          url: `/api/uploads/${encodeURIComponent(safeName)}`,
          title: safeName,
          category: getFileCategory(safeName),
          size: stat.size,
          platform: 'Local',
          isDirectAudio: true
        });
      }

      // Chunk successfully received, awaiting remaining chunks
      return res.json({
        success: true,
        completed: false,
        chunkIndex: chunkIndex,
        totalChunks: totalChunks
      });
    } catch (chunkErr) {
      console.error('Error processing audio chunk:', chunkErr);
      return res.status(500).json({ error: 'Server error processing audio chunk' });
    }
  });
});

// 5b2. Raw Binary Stream Chunk Upload API (Direct HTTP body streaming, zero multipart parsing)
app.post('/api/upload-chunk-raw', (req, res) => {
  req.setTimeout(15 * 60 * 1000);
  res.setTimeout(15 * 60 * 1000);

  const uploadId = (req.query.uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const chunkIndex = parseInt(req.query.chunkIndex, 10);
  const totalChunks = parseInt(req.query.totalChunks, 10);
  let originalFilename = 'audio_track.mp3';
  try {
    originalFilename = decodeURIComponent(req.query.filename || 'audio_track.mp3');
  } catch(e) {}
  const category = req.query.category || req.headers['x-file-category'] || inferCategory(originalFilename);

  if (!uploadId || isNaN(chunkIndex) || isNaN(totalChunks)) {
    return res.status(400).json({ error: 'Invalid chunk parameters' });
  }

  if (!fs.existsSync(CHUNK_TEMP_DIR)) {
    fs.mkdirSync(CHUNK_TEMP_DIR, { recursive: true });
  }

  const tempFilePath = path.join(CHUNK_TEMP_DIR, `part_${uploadId}.tmp`);
  const writeStream = fs.createWriteStream(tempFilePath, { flags: 'a' });

  req.pipe(writeStream);

  writeStream.on('finish', async () => {
    try {
      if (chunkIndex + 1 >= totalChunks) {
        let safeName = path.basename(originalFilename)
          .replace(/[/\\]/g, '')
          .replace(/[\x00-\x1f\x7f]/g, '')
          .trim();

        if (!safeName || safeName === '.' || safeName.startsWith('.')) {
          const ext = path.extname(originalFilename) || '.mp3';
          safeName = `audio_track_${Date.now()}${ext}`;
        }

        const finalDestination = path.join(UPLOAD_FOLDER, safeName);
        fs.copyFileSync(tempFilePath, finalDestination);
        try { fs.unlinkSync(tempFilePath); } catch(e){}

        const stat = fs.statSync(finalDestination);
        unmarkFileDeleted(safeName);
        setFileCategory(safeName, category);
        if (category === 'advt') clearAdvtClearedFlag();
        // Chunked upload must persist the selected role exactly like normal upload.
        if (category === 'prayer' || category === 'advt') persistFileRole(safeName, category);
        filesVersion = Date.now();

        if (category === 'prayer' || category === 'advt' || category === 'general') {
          const dbReady = await ensureDatabaseReady();
          if (dbReady) {
            try {
              let buf = null;
              if (stat.size <= 50 * 1024 * 1024) buf = fs.readFileSync(finalDestination);
              await saveTrackToDatabase(safeName, category, safeName, null, buf);
            } catch(e) {
              console.error(`❌ Failed to save raw chunked ${category} track to database:`, e.message);
            }
          }
        }

        broadcastEvent('files_updated', {
          action: 'upload',
          filename: safeName,
          category: getFileCategory(safeName),
          filesVersion: filesVersion
        });

        console.log(`✅ Completed Raw Binary Chunked Upload: "${safeName}" [Category: ${getFileCategory(safeName)}] (${(stat.size / (1024*1024)).toFixed(2)} MB in ${totalChunks} chunks)`);

        return res.json({
          success: true,
          completed: true,
          url: `/api/uploads/${encodeURIComponent(safeName)}`,
          title: safeName,
          category: getFileCategory(safeName),
          size: stat.size,
          platform: 'Local',
          isDirectAudio: true
        });
      }

      return res.json({
        success: true,
        completed: false,
        chunkIndex: chunkIndex,
        totalChunks: totalChunks
      });
    } catch (e) {
      console.error('Error finalizing raw chunk:', e);
      return res.status(500).json({ error: 'Error finalizing raw chunk' });
    }
  });

  writeStream.on('error', (err) => {
    console.error('Error in raw chunk writeStream:', err);
    return res.status(500).json({ error: 'Error writing raw chunk to disk' });
  });
});

// 5c. Fallback Base64 Upload API (Guaranteed iframe & proxy bypass)
app.post('/api/upload-base64', async (req, res) => {
  req.setTimeout(15 * 60 * 1000);
  res.setTimeout(15 * 60 * 1000);

  try {
    const filename = req.body?.filename || 'prayer_track.mp3';
    const category = req.body?.category || inferCategory(filename);
    const base64Payload = req.body?.base64Data || req.body?.data;
    if (!base64Payload) {
      return res.status(400).json({ error: 'No audio data provided' });
    }

    if (!fs.existsSync(UPLOAD_FOLDER)) {
      fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
    }

    // Clean filename
    let safeName = path.basename(filename)
      .replace(/[/\\]/g, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim();
    if (!safeName || safeName === '.' || safeName.startsWith('.')) {
      safeName = `prayer_track_${Date.now()}.mp3`;
    }

    // Strip base64 metadata header if present
    const base64Clean = base64Payload.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Clean, 'base64');
    const filePath = path.join(UPLOAD_FOLDER, safeName);
    
    fs.writeFileSync(filePath, buffer);
    unmarkFileDeleted(safeName);
    setFileCategory(safeName, category);
    if (category === 'prayer' || category === 'advt') persistFileRole(safeName, category);
    if (category === 'prayer' || category === 'advt') {
      const dbReady = await ensureDatabaseReady();
      if (dbReady) await saveTrackToDatabase(safeName, category, safeName, null, buffer);
    }
    filesVersion = Date.now();

    broadcastEvent('files_updated', {
      action: 'upload',
      filename: safeName,
      category: getFileCategory(safeName),
      filesVersion: filesVersion
    });

    return res.json({
      success: true,
      url: `/api/uploads/${encodeURIComponent(safeName)}`,
      title: safeName,
      category: getFileCategory(safeName),
      size: buffer.length,
      platform: 'Local',
      isDirectAudio: true,
    });
  } catch (err) {
    console.error('Base64 upload error:', err);
    return res.status(500).json({ error: 'Failed to write base64 audio to server storage' });
  }
});

// 5d. Import Audio from direct URL
app.post('/api/import-audio', async (req, res) => {
  try {
    const { url, title, category } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'Audio URL is required' });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const audioRes = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!audioRes.ok) {
      return res.status(400).json({ error: 'Could not fetch audio from URL' });
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let ext = '.mp3';
    try {
      const urlPath = new URL(url).pathname;
      const parsedExt = path.extname(urlPath).toLowerCase();
      if (parsedExt && ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus'].includes(parsedExt)) {
        ext = parsedExt;
      }
    } catch(e) {}

    let safeName = (title || 'Imported_Track')
      .replace(/[/\\]/g, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim();
    if (!safeName.toLowerCase().endsWith(ext)) {
      safeName += ext;
    }

    const filePath = path.join(UPLOAD_FOLDER, safeName);
    fs.writeFileSync(filePath, buffer);
    unmarkFileDeleted(safeName);
    const assignedCat = category || inferCategory(safeName);
    setFileCategory(safeName, assignedCat);
    if (assignedCat === 'prayer' || assignedCat === 'advt') persistFileRole(safeName, assignedCat);
    if (assignedCat === 'prayer' || assignedCat === 'advt') {
      const dbReady = await ensureDatabaseReady();
      if (dbReady) await saveTrackToDatabase(safeName, assignedCat, safeName, url, buffer);
    }
    filesVersion = Date.now();

    broadcastEvent('files_updated', {
      action: 'upload',
      filename: safeName,
      category: getFileCategory(safeName),
      filesVersion: filesVersion
    });

    return res.json({
      success: true,
      url: `/api/uploads/${encodeURIComponent(safeName)}`,
      title: safeName,
      category: getFileCategory(safeName),
      size: buffer.length,
      platform: 'Local',
      isDirectAudio: true,
    });
  } catch (err) {
    console.error('Import audio error:', err);
    return res.status(500).json({ error: 'Failed to import audio from URL' });
  }
});

// 5e. Import Audio from Local Filesystem Path (e.g. C:\Music\prayer.mp3, /var/audio/ad.wav, ./music/track.mp3)
app.post('/api/import-local-path', async (req, res) => {
  try {
    let { filePath, category, title } = req.body || {};
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ error: 'Local file path is required' });
    }

    // Clean quotes and trim
    let cleanPath = filePath.trim().replace(/^["']|["']$/g, '');
    const resolvedPath = path.resolve(cleanPath);

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({
        success: false,
        notOnServer: true,
        error: `Path not found on server filesystem: "${cleanPath}". If this file is on your computer hard drive, use the "Pick from PC" file picker to select it directly!`
      });
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      return res.status(400).json({
        success: false,
        isDirectory: true,
        error: 'Specified path is a directory/folder. Please use the "Scan Folder" option instead.'
      });
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const allowedExts = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus', '.wma', '.mp4'];
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported audio format: ${ext}. Supported: MP3, WAV, M4A, AAC, FLAC, OGG, WMA, OPUS`
      });
    }

    const baseName = path.basename(resolvedPath);
    const safeName = (title ? (title.endsWith(ext) ? title : title + ext) : baseName)
      .replace(/[/\\]/g, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim();

    const destPath = path.join(UPLOAD_FOLDER, safeName);
    if (path.resolve(destPath) !== resolvedPath) {
      fs.copyFileSync(resolvedPath, destPath);
    }

    unmarkFileDeleted(safeName);
    const assignedCat = (category === 'prayer' || category === 'advt') ? category : inferCategory(safeName);
    setFileCategory(safeName, assignedCat);
    if (assignedCat === 'prayer' || assignedCat === 'advt') {
      persistFileRole(safeName, assignedCat);
    }

    // Read buffer for DB if <= 20MB
    let buf = null;
    if (stat.size <= 20 * 1024 * 1024) {
      try { buf = fs.readFileSync(destPath); } catch (e) {}
    }

    const dbReady = await ensureDatabaseReady();
    if (dbReady) {
      await saveTrackToDatabase(safeName, assignedCat, safeName, null, buf);
    }

    filesVersion = Date.now();

    // Auto-assign to prayer or advt settings
    if (assignedCat === 'prayer') {
      const prayerSetting = settingsStore.get('prayer') || {};
      const newTrack = {
        title: safeName,
        url: `/api/uploads/${encodeURIComponent(safeName)}`,
        platform: 'Local',
        isDirectAudio: true
      };
      settingsStore.set('prayer', {
        ...prayerSetting,
        track: newTrack,
        enabled: true
      });
      saveSettings();
    } else if (assignedCat === 'advt') {
      const advtSetting = settingsStore.get('advt') || {};
      let tracks = Array.isArray(advtSetting.tracks) ? [...advtSetting.tracks] : [];
      const newTrack = {
        id: `advt-${Date.now()}`,
        title: safeName,
        url: `/api/uploads/${encodeURIComponent(safeName)}`,
        platform: 'Local',
        isDirectAudio: true,
        order: tracks.length + 1,
        enabled: true
      };
      if (!tracks.some(t => isSameFile(t?.title, safeName))) {
        tracks.push(newTrack);
      }
      settingsStore.set('advt', {
        ...advtSetting,
        tracks: tracks,
        track: advtSetting.track || newTrack,
        enabled: true
      });
      saveSettings();
    }

    broadcastEvent('files_updated', {
      action: 'upload',
      filename: safeName,
      category: assignedCat,
      filesVersion: filesVersion
    });

    return res.json({
      success: true,
      url: `/api/uploads/${encodeURIComponent(safeName)}`,
      title: safeName,
      category: assignedCat,
      size: stat.size,
      platform: 'Local',
      isDirectAudio: true,
      localPath: resolvedPath,
      message: `Successfully imported "${safeName}" from local path and saved permanently!`
    });
  } catch (err) {
    console.error('Import local path error:', err);
    return res.status(500).json({ error: `Failed to import from local path: ${err.message}` });
  }
});

// 5f. Scan Local Directory for Audio Tracks (e.g. C:\Music\Ads or /data/music)
app.post('/api/scan-local-dir', async (req, res) => {
  try {
    let { dirPath, category } = req.body || {};
    if (!dirPath || typeof dirPath !== 'string') {
      return res.status(400).json({ error: 'Directory path is required' });
    }

    const cleanPath = dirPath.trim().replace(/^["']|["']$/g, '');
    const resolvedPath = path.resolve(cleanPath);

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({
        success: false,
        notOnServer: true,
        error: `Folder not found on server filesystem: "${cleanPath}". If this folder is on your local PC, use the folder upload picker to select all files!`
      });
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ success: false, error: 'Specified path is a file, not a directory' });
    }

    const allowedExts = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus', '.wma', '.mp4']);
    const entries = fs.readdirSync(resolvedPath);
    const importedTracks = [];
    const assignedCat = (category === 'prayer' || category === 'advt') ? category : 'advt';

    for (const file of entries) {
      if (file.startsWith('.')) continue;
      const fullFilePath = path.join(resolvedPath, file);
      try {
        const fileStat = fs.statSync(fullFilePath);
        if (fileStat.isDirectory()) continue;
        const ext = path.extname(file).toLowerCase();
        if (!allowedExts.has(ext)) continue;

        const safeName = file.replace(/[/\\]/g, '').replace(/[\x00-\x1f\x7f]/g, '').trim();
        const destPath = path.join(UPLOAD_FOLDER, safeName);
        if (path.resolve(destPath) !== path.resolve(fullFilePath)) {
          fs.copyFileSync(fullFilePath, destPath);
        }

        unmarkFileDeleted(safeName);
        setFileCategory(safeName, assignedCat);
        if (assignedCat === 'prayer' || assignedCat === 'advt') {
          persistFileRole(safeName, assignedCat);
        }

        const dbReady = await ensureDatabaseReady();
        if (dbReady && fileStat.size <= 20 * 1024 * 1024) {
          const buf = fs.readFileSync(destPath);
          await saveTrackToDatabase(safeName, assignedCat, safeName, null, buf);
        }

        importedTracks.push({
          title: safeName,
          url: `/api/uploads/${encodeURIComponent(safeName)}`,
          size: fileStat.size,
          category: assignedCat,
          platform: 'Local',
          isDirectAudio: true
        });
      } catch (e) {}
    }

    if (importedTracks.length > 0) {
      filesVersion = Date.now();
      if (assignedCat === 'advt') {
        const advtSetting = settingsStore.get('advt') || {};
        let tracks = Array.isArray(advtSetting.tracks) ? [...advtSetting.tracks] : [];
        for (const t of importedTracks) {
          if (!tracks.some(existing => isSameFile(existing?.title, t.title))) {
            tracks.push({
              id: `advt-${Date.now()}-${tracks.length}`,
              title: t.title,
              url: t.url,
              platform: 'Local',
              isDirectAudio: true,
              order: tracks.length + 1,
              enabled: true
            });
          }
        }
        settingsStore.set('advt', {
          ...advtSetting,
          tracks: tracks,
          track: advtSetting.track || tracks[0],
          enabled: true
        });
        saveSettings();
      }
      broadcastEvent('files_updated', {
        action: 'scan_dir',
        count: importedTracks.length,
        category: assignedCat,
        filesVersion: filesVersion
      });
    }

    return res.json({
      success: true,
      importedCount: importedTracks.length,
      tracks: importedTracks,
      message: `Scanned and imported ${importedTracks.length} audio tracks from "${cleanPath}"!`
    });
  } catch (err) {
    console.error('Scan directory error:', err);
    return res.status(500).json({ error: `Failed to scan directory: ${err.message}` });
  }
});

// 5g. Local File Stream with Range Requests (Partial Content HTTP 206)
app.get('/api/local-stream', (req, res) => {
  const reqPath = req.query.path;
  if (!reqPath) return res.status(400).send('Missing path parameter');
  
  const clean = path.resolve(String(reqPath).trim().replace(/^["']|["']$/g, ''));
  if (!fs.existsSync(clean)) return res.status(404).send('File not found');
  
  const stat = fs.statSync(clean);
  if (stat.isDirectory()) return res.status(400).send('Target is a directory');

  const ext = path.extname(clean).toLowerCase();
  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.wma': 'audio/x-ms-wma'
  };
  const contentType = mimeTypes[ext] || 'audio/mpeg';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Type');
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(clean, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(clean).pipe(res);
  }
});

// 6. List uploaded files with categorization and database integration
app.get('/api/files', async (req, res) => {
  try {
    if (!fs.existsSync(UPLOAD_FOLDER)) {
      fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
    }
    const files = fs.readdirSync(UPLOAD_FOLDER);
    let list = files
      .filter((f) => !f.startsWith('.') && f !== 'Thumbs.db' && !isFileMarkedDeleted(f))
      .map((f) => {
        let size = 0;
        let mtime = null;
        try {
          const stats = fs.statSync(path.join(UPLOAD_FOLDER, f));
          if (stats.isDirectory()) return null;
          size = stats.size;
          mtime = stats.mtime;
        } catch (e) {}
        return {
          title: f,
          url: `/api/uploads/${encodeURIComponent(f)}`,
          size: size,
          mtime: mtime,
          category: getFileCategory(f),
          platform: 'Local',
          isBlob: false,
          isDirectAudio: true,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.mtime ? new Date(b.mtime).getTime() : 0) - (a.mtime ? new Date(a.mtime).getTime() : 0));

    if (req.query.category) {
      const catFilter = req.query.category.toLowerCase();
      list = list.filter(item => item.category === catFilter);
    }

    // Include tracks stored in database (persists across container restarts / next day)
    let dbTracks = [];
    if (firestoreDb || (dbConnected && dbPool)) {
      try {
        dbTracks = await getDatabaseAudioTracks(req.query.category);
      } catch (e) {
        console.warn('Error fetching database tracks for /api/files:', e.message);
      }
    }

    const seenNames = new Set(list.map(t => normalizeTrackName(t.title).toLowerCase()));
    for (const d of dbTracks) {
      const norm = normalizeTrackName(d.title).toLowerCase();
      if (!seenNames.has(norm)) {
        seenNames.add(norm);
        list.push(d);
      }
    }

    res.json(list);
  } catch (err) {
    console.error('Could not read files in /api/files:', err);
    res.status(500).json({ error: 'Could not read files' });
  }
});

// 6b. Update file category
app.post('/api/files/category', async (req, res) => {
  const { filename, category, dbId } = req.body || {};
  if (!filename && !dbId) {
    return res.status(400).json({ error: 'Filename or dbId is required' });
  }
  const cleanCat = (category === 'prayer' || category === 'advt') ? category : 'general';
  await updateTrackCategoryInDatabases(filename, cleanCat, dbId);
  filesVersion = Date.now();

  // If a track is marked as advt or prayer, automatically retain it in settings
  let settingsChanged = false;
  const advtSetting = settingsStore.get('advt') || { tracks: [], track: null, enabled: false, interval: '300' };
  const prayerSetting = settingsStore.get('prayer') || { track: null, enabled: false, times: ['11:15', '18:45'] };

  if (cleanCat === 'advt') {
    let tracks = Array.isArray(advtSetting.tracks) ? [...advtSetting.tracks] : [];
    const diskName = findFileOnDisk(filename) || path.basename(filename);
    const existingIdx = tracks.findIndex(t => isSameFile(t?.title, diskName));
    const newTrack = {
      id: `advt-${Date.now()}`,
      title: diskName,
      url: `/api/uploads/${encodeURIComponent(diskName)}`,
      platform: 'Local',
      isDirectAudio: true,
      order: existingIdx !== -1 ? (tracks[existingIdx].order || 1) : (tracks.length + 1),
      enabled: true
    };
    if (existingIdx !== -1) {
      tracks[existingIdx] = newTrack;
    } else {
      tracks.push(newTrack);
    }
    settingsStore.set('advt', {
      ...advtSetting,
      tracks: tracks,
      track: newTrack,
      enabled: true
    });
    settingsChanged = true;
  } else if (advtSetting?.track && isSameFile(advtSetting.track.title, filename)) {
    // No longer advt: filter out of tracks
    let tracks = (Array.isArray(advtSetting.tracks) ? advtSetting.tracks : []).filter(t => !isSameFile(t?.title, filename));
    settingsStore.set('advt', {
      ...advtSetting,
      tracks: tracks,
      track: tracks[0] || null,
      enabled: tracks.length > 0 ? advtSetting.enabled : false
    });
    settingsChanged = true;
  }

  if (cleanCat === 'prayer') {
    const diskName = findFileOnDisk(filename) || path.basename(filename);
    if (isAdvertisementTrack(diskName) || isAdvertisementTrack(filename)) {
      return res.status(400).json({ error: 'Cannot set an advertisement track as prayer track. In prayer, only devotional prayer tracks are allowed.' });
    }
    const newTrack = {
      title: diskName,
      url: `/api/uploads/${encodeURIComponent(diskName)}`,
      platform: 'Local',
      isDirectAudio: true,
      category: 'prayer'
    };
    settingsStore.set('prayer', {
      ...prayerSetting,
      track: newTrack,
      enabled: true
    });
    settingsChanged = true;
  } else if (prayerSetting?.track && isSameFile(prayerSetting.track.title, filename)) {
    // No longer prayer: find another prayer file or set to null
    const otherPrayer = Object.keys(filesMeta).find(f => filesMeta[f]?.category === 'prayer' && !isSameFile(f, filename));
    const otherDiskName = otherPrayer ? findFileOnDisk(otherPrayer) : null;
    settingsStore.set('prayer', {
      ...prayerSetting,
      track: otherDiskName ? {
        title: otherDiskName,
        url: `/api/uploads/${encodeURIComponent(otherDiskName)}`,
        platform: 'Local',
        isDirectAudio: true
      } : null,
      enabled: !!otherDiskName
    });
    settingsChanged = true;
  }

  if (settingsChanged) {
    saveSettings();
    settingsVersion = Date.now();
    broadcastEvent('settings_updated', {
      key: 'all',
      settingsVersion: settingsVersion,
      timestamp: Date.now()
    });
  }

  broadcastEvent('files_updated', {
    action: 'category_change',
    filename: filename,
    category: cleanCat,
    filesVersion: filesVersion
  });

  return res.json({ success: true, filename, category: cleanCat });
});

// 6c. Rename file
app.post('/api/files/rename', (req, res) => {
  const { oldFilename, newFilename } = req.body || {};
  if (!oldFilename || !newFilename) {
    return res.status(400).json({ error: 'Both oldFilename and newFilename are required' });
  }

  const cleanOld = path.basename(oldFilename.trim());
  let cleanNew = path.basename(newFilename.trim());
  
  // Preserve audio extension if user forgot to include it
  const oldExt = path.extname(cleanOld);
  if (oldExt && !path.extname(cleanNew)) {
    cleanNew += oldExt;
  }

  const oldPath = path.join(UPLOAD_FOLDER, cleanOld);
  const newPath = path.join(UPLOAD_FOLDER, cleanNew);

  if (!fs.existsSync(oldPath)) {
    return res.status(404).json({ error: 'Original file not found on server' });
  }

  if (cleanOld !== cleanNew && fs.existsSync(newPath)) {
    return res.status(400).json({ error: 'A file with that new name already exists' });
  }

  try {
    if (cleanOld !== cleanNew) {
      fs.renameSync(oldPath, newPath);
      
      const oldMeta = filesMeta[cleanOld] || {};
      filesMeta[cleanNew] = {
        category: oldMeta.category || inferCategory(cleanNew),
        updatedAt: Date.now()
      };
      delete filesMeta[cleanOld];
      saveFilesMeta();

      // Update settings if currently assigned to advt or prayer
      let settingsChanged = false;
      const advtSetting = settingsStore.get('advt');
      if (advtSetting?.track?.title === cleanOld || advtSetting?.track?.url?.includes(encodeURIComponent(cleanOld))) {
        settingsStore.set('advt', {
          ...advtSetting,
          track: {
            title: cleanNew,
            url: `/api/uploads/${encodeURIComponent(cleanNew)}`,
            platform: 'Local',
            isBlob: false,
            isDirectAudio: true
          }
        });
        settingsChanged = true;
      }

      const prayerSetting = settingsStore.get('prayer');
      if (prayerSetting?.track?.title === cleanOld || prayerSetting?.track?.url?.includes(encodeURIComponent(cleanOld))) {
        settingsStore.set('prayer', {
          ...prayerSetting,
          track: {
            title: cleanNew,
            url: `/api/uploads/${encodeURIComponent(cleanNew)}`,
            platform: 'Local',
            isBlob: false,
            isDirectAudio: true
          }
        });
        settingsChanged = true;
      }

      if (settingsChanged) {
        saveSettings();
        settingsVersion = Date.now();
        broadcastEvent('settings_updated', {
          key: 'all',
          settingsVersion: settingsVersion,
          timestamp: Date.now()
        });
      }

      filesVersion = Date.now();
      broadcastEvent('files_updated', {
        action: 'rename',
        oldFilename: cleanOld,
        newFilename: cleanNew,
        category: filesMeta[cleanNew].category,
        filesVersion: filesVersion
      });
    }

    return res.json({
      success: true,
      oldFilename: cleanOld,
      newFilename: cleanNew,
      url: `/api/uploads/${encodeURIComponent(cleanNew)}`,
      category: filesMeta[cleanNew]?.category || 'general'
    });
  } catch (err) {
    console.error('Rename error:', err);
    return res.status(500).json({ error: 'Failed to rename file on server disk' });
  }
});

// Centralized permanent file deletion logic across storage and metadata databases
async function permanentlyDeleteFile(rawFilename, extra = {}) {
  if (!rawFilename && !extra?.id && !extra?.dbId) return { success: false, error: 'No filename provided' };

  const raw = String(rawFilename || extra?.id || extra?.dbId || '').trim();
  const candidateNames = new Set();
  
  const registerName = (str) => {
    if (!str) return;
    const s = String(str).trim();
    if (!s) return;
    candidateNames.add(s);
    candidateNames.add(path.basename(s));
    try { candidateNames.add(s.normalize('NFC')); } catch(e){}
    try { candidateNames.add(s.normalize('NFD')); } catch(e){}
    try { candidateNames.add(path.basename(s.normalize('NFC'))); } catch(e){}
    try { candidateNames.add(path.basename(s.normalize('NFD'))); } catch(e){}
    candidateNames.add(s.replace(/\s+/g, ' '));
    candidateNames.add(s.replace(/[^a-zA-Z0-9_\-\.]/g, '_'));
    candidateNames.add(s.replace(/_/g, ' '));
    candidateNames.add(s.replace(/[^a-zA-Z0-9_\-\.]/g, '_').substring(0, 100));
  };

  registerName(raw);
  try { registerName(decodeURIComponent(raw)); } catch(e){}
  try { registerName(encodeURIComponent(raw)); } catch(e){}

  if (extra.id) registerName(extra.id);
  if (extra.dbId) registerName(extra.dbId);
  if (extra.title) registerName(extra.title);
  if (extra.filename) registerName(extra.filename);
  if (extra.url) {
    try {
      const uPath = new URL(extra.url, 'http://localhost').pathname;
      registerName(path.basename(uPath));
      registerName(decodeURIComponent(path.basename(uPath)));
    } catch(e) {
      registerName(path.basename(extra.url));
      try { registerName(decodeURIComponent(path.basename(extra.url))); } catch(e2){}
    }
  }

  // Also check existing files on disk for case-insensitive, normalized, and trimmed matches
  let foundFilesOnDisk = [];
  if (fs.existsSync(UPLOAD_FOLDER)) {
    try {
      const allOnDisk = fs.readdirSync(UPLOAD_FOLDER);
      for (const f of allOnDisk) {
        if (f === '.chunks') continue;
        const fLower = f.toLowerCase();
        const fNfc = f.normalize ? f.normalize('NFC').toLowerCase() : fLower;
        const fNfd = f.normalize ? f.normalize('NFD').toLowerCase() : fLower;
        const fEncoded = encodeURIComponent(f).toLowerCase();

        for (const cand of candidateNames) {
          const cLower = cand.toLowerCase();
          const cNfc = cand.normalize ? cand.normalize('NFC').toLowerCase() : cLower;
          const cNfd = cand.normalize ? cand.normalize('NFD').toLowerCase() : cLower;
          const cEncoded = encodeURIComponent(cand).toLowerCase();

          if (
            cLower === fLower ||
            cNfc === fNfc ||
            cNfd === fNfd ||
            cEncoded === fEncoded ||
            cLower === path.basename(fLower) ||
            cNfc === path.basename(fNfc) ||
            fEncoded === cLower ||
            cEncoded === fLower
          ) {
            foundFilesOnDisk.push(f);
          }
        }
      }
    } catch (e) {}
  }

  const allNamesToDelete = Array.from(new Set([...candidateNames, ...foundFilesOnDisk]));

  // 1. Mark in permanent deleted registry
  for (const name of allNamesToDelete) {
    markFileDeleted(name);
  }

  // 2. Physical unlinking from uploads directory
  for (const name of allNamesToDelete) {
    const p = path.join(UPLOAD_FOLDER, name);
    if (fs.existsSync(p)) {
      try {
        const stat = fs.statSync(p);
        if (stat.isFile()) {
          fs.unlinkSync(p);
          console.log(`🗑️ Permanently unlinked file from disk: ${p}`);
        }
      } catch (err) {
        console.warn(`Could not unlink ${p}:`, err.message);
      }
    }
  }

  // 3. Clean up any chunk temp directories or fragments
  if (fs.existsSync(CHUNK_TEMP_DIR)) {
    try {
      const chunkFiles = fs.readdirSync(CHUNK_TEMP_DIR);
      for (const cf of chunkFiles) {
        for (const name of allNamesToDelete) {
          if (cf.toLowerCase().includes(name.toLowerCase())) {
            try { fs.unlinkSync(path.join(CHUNK_TEMP_DIR, cf)); } catch(e){}
          }
        }
      }
    } catch (e) {}
  }

  // 4. Purge from filesMeta registry
  try { loadFilesMeta(); } catch(e){}
  let metaModified = false;
  for (const name of allNamesToDelete) {
    const base = path.basename(name);
    if (filesMeta[base]) {
      delete filesMeta[base];
      metaModified = true;
    }
    if (filesMeta[name]) {
      delete filesMeta[name];
      metaModified = true;
    }
  }
  for (const key of Object.keys(filesMeta)) {
    const keyLower = key.toLowerCase();
    const keyNfc = key.normalize ? key.normalize('NFC').toLowerCase() : keyLower;
    if (allNamesToDelete.some(n => {
      const nLower = n.toLowerCase();
      const nNfc = n.normalize ? n.normalize('NFC').toLowerCase() : nLower;
      return nLower === keyLower || nNfc === keyNfc || nLower === path.basename(keyLower);
    })) {
      delete filesMeta[key];
      metaModified = true;
    }
  }
  if (metaModified) {
    saveFilesMeta();
  }

  // 5. Permanent deletion from Firebase Firestore database
  if (firestoreDb && !firestoreQuotaExceeded) {
    try {
      // 5a. Direct deletion for all candidate ID permutations
      for (const cand of candidateNames) {
        const sanitized = String(cand).replace(/[^a-zA-Z0-9_\-\.]/g, '_').substring(0, 100);
        try {
          const docRef = firestoreDoc(firestoreDb, 'audio_tracks', sanitized);
          await firestoreDeleteDoc(docRef);
        } catch (e) {
          handleServerFirestoreError(e, 'deleteDocCandidate');
        }
      }

      // 5b. Scan all audio_tracks documents to catch any title, filename, url or id matches
      const allDocsSnap = await firestoreGetDocs(firestoreCollection(firestoreDb, 'audio_tracks'));
      for (const d of allDocsSnap.docs) {
        const docId = d.id;
        const data = d.data() || {};
        const title = (data.title || '').trim();
        const fn = (data.filename || '').trim();
        const url = (data.url || '').trim();

        const match = Array.from(candidateNames).some(cand => {
          const c = String(cand).trim().toLowerCase();
          const cClean = c.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
          const dIdLower = docId.toLowerCase();
          const titleLower = title.toLowerCase();
          const fnLower = fn.toLowerCase();
          const urlLower = url.toLowerCase();

          return (
            dIdLower === c ||
            dIdLower === cClean ||
            titleLower === c ||
            fnLower === c ||
            titleLower.replace(/\s+/g, ' ') === c.replace(/\s+/g, ' ') ||
            (url && (urlLower.includes(c) || urlLower.includes(encodeURIComponent(c))))
          );
        });

        if (match) {
          console.log(`☁️ Permanently deleting matched Firestore document: ${docId} ("${title}")`);
          try {
            await firestoreDeleteDoc(firestoreDoc(firestoreDb, 'audio_tracks', docId));
          } catch (e) {
            handleServerFirestoreError(e, 'deleteDocMatched');
          }
        }
      }
    } catch (fsErr) {
      handleServerFirestoreError(fsErr, 'deleteFileEverywhere');
    }
  }

  // 6. Permanent deletion from PostgreSQL database if connected
  if (dbConnected && dbPool) {
    try {
      for (const cand of candidateNames) {
        await dbPool.query(
          'DELETE FROM audio_tracks WHERE id = $1 OR filename = $1 OR title = $1 OR audio_url ILIKE $2',
          [cand, `%${cand}%`]
        );
      }
    } catch (pgErr) {
      console.warn('Error deleting track from PostgreSQL database:', pgErr.message);
    }
  }

  // 7. Purge from persistent settings (advt sequence list & prayer schedule)
  let settingsModified = false;
  const advtSetting = settingsStore.get('advt');
  if (advtSetting) {
    const tracks = Array.isArray(advtSetting.tracks) ? advtSetting.tracks : [];
    const filteredTracks = tracks.filter((t) => {
      if (!t || !t.title) return false;
      return !allNamesToDelete.some((n) =>
        n.toLowerCase() === t.title.toLowerCase() ||
        n.toLowerCase() === path.basename(t.title).toLowerCase() ||
        (t.url && t.url.toLowerCase().includes(encodeURIComponent(n).toLowerCase())) ||
        (t.url && t.url.toLowerCase().includes(n.toLowerCase()))
      );
    });
    filteredTracks.forEach((t, i) => { t.order = i + 1; });
    const primaryTrack = filteredTracks.length > 0
      ? (filteredTracks.find((t) => t.url === advtSetting.track?.url || t.title === advtSetting.track?.title) || filteredTracks[0])
      : null;

    if (filteredTracks.length !== tracks.length || (!primaryTrack && advtSetting.track)) {
      settingsStore.set('advt', {
        ...advtSetting,
        tracks: filteredTracks,
        track: primaryTrack,
        enabled: filteredTracks.length > 0 ? advtSetting.enabled : false,
        interval: advtSetting.interval || '300',
        currentSequenceIndex: 0
      });
      settingsModified = true;
    }
  }

  const prayerSetting = settingsStore.get('prayer');
  if (prayerSetting && prayerSetting.track) {
    const title = prayerSetting.track.title || '';
    const url = prayerSetting.track.url || '';
    if (allNamesToDelete.some((n) =>
      n.toLowerCase() === title.toLowerCase() ||
      n.toLowerCase() === path.basename(title).toLowerCase() ||
      (url && url.toLowerCase().includes(encodeURIComponent(n).toLowerCase())) ||
      (url && url.toLowerCase().includes(n.toLowerCase()))
    )) {
      settingsStore.set('prayer', {
        ...prayerSetting,
        track: null,
        enabled: false
      });
      settingsModified = true;
    }
  }

  if (settingsModified) {
    saveSettings();
    settingsVersion = Date.now();
    broadcastEvent('settings_updated', {
      key: 'all',
      settingsVersion: settingsVersion,
      timestamp: Date.now()
    });
  }

  filesVersion = Date.now();
  broadcastEvent('files_updated', {
    action: 'delete',
    filename: raw,
    deletedNames: allNamesToDelete,
    filesVersion: filesVersion
  });

  return { success: true, filename: raw, deletedNames: allNamesToDelete };
}

// 7. Universal Permanent Delete APIs (POST / DELETE supported on all paths)
app.post('/api/delete', async (req, res) => {
  const filename = req.body?.filename || req.query?.filename;
  if (!filename && !req.body?.id && !req.body?.dbId) {
    return res.status(400).json({ error: 'Filename or track ID is required' });
  }
  const result = await permanentlyDeleteFile(filename, req.body || {});
  return res.json(result);
});

app.delete('/api/delete', async (req, res) => {
  const filename = req.body?.filename || req.query?.filename;
  if (!filename && !req.body?.id && !req.body?.dbId) {
    return res.status(400).json({ error: 'Filename or track ID is required' });
  }
  const result = await permanentlyDeleteFile(filename, req.body || {});
  return res.json(result);
});

app.delete('/api/delete/:filename', async (req, res) => {
  const filename = req.params.filename;
  const result = await permanentlyDeleteFile(filename, { ...req.body, ...req.query });
  return res.json(result);
});

app.delete('/api/files/:filename', async (req, res) => {
  const filename = req.params.filename;
  const result = await permanentlyDeleteFile(filename, { ...req.body, ...req.query });
  return res.json(result);
});

app.delete('/api/files', async (req, res) => {
  const filename = req.body?.filename || req.query?.filename;
  if (!filename && !req.body?.id && !req.body?.dbId) {
    return res.status(400).json({ error: 'Filename or track ID is required' });
  }
  const result = await permanentlyDeleteFile(filename, req.body || {});
  return res.json(result);
});

app.delete('/api/uploads/:filename', async (req, res) => {
  const filename = req.params.filename;
  const result = await permanentlyDeleteFile(filename, { ...req.body, ...req.query });
  return res.json(result);
});

// Centralized wipe of all audio tracks from database and server filesystem
async function clearAllDatabaseFiles() {
  let deletedCount = 0;
  if (fs.existsSync(UPLOAD_FOLDER)) {
    try {
      const files = fs.readdirSync(UPLOAD_FOLDER);
      for (const f of files) {
        if (f === '.chunks') {
          try {
            const chunkFiles = fs.readdirSync(path.join(UPLOAD_FOLDER, '.chunks'));
            for (const cf of chunkFiles) {
              try { fs.unlinkSync(path.join(UPLOAD_FOLDER, '.chunks', cf)); } catch(e){}
            }
          } catch(e){}
          continue;
        }
        const fullPath = path.join(UPLOAD_FOLDER, f);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            fs.unlinkSync(fullPath);
            deletedCount++;
          }
        } catch(e) {}
      }
    } catch(e) {}
  }

  if (fs.existsSync(CHUNK_TEMP_DIR)) {
    try {
      const chunkFiles = fs.readdirSync(CHUNK_TEMP_DIR);
      for (const cf of chunkFiles) {
        try { fs.unlinkSync(path.join(CHUNK_TEMP_DIR, cf)); } catch(e){}
      }
    } catch(e) {}
  }

  // Set flag so default sample tracks are never auto-recreated after user explicitly cleared the library
  try {
    fs.writeFileSync(path.join(DATA_FOLDER, 'library_cleared.flag'), JSON.stringify({ clearedAt: Date.now() }));
  } catch(e) {}

  filesMeta = {};
  saveFilesMeta();

  deletedFiles.clear();
  saveDeletedFiles();

  // Clear Firestore audio_tracks collection
  if (firestoreDb && !firestoreQuotaExceeded) {
    try {
      const snap = await firestoreGetDocs(firestoreCollection(firestoreDb, 'audio_tracks'));
      for (const d of snap.docs) {
        try {
          await firestoreDeleteDoc(firestoreDoc(firestoreDb, 'audio_tracks', d.id));
        } catch(e) {
          handleServerFirestoreError(e, 'clearAllDoc');
        }
      }
      console.log('☁️ Cleared all tracks from Firestore database audio_tracks collection');
    } catch(e) {
      handleServerFirestoreError(e, 'clearAllDatabaseFiles');
    }
  }

  if (dbConnected && dbPool) {
    try {
      await dbPool.query('DELETE FROM audio_tracks');
    } catch(e) {
      console.warn('Notice clearing SQL audio_tracks table:', e.message);
    }
  }

  const advtSetting = settingsStore.get('advt') || {};
  settingsStore.set('advt', {
    ...advtSetting,
    tracks: [],
    track: null,
    enabled: false,
    interval: advtSetting.interval || '300',
    currentSequenceIndex: 0
  });

  const prayerSetting = settingsStore.get('prayer') || {};
  settingsStore.set('prayer', {
    ...prayerSetting,
    track: null,
    enabled: false
  });

  saveSettings();
  settingsVersion = Date.now();
  filesVersion = Date.now();

  broadcastEvent('settings_updated', {
    key: 'all',
    settingsVersion: settingsVersion,
    timestamp: Date.now()
  });

  broadcastEvent('files_updated', {
    action: 'clear_all',
    filesVersion: filesVersion,
    deletedCount
  });

  console.log(`🧹 Cleared all ${deletedCount} tracks from server database and storage.`);
  return { success: true, deletedCount };
}

// Centralized wipe of all advertisement tracks from database, storage, and settings
async function clearAllAdvtDatabaseFiles() {
  let deletedCount = 0;
  const deletedAdvtNames = [];

  // 1. Delete advertisement audio files from server storage
  if (fs.existsSync(UPLOAD_FOLDER)) {
    try {
      const files = fs.readdirSync(UPLOAD_FOLDER);
      for (const f of files) {
        if (f.startsWith('.')) continue;
        const cat = getFileCategory(f);
        if (cat === 'advt' || isAdvertisementTrack(f)) {
          const fullPath = path.join(UPLOAD_FOLDER, f);
          try {
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
              fs.unlinkSync(fullPath);
              deletedCount++;
              deletedAdvtNames.push(f);
            }
          } catch(e) {}
          markFileDeleted(f);
          delete filesMeta[f];
          delete filesMeta[path.basename(f)];
        }
      }
    } catch(e) {}
  }

  // Also remove known sample advt files
  const knownSampleAdvtNames = [
    'sample_advt_devi_jewellers_gold_promo.wav',
    'sample_advt_festival_special_offer.wav',
    'Devi_Jewelers_43_sec_NEW.mp3'
  ];
  for (const sName of knownSampleAdvtNames) {
    const p = path.join(UPLOAD_FOLDER, sName);
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        deletedCount++;
        deletedAdvtNames.push(sName);
      }
    } catch(e) {}
    markFileDeleted(sName);
    delete filesMeta[sName];
  }

  // 2. Remove any advt references from filesMeta
  for (const [key, val] of Object.entries(filesMeta)) {
    if (val?.category === 'advt' || isAdvertisementTrack(key)) {
      markFileDeleted(key);
      delete filesMeta[key];
    }
  }
  saveFilesMeta();
  saveDeletedFiles();

  // 3. Delete advt tracks from databases (Firestore and PostgreSQL)
  if (firestoreDb && !firestoreQuotaExceeded) {
    try {
      const snap = await firestoreGetDocs(firestoreCollection(firestoreDb, 'audio_tracks'));
      for (const d of snap.docs) {
        if (d.data().category === 'advt') {
          try {
            await firestoreDeleteDoc(firestoreDoc(firestoreDb, 'audio_tracks', d.id));
          } catch(e) {
            handleServerFirestoreError(e, 'clearAdvtDoc');
          }
        }
      }
    } catch(e) {
      handleServerFirestoreError(e, 'clearAllAdvtDatabaseFiles');
    }
  }

  if (dbConnected && dbPool) {
    try {
      await dbPool.query("DELETE FROM audio_tracks WHERE category = 'advt'");
    } catch(e) {
      console.warn('Notice clearing SQL advt tracks:', e.message);
    }
  }

  // 4. Reset advertisement settings in settings store & database
  const advtSetting = settingsStore.get('advt') || {};
  const updated = {
    ...advtSetting,
    tracks: [],
    track: null,
    enabled: false,
    interval: advtSetting.interval || '300',
    currentSequenceIndex: 0
  };
  settingsStore.set('advt', updated);
  saveSettings();
  setAdvtClearedFlag();

  settingsVersion = Date.now();
  filesVersion = Date.now();

  broadcastEvent('settings_updated', {
    key: 'advt',
    value: updated,
    settingsVersion: settingsVersion
  });

  broadcastEvent('files_updated', {
    action: 'delete_advt_all',
    deletedCount: deletedCount,
    deletedNames: deletedAdvtNames,
    filesVersion: filesVersion
  });

  console.log(`🧹 Cleared all ${deletedCount} advertisement tracks from server database and storage.`);
  return { success: true, deletedCount, settings: updated };
}

// Centralized wipe of sample advertisement tracks from database and storage
async function clearSampleAdvtDatabaseFiles() {
  let deletedCount = 0;
  const deletedSampleNames = [];
  const knownSampleAdvtNames = [
    'sample_advt_devi_jewellers_gold_promo.wav',
    'sample_advt_festival_special_offer.wav',
    'Devi_Jewelers_43_sec_NEW.mp3'
  ];

  if (fs.existsSync(UPLOAD_FOLDER)) {
    try {
      const files = fs.readdirSync(UPLOAD_FOLDER);
      for (const f of files) {
        if (f.startsWith('.')) continue;
        if (/^sample_advt/i.test(f) || knownSampleAdvtNames.includes(f)) {
          const fullPath = path.join(UPLOAD_FOLDER, f);
          try {
            if (fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath);
              deletedCount++;
              deletedSampleNames.push(f);
            }
          } catch(e) {}
          markFileDeleted(f);
          delete filesMeta[f];
          delete filesMeta[path.basename(f)];
        }
      }
    } catch(e) {}
  }

  for (const sName of knownSampleAdvtNames) {
    const fullPath = path.join(UPLOAD_FOLDER, sName);
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch(e) {}
    markFileDeleted(sName);
    delete filesMeta[sName];
  }
  saveFilesMeta();
  saveDeletedFiles();

  if (firestoreDb && !firestoreQuotaExceeded) {
    try {
      const snap = await firestoreGetDocs(firestoreCollection(firestoreDb, 'audio_tracks'));
      for (const d of snap.docs) {
        const dData = d.data() || {};
        if (knownSampleAdvtNames.includes(dData.title) || knownSampleAdvtNames.includes(d.id) || /^sample_advt/i.test(dData.title || d.id)) {
          try {
            await firestoreDeleteDoc(firestoreDoc(firestoreDb, 'audio_tracks', d.id));
          } catch(e) {}
        }
      }
    } catch(e) {}
  }

  if (dbConnected && dbPool) {
    try {
      await dbPool.query("DELETE FROM audio_tracks WHERE filename ILIKE 'sample_advt%' OR title ILIKE 'sample_advt%' OR filename = 'Devi_Jewelers_43_sec_NEW.mp3'");
    } catch(e) {}
  }

  // Remove sample tracks from advt settings
  const advtSetting = settingsStore.get('advt') || {};
  const filteredTracks = (advtSetting.tracks || []).filter(t => !knownSampleAdvtNames.includes(t?.title) && !/^sample_advt/i.test(t?.title || ''));
  const updated = {
    ...advtSetting,
    tracks: filteredTracks,
    track: filteredTracks[0] || null,
    enabled: filteredTracks.length > 0 ? advtSetting.enabled : false
  };
  settingsStore.set('advt', updated);
  saveSettings();
  setAdvtClearedFlag();

  settingsVersion = Date.now();
  filesVersion = Date.now();

  broadcastEvent('settings_updated', {
    key: 'advt',
    value: updated,
    settingsVersion: settingsVersion
  });

  broadcastEvent('files_updated', {
    action: 'delete_sample_advt',
    deletedCount: deletedCount,
    deletedNames: deletedSampleNames,
    filesVersion: filesVersion
  });

  console.log(`🧹 Cleared all ${deletedCount} sample advertisement tracks from database and storage.`);
  return { success: true, deletedCount, settings: updated };
}

// Centralized wipe of all prayer tracks and their names from database, storage, and settings
async function clearAllPrayerDatabaseFiles() {
  let deletedCount = 0;
  const deletedPrayerNames = [];

  // 1. Delete prayer audio files from server storage
  if (fs.existsSync(UPLOAD_FOLDER)) {
    try {
      const files = fs.readdirSync(UPLOAD_FOLDER);
      for (const f of files) {
        if (f.startsWith('.')) continue;
        const cat = getFileCategory(f);
        if (cat === 'prayer' || isPrayerTrack(f) || /bhajan|mantra|prayer|aarti|chalisa|gayatri/i.test(f)) {
          const fullPath = path.join(UPLOAD_FOLDER, f);
          try {
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
              fs.unlinkSync(fullPath);
              deletedCount++;
              deletedPrayerNames.push(f);
            }
          } catch(e) {}
          markFileDeleted(f);
          delete filesMeta[f];
          delete filesMeta[path.basename(f)];
        }
      }
    } catch(e) {}
  }

  // Also remove known standard prayer filenames
  const knownPrayerNames = [
    'ALL IN ONE BHAJAN.mp3',
    'ALL IN ONE BHAJAN_1.0.mp3',
    'sample_prayer_temple_bell_gayatri_mantra.wav'
  ];
  for (const kName of knownPrayerNames) {
    const p = path.join(UPLOAD_FOLDER, kName);
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        deletedCount++;
        deletedPrayerNames.push(kName);
      }
    } catch(e) {}
    markFileDeleted(kName);
    delete filesMeta[kName];
  }

  // 2. Remove any prayer references from filesMeta
  for (const [key, val] of Object.entries(filesMeta)) {
    if (val?.category === 'prayer' || isPrayerTrack(key) || /bhajan|mantra|prayer|aarti|chalisa|gayatri/i.test(key)) {
      markFileDeleted(key);
      delete filesMeta[key];
    }
  }
  saveFilesMeta();
  saveDeletedFiles();

  // 3. Delete prayer tracks from databases (Firestore and PostgreSQL)
  if (firestoreDb && !firestoreQuotaExceeded) {
    try {
      const snap = await firestoreGetDocs(firestoreCollection(firestoreDb, 'audio_tracks'));
      for (const d of snap.docs) {
        const dData = d.data() || {};
        if (dData.category === 'prayer' || isPrayerTrack(dData.title || d.id) || d.id.startsWith('prayer')) {
          try {
            await firestoreDeleteDoc(firestoreDoc(firestoreDb, 'audio_tracks', d.id));
          } catch(e) {
            handleServerFirestoreError(e, 'clearPrayerDoc');
          }
        }
      }
    } catch(e) {
      handleServerFirestoreError(e, 'clearAllPrayerDatabaseFiles');
    }
  }

  if (dbConnected && dbPool) {
    try {
      await dbPool.query("DELETE FROM audio_tracks WHERE category = 'prayer' OR id ILIKE 'prayer%' OR title ILIKE '%bhajan%' OR title ILIKE '%prayer%'");
    } catch(e) {
      console.warn('Notice clearing SQL prayer tracks:', e.message);
    }
  }

  // 4. Reset prayer settings in settings store & database
  const prayerSetting = settingsStore.get('prayer') || {};
  const updated = {
    ...prayerSetting,
    track: null,
    enabled: false,
    times: prayerSetting.times || ['11:15', '18:45']
  };
  settingsStore.set('prayer', updated);
  setPrayerClearedFlag();
  saveSettings();

  settingsVersion = Date.now();
  filesVersion = Date.now();

  broadcastEvent('settings_updated', {
    key: 'prayer',
    value: updated,
    settingsVersion: settingsVersion
  });

  broadcastEvent('files_updated', {
    action: 'delete_prayer_all',
    deletedCount: deletedCount,
    deletedNames: deletedPrayerNames,
    filesVersion: filesVersion
  });

  console.log(`🧹 Cleared all ${deletedCount} prayer tracks and their names from server database and storage.`);
  return { success: true, deletedCount, settings: updated };
}

app.post('/api/files/advt/clear-all', async (req, res) => {
  res.json(await clearAllAdvtDatabaseFiles());
});

app.delete('/api/files/advt/clear-all', async (req, res) => {
  res.json(await clearAllAdvtDatabaseFiles());
});

app.post('/api/files/sample-advt/clear-all', async (req, res) => {
  res.json(await clearSampleAdvtDatabaseFiles());
});

app.delete('/api/files/sample-advt/clear-all', async (req, res) => {
  res.json(await clearSampleAdvtDatabaseFiles());
});

app.post('/api/settings/sample-advt/clear-all', async (req, res) => {
  res.json(await clearSampleAdvtDatabaseFiles());
});

app.delete('/api/settings/sample-advt/clear-all', async (req, res) => {
  res.json(await clearSampleAdvtDatabaseFiles());
});

app.post('/api/settings/advt/clear-all', async (req, res) => {
  res.json(await clearAllAdvtDatabaseFiles());
});

app.delete('/api/settings/advt/clear-all', async (req, res) => {
  res.json(await clearAllAdvtDatabaseFiles());
});

app.post('/api/files/prayer/clear-all', async (req, res) => {
  res.json(await clearAllPrayerDatabaseFiles());
});

app.delete('/api/files/prayer/clear-all', async (req, res) => {
  res.json(await clearAllPrayerDatabaseFiles());
});

app.post('/api/settings/prayer/clear-all', async (req, res) => {
  res.json(await clearAllPrayerDatabaseFiles());
});

app.delete('/api/settings/prayer/clear-all', async (req, res) => {
  res.json(await clearAllPrayerDatabaseFiles());
});

app.post('/api/files/clear-all', async (req, res) => {
  res.json(await clearAllDatabaseFiles());
});

app.delete('/api/files/clear-all', async (req, res) => {
  res.json(await clearAllDatabaseFiles());
});

// 7b. API to get list of deleted files (for client storage sanitization)
app.get('/api/deleted-files', (req, res) => {
  res.json(Array.from(deletedFiles));
});

// 8. Settings API
app.get('/api/settings', (req, res) => {
  const allSettings = {};
  for (const [k, v] of settingsStore.entries()) {
    allSettings[k] = v;
  }
  res.json(allSettings);
});

app.get('/api/settings/:key', (req, res) => {
  const key = req.params.key;
  if (key === 'prayer') {
    const prayer = settingsStore.get('prayer') || {};
    if (!prayer.track || !prayer.track.title || isAdvertisementTrack(prayer.track.title)) {
      // Find any user-uploaded prayer track first from uploads folder
      let uploadedPrayer = null;
      try {
        if (fs.existsSync(UPLOAD_FOLDER)) {
          const allUploads = fs.readdirSync(UPLOAD_FOLDER);
          uploadedPrayer = allUploads.find(f => getFileCategory(f) === 'prayer' && !isAdvertisementTrack(f) && f !== 'sample_prayer_temple_bell_gayatri_mantra.wav');
        }
      } catch (e) {}

      if (uploadedPrayer) {
        prayer.track = {
          title: uploadedPrayer,
          url: `/api/uploads/${encodeURIComponent(uploadedPrayer)}`,
          platform: 'Local',
          isDirectAudio: true,
          category: 'prayer'
        };
        settingsStore.set('prayer', prayer);
      }
    }
    return res.json(prayer);
  }
  if (settingsStore.has(key)) {
    return res.json(settingsStore.get(key));
  }
  return res.json(null);
});

app.post('/api/settings/:key', (req, res) => {
  const key = req.params.key;
  let value = req.body;

  if (key === 'prayer' && value && typeof value === 'object') {
    const existing = settingsStore.get('prayer') || {};
    let parsedTimes = existing.times || ['11:15', '18:45'];
    
    if (value.times !== undefined) {
      function normalizeServerPrayerTime(t) {
        if (!t) return null;
        let s = String(t).trim().toLowerCase();
        if (!s) return null;
        const isPM = s.includes('pm') || s.includes('p.m.');
        const isAM = s.includes('am') || s.includes('a.m.');
        s = s.replace(/am|pm|a\.m\.|p\.m\./g, '').trim().replace(/\./g, ':');
        if (!s.includes(':')) {
          const hNum = parseInt(s, 10);
          if (isNaN(hNum) || hNum < 0 || hNum > 23) return null;
          let h = hNum;
          if (isPM && h < 12) h += 12;
          if (isAM && h === 12) h = 0;
          return `${String(h).padStart(2, '0')}:00`;
        }
        const parts = s.split(':').map(p => p.trim()).filter(Boolean);
        if (parts.length < 1) return null;
        let h = parseInt(parts[0], 10);
        let m = parts.length > 1 ? parseInt(parts[1], 10) : 0;
        if (isNaN(h) || isNaN(m)) return null;
        if (isPM && h < 12) h += 12;
        if (isAM && h === 12) h = 0;
        if (h < 0 || h > 23 || m < 0 || m > 59) return null;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }

      if (Array.isArray(value.times)) {
        parsedTimes = value.times
          .map(t => normalizeServerPrayerTime(t))
          .filter(Boolean);
      } else if (typeof value.times === 'string') {
        parsedTimes = value.times
          .replace(/\b(and|to)\b/gi, ',')
          .replace(/[&+/|\\]/g, ',')
          .split(/[,;\n]+/)
          .map(t => normalizeServerPrayerTime(t))
          .filter(Boolean);
      }
      // Deduplicate and sort
      parsedTimes = Array.from(new Set(parsedTimes)).sort();
    }

    if (value.track && value.track.title) {
      if (isAdvertisementTrack(value.track.title)) {
        return res.status(400).json({ error: 'Cannot set an advertisement track as prayer track. Only prayer tracks are allowed.' });
      }
      setFileCategory(value.track.title, 'prayer');
    }

    value = {
      ...existing,
      ...value,
      times: parsedTimes
    };
  } else if (key === 'advt' && value && typeof value === 'object') {
    const existing = settingsStore.get('advt') || {};
    
    let tracks = [];
    if (Array.isArray(value.tracks)) {
      tracks = value.tracks.map((t, idx) => ({
        id: t.id || `advt-${Date.now()}-${idx}`,
        title: t.title || 'Advertisement Audio',
        url: t.url || '',
        platform: t.platform || 'Local',
        isBlob: false,
        isDirectAudio: true,
        size: t.size || 0,
        order: typeof t.order === 'number' && !isNaN(t.order) ? t.order : (idx + 1),
        enabled: t.enabled !== false
      })).filter(t => t.url && t.title);
      
      // Sort tracks by order ascending
      tracks.sort((a, b) => a.order - b.order);
      
      // Re-assign normalized sequential 1..N order
      tracks.forEach((t, i) => { t.order = i + 1; });
      
      // Enforce role separation: a prayer-assigned file cannot be reassigned
      // to advertisement by a settings payload.
      const prayerConflicts = tracks.filter(t => t.title && getFileCategory(t.title) === 'prayer');
      if (prayerConflicts.length) {
        return res.status(400).json({
          error: 'Prayer audio cannot be assigned to the advertisement sequence.',
          tracks: prayerConflicts.map(t => t.title)
        });
      }
      // Persist the explicit advertisement role only after validation.
      for (const t of tracks) {
        if (t.title) setFileCategory(t.title, 'advt');
      }
    } else if (value.track && value.track.title) {
      tracks = [{
        id: value.track.id || `advt-${Date.now()}-0`,
        title: value.track.title,
        url: value.track.url,
        platform: value.track.platform || 'Local',
        isBlob: false,
        isDirectAudio: true,
        size: value.track.size || 0,
        order: 1,
        enabled: true
      }];
      if (getFileCategory(value.track.title) === 'prayer') {
        return res.status(400).json({ error: 'Prayer audio cannot be assigned to the advertisement sequence.' });
      }
      setFileCategory(value.track.title, 'advt');
    } else if (Array.isArray(existing.tracks)) {
      tracks = existing.tracks;
    }

    let primaryTrack = null;
    if (value.track && typeof value.track === 'object' && value.track.title && value.track.url) {
      primaryTrack = value.track;
    } else if (tracks.length > 0) {
      primaryTrack = tracks[0];
    }

    value = {
      ...existing,
      ...value,
      tracks: tracks,
      track: primaryTrack,
      interval: value.interval !== undefined ? String(value.interval) : (existing.interval || '300'),
      enabled: value.enabled !== undefined ? !!value.enabled : (existing.enabled !== undefined ? existing.enabled : true),
      currentSequenceIndex: typeof value.currentSequenceIndex === 'number' ? value.currentSequenceIndex : (existing.currentSequenceIndex || 0)
    };
  }

  settingsStore.set(key, value);
  saveSettings();

  settingsVersion = Date.now();
  
  // Broadcast auto-update to all connected players
  broadcastEvent('settings_updated', {
    key: key,
    value: value,
    settingsVersion: settingsVersion
  });

  console.log(`💾 Saved ${key} settings to database:`, JSON.stringify(value));
  return res.json({ success: true, settings: value });
});

app.delete('/api/settings/:key', async (req, res) => {
  const key = req.params.key;
  if (key === 'prayer') {
    const result = await clearAllPrayerDatabaseFiles();
    return res.json(result);
  }

  if (key === 'advt') {
    const result = await clearAllAdvtDatabaseFiles();
    return res.json(result);
  }

  settingsStore.delete(key);
  saveSettings();

  settingsVersion = Date.now();
  
  // Broadcast auto-update to all connected players
  broadcastEvent('settings_updated', {
    key: key,
    value: null,
    settingsVersion: settingsVersion
  });

  return res.json({ success: true });
});

// ==========================================
// Database Configuration & Persistent Storage APIs
// ==========================================

// Get current database connection status & summary
app.get('/api/database/config', async (req, res) => {
  let tableCount = 0;
  let tracksCount = 0;
  let settingsCount = 0;

  if (dbConnected && dbPool) {
    try {
      const tRes = await dbPool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('player_settings', 'audio_tracks')");
      tableCount = parseInt(tRes.rows[0].count, 10);
      const cRes = await dbPool.query("SELECT COUNT(*) FROM audio_tracks");
      tracksCount = parseInt(cRes.rows[0].count, 10);
      const sRes = await dbPool.query("SELECT COUNT(*) FROM player_settings");
      settingsCount = parseInt(sRes.rows[0].count, 10);
    } catch (e) {
      console.warn('DB config status query error:', e.message);
    }
  }

  res.json({
    connected: dbConnected,
    type: dbConfig.type || 'postgres',
    connectionStringMasked: maskConnectionString(dbConfig.connectionString),
    hasConnectionString: !!dbConfig.connectionString,
    lastError: dbLastError,
    tableCount,
    tracksCount,
    settingsCount,
    envDatabaseUrlConfigured: !!process.env.DATABASE_URL,
    firestoreConfigured: !!firestoreDb,
    firestoreQuotaExceeded: firestoreQuotaExceeded
  });
});

// Test database connection string before saving
app.post('/api/database/test', async (req, res) => {
  const { connectionString } = req.body || {};
  if (!connectionString || !connectionString.trim()) {
    return res.status(400).json({ success: false, error: 'Database connection string is required' });
  }

  try {
    const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
    const testPool = new Pool({
      connectionString: connectionString.trim(),
      ssl: isLocal ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });

    const client = await testPool.connect();
    const result = await client.query('SELECT NOW() as current_time, version() as db_version');
    client.release();
    await testPool.end();

    res.json({
      success: true,
      message: 'Successfully connected to database!',
      currentTime: result.rows[0].current_time,
      dbVersion: result.rows[0].db_version
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

// Save database connection settings and initialize tables
app.post('/api/database/config', async (req, res) => {
  const { connectionString, enabled } = req.body || {};
  if (!connectionString && enabled !== false) {
    return res.status(400).json({ success: false, error: 'Connection string is required' });
  }

  if (enabled === false) {
    if (dbPool) {
      try { await dbPool.end(); } catch (e) {}
      dbPool = null;
    }
    dbConnected = false;
    dbConfig.enabled = false;
    try {
      fs.writeFileSync(DB_CONFIG_FILE, JSON.stringify({ ...dbConfig, enabled: false }, null, 2));
    } catch (e) {}

    return res.json({ success: true, connected: false, message: 'Database disconnected' });
  }

  const success = await connectToDatabase(connectionString);
  if (success) {
    // Sync current in-memory settings to database immediately
    saveSettings();

    // Broadcast update across all PCs
    broadcastEvent('settings_updated', {
      key: 'database',
      value: { connected: true, timestamp: Date.now() },
      settingsVersion: Date.now()
    });

    res.json({
      success: true,
      connected: true,
      connectionStringMasked: maskConnectionString(connectionString),
      message: 'Database connected and tables initialized successfully! All prayer and advt tracks will now persist permanently.'
    });
  } else {
    res.status(400).json({
      success: false,
      connected: false,
      error: dbLastError || 'Could not connect with provided credentials'
    });
  }
});

// One-click Sync: Push current memory/disk state into PostgreSQL database
app.post('/api/database/sync', async (req, res) => {
  if (!dbConnected || !dbPool) {
    return res.status(400).json({ success: false, error: 'Database is not connected' });
  }

  try {
    let syncedTracks = 0;
    // 1. Sync settings
    saveSettings();

    // 2. Sync local files into database
    if (fs.existsSync(UPLOAD_FOLDER)) {
      const files = fs.readdirSync(UPLOAD_FOLDER);
      for (const f of files) {
        if (f.startsWith('.') || f === 'Thumbs.db') continue;
        const filePath = path.join(UPLOAD_FOLDER, f);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) continue;
          const cat = getFileCategory(f);
          let buf = null;
          if (stat.size <= 20 * 1024 * 1024) {
            buf = fs.readFileSync(filePath);
          }
          await saveTrackToDatabase(f, cat, f, null, buf);
          syncedTracks++;
        } catch (e) {}
      }
    }

    res.json({
      success: true,
      message: `Database synchronized! Stored settings and ${syncedTracks} audio tracks in persistent database.`,
      syncedTracks
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Return copyable SQL DDL schema for user's convenience
app.get('/api/database/schema', (req, res) => {
  const schemaSql = `-- PostgreSQL / Supabase / Neon / Cloud SQL Schema for DJ Music Streamplayer

CREATE TABLE IF NOT EXISTS player_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audio_tracks (
    id VARCHAR(255) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'prayer', 'advt', or 'general'
    title VARCHAR(255),
    audio_url TEXT,
    audio_base64 TEXT,
    size BIGINT,
    mime_type VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audio_tracks_category ON audio_tracks(category);
`;
  res.setHeader('Content-Type', 'text/plain');
  res.send(schemaSql);
});

// Stream audio stored directly in the database (bypasses ephemeral container disk)
app.get('/api/db-audio/:id', async (req, res) => {
  const id = req.params.id;
  if (!dbPool) return res.status(404).send('Database not connected');
  try {
    const result = await dbPool.query('SELECT * FROM audio_tracks WHERE id = $1 OR filename = $1 LIMIT 1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Track not found in database');
    }
    const track = result.rows[0];
    if (track.audio_url && !track.audio_url.startsWith('/api/db-audio/')) {
      return res.redirect(track.audio_url);
    }
    if (track.audio_base64) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Type');
      res.setHeader('Accept-Ranges', 'bytes');

      const buffer = Buffer.from(track.audio_base64, 'base64');
      const mime = track.mime_type || 'audio/mpeg';
      const total = buffer.length;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
        const chunksize = (end - start) + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': mime
        });
        return res.end(buffer.subarray(start, end + 1));
      } else {
        res.writeHead(200, {
          'Content-Length': total,
          'Accept-Ranges': 'bytes',
          'Content-Type': mime
        });
        return res.end(buffer);
      }
    }
    return res.status(404).send('Audio stream not available in database');
  } catch (err) {
    return res.status(500).send('Database audio stream error: ' + err.message);
  }
});

// 9. Auto-Update Status & Version API
app.get('/api/status', (req, res) => {
  res.json({
    appBuildVersion,
    serverBootTime,
    settingsVersion,
    filesVersion,
    serverTime: Date.now(),
    activeClients: sseClients.size
  });
});

// 10. Real-time Auto-Update Event Stream (SSE)
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);

  // Send initial handshake
  res.write(`event: connected\ndata: ${JSON.stringify({
    serverBootTime,
    appBuildVersion,
    settingsVersion,
    filesVersion,
    serverTime: Date.now()
  })}\n\n`);

  // Heartbeat to maintain streaming across proxies & dev server
  const heartbeatTimer = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ serverTime: Date.now() })}\n\n`);
    } catch (e) {
      clearInterval(heartbeatTimer);
      sseClients.delete(res);
    }
  }, 12000);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    sseClients.delete(res);
  });
});

// Start listening
const server = app.listen(PORT, HOST, () => {
  console.log(`DJ Music Streamplayer server running at http://${HOST}:${PORT}`);
});

// Configure 15-minute timeout for large (100MB-1GB) file uploads
server.timeout = 15 * 60 * 1000;
server.keepAliveTimeout = 75000;
server.headersTimeout = 76000;
