const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(cors());

// Inicializar Firebase
admin.initializeApp({
    credential: admin.credential.cert({
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// Crear una sesión (corregido: ahora guarda también sessionId)
app.post('/session/create', async (req, res) => {
    const sessionId = uuidv4();
    const code = Math.floor(1000 + Math.random() * 9000).toString();

    await db.ref(`sessions/${sessionId}`).set({
        code,
        sessionId,  // <-- 🔥 Aquí agregamos el sessionId explícitamente
        host: sessionId,
        guests: {},
        pendingRequests: {}
    });

    await db.ref(`queues/${sessionId}`).set([]);
    await db.ref(`playbackState/${sessionId}`).set({ playing: false, currentVideo: null });

    res.json({ sessionId, code });
});

// Verificar código de sala
app.post('/session/verify', async (req, res) => {
    const { code } = req.body;

    const sessionsSnapshot = await db.ref('sessions').once('value');
    const sessions = sessionsSnapshot.val();

    const sessionEntry = Object.entries(sessions).find(([_, s]) => s.code === code);

    if (!sessionEntry) {
        return res.status(404).json({ message: 'Código de sala no encontrado' });
    }

    const [sessionId] = sessionEntry;
    res.json({ sessionId });
});

// Obtener la cola
app.get('/queue/:sessionId', async (req, res) => {
    const queueSnapshot = await db.ref(`queues/${req.params.sessionId}`).once('value');
    if (!queueSnapshot.exists()) {
        return res.status(404).json({ message: 'Sesión no encontrada' });
    }

    res.json(queueSnapshot.val());
});

// Obtener información de una sesión
app.get('/session/:sessionId', async (req, res) => {
    const sessionSnapshot = await db.ref(`sessions/${req.params.sessionId}`).once('value');
    if (!sessionSnapshot.exists()) {
        return res.status(404).json({ message: 'Sesión no encontrada' });
    }

    res.json(sessionSnapshot.val());
});

// Iniciar el servidor
const PORT = 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
