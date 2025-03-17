const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Simulación de almacenamiento en memoria
let sessions = {};
let queues = {}; // Nueva estructura para almacenar las colas de reproducción
let playbackState = {}; // Estado de reproducción por sesión

// Función para generar código de 4 dígitos
const generateCode = () => Math.floor(1000 + Math.random() * 9000).toString();

// Crear una sesión (solo el anfitrión puede hacerlo)
app.post('/session/create', (req, res) => {
    const sessionId = uuidv4();
    const code = generateCode();
    sessions[sessionId] = { code, host: sessionId, guests: {}, pendingRequests: {} };
    queues[sessionId] = []; // Inicializar cola vacía
    playbackState[sessionId] = { playing: false, currentVideo: null }; // Inicializar estado de reproducción
    res.json({ sessionId, code });
});

// Unirse a una sesión (el anfitrión debe aceptar)
app.post('/session/join', (req, res) => {
    const { code, guestId } = req.body;
    const session = Object.entries(sessions).find(([_, s]) => s.code === code);
    
    if (!session) return res.status(404).json({ message: 'Código inválido' });
    
    const [sessionId, sessionData] = session;
    
    if (sessionData.guests[guestId]) {
        return res.json({ message: 'Ya estás en la sesión' });
    }
    
    sessionData.pendingRequests[guestId] = true;
    res.json({ message: 'Solicitud enviada al anfitrión', sessionId });
});

// El anfitrión aprueba o rechaza la solicitud
app.post('/session/approve', (req, res) => {
    const { sessionId, guestId, approve } = req.body;
    const session = sessions[sessionId];
    
    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' });
    
    if (!session.pendingRequests[guestId]) return res.status(400).json({ message: 'No hay solicitud pendiente' });
    
    if (approve) {
        session.guests[guestId] = true;
    }
    delete session.pendingRequests[guestId];
    res.json({ message: approve ? 'Usuario aceptado' : 'Solicitud rechazada' });
});

// Obtener información de la sesión
app.get('/session/:id', (req, res) => {
    const session = sessions[req.params.id];
    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' });
    res.json(session);
});

// Agregar un video a la cola de reproducción
app.post('/queue/add', (req, res) => {
    const { sessionId, guestId, videoId, title } = req.body;
    
    if (!sessions[sessionId]) return res.status(404).json({ message: 'Sesión no encontrada' });
    if (!sessions[sessionId].guests[guestId] && sessions[sessionId].host !== guestId) {
        return res.status(403).json({ message: 'No estás en la sesión' });
    }
    
    queues[sessionId].push({ videoId, title, addedBy: guestId });
    res.json({ message: 'Video agregado', queue: queues[sessionId] });
});

// Obtener la cola de reproducción
app.get('/queue/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (!sessions[sessionId]) return res.status(404).json({ message: 'Sesión no encontrada' });
    res.json(queues[sessionId]);
});

// Eliminar un video de la cola
app.delete('/queue/remove/:sessionId/:videoId', (req, res) => {
    const { sessionId, videoId } = req.params;
    const { guestId } = req.body;
    
    if (!sessions[sessionId]) return res.status(404).json({ message: 'Sesión no encontrada' });
    
    const session = sessions[sessionId];
    if (!session.guests[guestId] && session.host !== guestId) {
        return res.status(403).json({ message: 'No estás autorizado para eliminar este video' });
    }
    
    queues[sessionId] = queues[sessionId].filter(video => video.videoId !== videoId || (guestId !== session.host && video.addedBy !== guestId));
    res.json({ message: 'Video eliminado', queue: queues[sessionId] });
});

// Control de reproducción (play, pause, skip)
app.post('/playback/play', (req, res) => {
    const { sessionId } = req.body;
    if (!sessions[sessionId]) return res.status(404).json({ message: 'Sesión no encontrada' });
    
    if (queues[sessionId].length === 0) return res.status(400).json({ message: 'No hay videos en la cola' });
    
    playbackState[sessionId] = { playing: true, currentVideo: queues[sessionId][0] };
    res.json({ message: 'Reproducción iniciada', playbackState: playbackState[sessionId] });
});

app.post('/playback/pause', (req, res) => {
    const { sessionId } = req.body;
    if (!sessions[sessionId]) return res.status(404).json({ message: 'Sesión no encontrada' });
    
    playbackState[sessionId].playing = false;
    res.json({ message: 'Reproducción pausada', playbackState: playbackState[sessionId] });
});

app.post('/playback/skip', (req, res) => {
    const { sessionId } = req.body;
    if (!sessions[sessionId]) return res.status(404).json({ message: 'Sesión no encontrada' });
    
    if (queues[sessionId].length > 1) {
        queues[sessionId].shift(); // Eliminar el primer video
        playbackState[sessionId] = { playing: true, currentVideo: queues[sessionId][0] };
    } else {
        playbackState[sessionId] = { playing: false, currentVideo: null };
    }
    
    res.json({ message: 'Video saltado', playbackState: playbackState[sessionId] });
});

// Obtener estado de reproducción
app.get('/playback/status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (!sessions[sessionId]) return res.status(404).json({ message: 'Sesión no encontrada' });
    res.json(playbackState[sessionId]);
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
