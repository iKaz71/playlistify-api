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

    await db.ref(`queues/${sessionId}`).set({});
    await db.ref(`queuesOrder/${sessionId}`).set([]); // 🔥 Iniciar array de orden vacío
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

// Obtener cola (regresa objeto)
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

// Obtener orden de la cola
app.get('/queueOrder/:sessionId', async (req, res) => {
  try {
    const snap = await db.ref(`queuesOrder/${req.params.sessionId}`).once('value');
    if (!snap.exists()) {
      return res.status(404).json({ message: 'Orden no encontrada' });
    }
    res.json(snap.val());
  } catch (err) {
    console.error('Error getting queue order', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

// Agregar canción a la cola (y array de orden)
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

    // Actualiza el array de orden
    const orderRef = db.ref(`queuesOrder/${sessionId}`);
    const orderSnap = await orderRef.once('value');
    const order = orderSnap.val() || [];
    order.push(pushRef.key);
    await orderRef.set(order);

    // Estado de reproducción
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

// ❌ Eliminar canción (de objeto y de array de orden)
app.post('/queue/remove', async (req, res) => {
  try {
    const { sessionId, pushKey, userId } = req.body;
    if (!sessionId || !pushKey || !userId) {
      return res.status(400).json({ message: 'Datos incompletos' });
    }

    const queueSnap = await db.ref(`queues/${sessionId}`).once('value');
    const queue = queueSnap.val() || {};

    const sessionSnap = await db.ref(`sessions/${sessionId}`).once('value');
    const session = sessionSnap.val();

    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' });

    const isHost = session.host === userId || (session.guests && session.guests[userId] === 'host');
    const cancion = queue[pushKey];

    if (!cancion) return res.status(404).json({ message: 'Canción no encontrada' });

    // Solo permite eliminar si eres host o quien la subió
    if (!(isHost || cancion.usuario === userId)) {
      return res.status(403).json({ message: 'No tienes permiso para eliminar esta canción' });
    }

    // Elimina la canción del objeto
    await db.ref(`queues/${sessionId}/${pushKey}`).remove();

    // Elimina la key del array de orden
    const orderRef = db.ref(`queuesOrder/${sessionId}`);
    const orderSnap = await orderRef.once('value');
    let order = orderSnap.val() || [];
    order = order.filter(key => key !== pushKey);
    await orderRef.set(order);

    res.json({ ok: true, message: 'Canción eliminada' });
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

//-------------------------------------------------
//  Mover canción a "Play Next" usando array de orden
//-------------------------------------------------
app.post('/queue/playnext', async (req, res) => {
  try {
    const { sessionId, pushKey } = req.body;

    if (!sessionId || !pushKey) {
      return res.status(400).json({ message: 'Datos incompletos' });
    }

    // Leer el array de orden actual
    const orderRef = db.ref(`queuesOrder/${sessionId}`);
    const orderSnap = await orderRef.once('value');
    const order = orderSnap.val();

    if (!Array.isArray(order) || !order.includes(pushKey)) {
      return res.status(404).json({ message: 'Canción no encontrada en la cola' });
    }

    // Si está en reproducción (posición 0), no hacer nada
    if (order[0] === pushKey) {
      return res.json({ ok: false, message: 'La canción ya está en reproducción', order });
    }

    // Si ya está en la posición 1, tampoco moverla
    if (order[1] === pushKey) {
      return res.json({ ok: false, message: 'La canción ya es la siguiente en la cola', order });
    }

    // Quitar la canción de su posición actual
    const newOrder = order.filter(key => key !== pushKey);
    // Insertarla en la posición 1
    newOrder.splice(1, 0, pushKey);

    await orderRef.set(newOrder);

    res.json({ ok: true, message: 'Canción movida como siguiente en la cola', newOrder });
  } catch (err) {
    console.error('Error en Play Next', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

