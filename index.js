const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(cors());

// Inicializar Firebase sin usar un archivo JSON
admin.initializeApp({
    credential: admin.credential.cert({
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  
const db = admin.database();

// Crear una sesión (solo el anfitrión puede hacerlo)
app.post('/session/create', async (req, res) => {
    const sessionId = uuidv4();
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    await db.ref(`sessions/${sessionId}`).set({ code, host: sessionId, guests: {}, pendingRequests: {} });
    await db.ref(`queues/${sessionId}`).set([]);
    await db.ref(`playbackState/${sessionId}`).set({ playing: false, currentVideo: null });
    res.json({ sessionId, code });
});

// Unirse a una sesión (el anfitrión debe aceptar)
app.post('/session/join', async (req, res) => {
    const { code, guestId } = req.body;
    const sessionsSnapshot = await db.ref('sessions').once('value');
    const sessions = sessionsSnapshot.val();
    
    const sessionEntry = Object.entries(sessions).find(([_, s]) => s.code === code);
    if (!sessionEntry) return res.status(404).json({ message: 'Código inválido' });
    
    const [sessionId, sessionData] = sessionEntry;
    sessionData.pendingRequests = sessionData.pendingRequests || {};
    sessionData.pendingRequests[guestId] = true;
    res.json({ message: 'Solicitud enviada al anfitrión', sessionId });
});

// El anfitrión aprueba o rechaza la solicitud
app.post('/session/approve', async (req, res) => {
    const { sessionId, guestId, approve } = req.body;
    const sessionSnapshot = await db.ref(`sessions/${sessionId}`).once('value');
    const session = sessionSnapshot.val();
    
    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' });

    // Asegurar que session.guests y session.pendingRequests existen
    session.guests = session.guests || {};
    session.pendingRequests = session.pendingRequests || {};

    if (approve) {
        session.guests[guestId] = true;
        await db.ref(`sessions/${sessionId}/guests`).set(session.guests);
    }

    if (session.pendingRequests[guestId]) {
        delete session.pendingRequests[guestId];
        await db.ref(`sessions/${sessionId}/pendingRequests`).set(session.pendingRequests);
    }
    
    res.json({ message: approve ? 'Usuario aceptado' : 'Solicitud rechazada' });
});
// Obtener información de una sesión por su ID
app.get('/session/:id', async (req, res) => {
    const { id } = req.params;
    const sessionSnapshot = await db.ref(`sessions/${id}`).once('value');
    
    if (!sessionSnapshot.exists()) {
        return res.status(404).json({ message: 'Sesión no encontrada' });
    }
    
    res.json(sessionSnapshot.val());
});

// Agregar un video a la cola de reproducción
app.post('/queue/add', async (req, res) => {
    const { sessionId, guestId, videoId, title } = req.body;
    
    const sessionSnapshot = await db.ref(`sessions/${sessionId}`).once('value');
    if (!sessionSnapshot.exists()) return res.status(404).json({ message: 'Sesión no encontrada' });
    
    const queueRef = db.ref(`queues/${sessionId}`);
    const queueSnapshot = await queueRef.once('value');
    const queue = queueSnapshot.val() || [];
    
    queue.push({ videoId, title, addedBy: guestId });
    await queueRef.set(queue);
    res.json({ message: 'Video agregado', queue });
});

// Obtener la cola de reproducción
app.get('/queue/:sessionId', async (req, res) => {
    const queueSnapshot = await db.ref(`queues/${req.params.sessionId}`).once('value');
    if (!queueSnapshot.exists()) return res.status(404).json({ message: 'Sesión no encontrada' });
    res.json(queueSnapshot.val());
});
 // Eliminar un video de la cola
app.delete('/queue/remove/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { guestId } = req.body; // Se obtiene el guestId del cuerpo de la solicitud

    const queueRef = db.ref(`queues/${sessionId}`);
    const queueSnapshot = await queueRef.once('value');
    let queue = queueSnapshot.val();

    if (!queue) {
        return res.status(404).json({ message: 'Cola no encontrada' });
    }

    // Filtrar la cola para eliminar solo los videos agregados por el usuario que hace la solicitud
    const updatedQueue = queue.filter(video => video.addedBy !== guestId);

    // Actualizar la cola en la base de datos
    await queueRef.set(updatedQueue);

    res.json({ message: 'Video eliminado si existía', queue: updatedQueue });
});


// Control de reproducción (play, pause, skip)
app.post('/playback/play', async (req, res) => {
    const { sessionId } = req.body;
    const queueSnapshot = await db.ref(`queues/${sessionId}`).once('value');
    const queue = queueSnapshot.val();
    if (!queue || queue.length === 0) return res.status(400).json({ message: 'No hay videos en la cola' });
    
    const playbackState = { playing: true, currentVideo: queue[0] };
    await db.ref(`playbackState/${sessionId}`).set(playbackState);
    res.json({ message: 'Reproducción iniciada', playbackState });
});

app.post('/playback/pause', async (req, res) => {
    const { sessionId } = req.body;
    const playbackRef = db.ref(`playbackState/${sessionId}`);
    const playbackSnapshot = await playbackRef.once('value');
    const playbackState = playbackSnapshot.val();

    if (!playbackState || !playbackState.currentVideo) {
        return res.status(400).json({ message: 'No hay video en reproducción' });
    }

    playbackState.playing = false;
    await playbackRef.set(playbackState);

    res.json({ message: 'Reproducción pausada', playbackState });
});

app.post('/playback/skip', async (req, res) => {
    const { sessionId } = req.body;
    const queueRef = db.ref(`queues/${sessionId}`);
    const queueSnapshot = await queueRef.once('value');
    let queue = queueSnapshot.val();

    if (!queue || queue.length <= 1) {
        return res.status(400).json({ message: 'No hay suficientes videos en la cola para saltar' });
    }

    queue.shift(); // Eliminar el primer video de la cola
    await queueRef.set(queue);

    const playbackState = { playing: true, currentVideo: queue[0] };
    await db.ref(`playbackState/${sessionId}`).set(playbackState);

    res.json({ message: 'Video saltado', playbackState });
});

app.get('/playback/status/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const playbackRef = db.ref(`playbackState/${sessionId}`);
    const playbackSnapshot = await playbackRef.once('value');

    if (!playbackSnapshot.exists()) {
        return res.status(404).json({ message: 'Estado de reproducción no encontrado' });
    }

    res.json(playbackSnapshot.val());
});


const PORT = 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
