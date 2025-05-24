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

    await db.ref(`queues/${sessionId}`).set({}); // ✅ Iniciar como objeto
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

// Agregar canción a la cola (nuevo con .push())
app.post('/queue/add', async (req, res) => {
  try {
    const { sessionId, id, titulo, usuario, thumbnailUrl, duration } = req.body;

    if (!sessionId || !id || !titulo || !usuario || !thumbnailUrl || !duration) {
      return res.status(400).json({ message: 'Datos incompletos' });
    }

    const ref = db.ref(`queues/${sessionId}`);

    const isIsoFormat = /^PT(\d+H)?(\d+M)?(\d+S)?$/.test(duration);
    const durationIso = isIsoFormat ? duration : convertirADuracionISO(duration);

    const nuevaCancion = { id, titulo, usuario, thumbnailUrl, duration: durationIso };
    const pushRef = await ref.push(nuevaCancion);

    const playbackSnap = await db.ref(`playbackState/${sessionId}`).once('value');
    const playbackState = playbackSnap.val();

    if (!playbackState || !playbackState.currentVideo) {
      await db.ref(`playbackState/${sessionId}`).set({
        playing: true,
        currentVideo: nuevaCancion
      });
      console.log(`▶ Reproducción iniciada automáticamente en ${sessionId}`);
    }

    res.json({ ok: true, message: 'Canción agregada', key: pushRef.key });
  } catch (err) {
    console.error('Error agregando canción', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

// Función auxiliar para convertir duración "3:14" → "PT3M14S"
function convertirADuracionISO(duracion) {
  const partes = duracion.split(':').map(Number);
  if (partes.length === 2) {
    const [min, sec] = partes;
    return `PT${min}M${sec}S`;
  } else if (partes.length === 3) {
    const [hor, min, sec] = partes;
    return `PT${hor}H${min}M${sec}S`;
  }
  return 'PT0S';
}

// ➕ Agregar anfitriones predeterminados desde la TV
app.post('/hosts/default', async (req, res) => {
  try {
    const { sessionId, defaultHosts } = req.body;
    if (!sessionId || !Array.isArray(defaultHosts)) {
      return res.status(400).json({ message: 'Datos inválidos' });
    }

    await db.ref(`hosts/default/${sessionId}`).set(defaultHosts);
    res.json({ ok: true, updated: defaultHosts.length });
  } catch (err) {
    console.error('Error saving default hosts', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

// ❌ Eliminar canción (aún sin actualizar a .push())
app.post('/queue/remove', async (req, res) => {
  try {
    const { sessionId, videoId, userId } = req.body;
    if (!sessionId || !videoId || !userId) {
      return res.status(400).json({ message: 'Datos incompletos' });
    }

    const queueSnap = await db.ref(`queues/${sessionId}`).once('value');
    const queue = queueSnap.val() || {};

    const sessionSnap = await db.ref(`sessions/${sessionId}`).once('value');
    const session = sessionSnap.val();

    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' });

    const isHost = session.host === userId || (session.guests && session.guests[userId] === 'host');

    const updatedQueue = {};
    for (const [key, cancion] of Object.entries(queue)) {
      const puedeEliminar = isHost || cancion.usuario === userId;
      if (!(cancion.id === videoId && puedeEliminar)) {
        updatedQueue[key] = cancion;
      }
    }

    await db.ref(`queues/${sessionId}`).set(updatedQueue);

    res.json({ ok: true, updatedCount: Object.keys(updatedQueue).length });
  } catch (err) {
    console.error('Error removing song', err);
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
