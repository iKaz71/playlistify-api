// index.js
//--------------------------------------------
//  Playlistify - API
//--------------------------------------------
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(cors());

//-------------------------------------------------
//  🔥 Inicializar Firebase Admin
//-------------------------------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    project_id:        process.env.FIREBASE_PROJECT_ID,
    private_key:       process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email:      process.env.FIREBASE_CLIENT_EMAIL
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

//-------------------------------------------------
//  Endpoints
//-------------------------------------------------

// Health-check
app.get('/', (_req, res) => {
  res.json({ ok: true, message: 'Playlistify API running' });
});

// Crear sesión
app.post('/session/create', async (_req, res) => {
  try {
    const sessionId = uuidv4();
    const code = Math.floor(1000 + Math.random() * 9000).toString();

    await db.ref(`sessions/${sessionId}`).set({
      code,
      sessionId,
      host: sessionId,
      guests: {},
      pendingRequests: {}
    });

    await db.ref(`queues/${sessionId}`).set([]);
    await db.ref(`playbackState/${sessionId}`).set({
      playing: false,
      currentVideo: null
    });

    res.json({ sessionId, code });
  } catch (err) {
    console.error('Error creating session', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

// Verificar código
app.post('/session/verify', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'Code required' });

    const snap = await db.ref('sessions').once('value');
    const sessions = snap.val() || {};

    const entry = Object.entries(sessions).find(
      ([, s]) => s.code === code
    );

    if (!entry) {
      return res.status(404).json({ message: 'Código de sala no encontrado' });
    }

    const [sessionId] = entry;
    res.json({ sessionId });
  } catch (err) {
    console.error('Error verifying code', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

// Obtener cola
app.get('/queue/:sessionId', async (req, res) => {
  try {
    const snap = await db.ref(`queues/${req.params.sessionId}`).once('value');
    if (!snap.exists()) {
      return res.status(404).json({ message: 'Sesión no encontrada' });
    }
    res.json(snap.val());
  } catch (err) {
    console.error('Error getting queue', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

// Obtener datos de sesión
app.get('/session/:sessionId', async (req, res) => {
  try {
    const snap = await db.ref(`sessions/${req.params.sessionId}`).once('value');
    if (!snap.exists()) {
      return res.status(404).json({ message: 'Sesión no encontrada' });
    }
    res.json(snap.val());
  } catch (err) {
    console.error('Error getting session', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
//  Arrancar servidor
//-------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎧 Playlistify API corriendo en el puerto ${PORT}`);
});
