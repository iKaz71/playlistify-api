const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Simulación de almacenamiento en memoria
let sessions = {};

// Función para generar código de 4 dígitos
const generateCode = () => Math.floor(1000 + Math.random() * 9000).toString();

// Crear una sesión (solo el anfitrión puede hacerlo)
app.post('/session/create', (req, res) => {
    const sessionId = uuidv4();
    const code = generateCode();
    sessions[sessionId] = { code, host: sessionId, guests: {}, pendingRequests: {} };
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

const PORT = 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
