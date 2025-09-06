//--------------------------------------------
//  Playlistify - API
//--------------------------------------------
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors());

// === Pool de 5 palabras por defecto (puedes cambiarlas por env) ===
const DEFAULT_ADMIN_WORDS = (process.env.ADMIN_WORD_POOL || 'luna-roja,mono-verde,nube-dorada,sol-mate,rock-azul')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Hash + salt (no guardamos la palabra en claro)
function hashSecret(plain) {
  const salt = crypto.randomBytes(16);
  const salted = Buffer.concat([salt, Buffer.from(plain, 'utf8')]);
  const hashB64 = crypto.createHash('sha256').update(salted).digest('base64');
  return { saltB64: salt.toString('base64'), hashB64 };
}
function verifySecret(saltB64, hashB64, attempt) {
  const salt = Buffer.from(saltB64, 'base64');
  const salted = Buffer.concat([salt, Buffer.from(attempt, 'utf8')]);
  const computed = crypto.createHash('sha256').update(salted).digest('base64');
  return computed === hashB64;
}
// Toma una palabra del pool (aleatoria simple)
function pickDefaultWord() {
  const idx = Math.floor(Math.random() * DEFAULT_ADMIN_WORDS.length);
  return DEFAULT_ADMIN_WORDS[idx];
}

//-------------------------------------------------
//  🔥 Inicializar Firebase Admin
//-------------------------------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    project_id:   process.env.FIREBASE_PROJECT_ID,
    private_key:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL
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

//-------------------------------------------------
// Crear sesión (con palabra por defecto asignada)
//-------------------------------------------------
app.post('/session/create', async (_req, res) => {
  try {
    const sessionId = uuidv4();
    const code = Math.floor(1000 + Math.random() * 9000).toString();

    // Palabra por defecto (del pool)
    const defaultWord = pickDefaultWord();
    const { saltB64, hashB64 } = hashSecret(defaultWord);

    await db.ref(`sessions/${sessionId}`).set({
      code,
      sessionId,
      host: sessionId,
      guests: {},
      pendingRequests: {},
      // Bloque de secreto por sala
      secret: {
        enabled: true,
        salt: saltB64,
        hash: hashB64,
        version: Date.now(),
        createdAt: Date.now()
        // ttlMs: 12 * 60 * 60 * 1000 // opcional
      }
    });

    await db.ref(`queues/${sessionId}`).set({});
    await db.ref(`queuesOrder/${sessionId}`).set([]); // array de orden vacío
    await db.ref(`playbackState/${sessionId}`).set({
      playing: false,
      currentVideo: null
    });

    // Devolvemos la palabra al host (TV) para mostrarla (NO se guarda en claro en DB)
    res.json({ sessionId, code, adminWord: defaultWord });
  } catch (err) {
    console.error('Error creating session', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
// TV: Cambiar palabra manualmente
// Body: { newWord: string } → { ok, message, adminWord }
//-------------------------------------------------
app.post('/session/:sessionId/secret/change', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { newWord } = req.body;

    if (typeof newWord !== 'string' || !newWord.trim()) {
      return res.status(400).json({ message: 'newWord requerido' });
    }

    const word = newWord.trim();
    const { saltB64, hashB64 } = hashSecret(word);

    await db.ref(`sessions/${sessionId}/secret`).update({
      enabled: true,
      salt: saltB64,
      hash: hashB64,
      version: Date.now(),
      createdAt: Date.now()
    });

    res.json({ ok: true, message: 'Palabra actualizada', adminWord: word });
  } catch (err) {
    console.error('Error changing secret', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
// TV: Rotar palabra (toma otra del pool)
// → { ok, message, adminWord }
//-------------------------------------------------
app.post('/session/:sessionId/secret/rotate', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const rotated = pickDefaultWord();
    const { saltB64, hashB64 } = hashSecret(rotated);

    await db.ref(`sessions/${sessionId}/secret`).update({
      enabled: true,
      salt: saltB64,
      hash: hashB64,
      version: Date.now(),
      createdAt: Date.now()
    });

    res.json({ ok: true, message: 'Palabra rotada', adminWord: rotated });
  } catch (err) {
    console.error('Error rotating secret', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
// TV: Habilitar / Deshabilitar elevación por palabra
// Body: { enabled: boolean }
//-------------------------------------------------
app.post('/session/:sessionId/secret/enable', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: 'enabled (boolean) requerido' });
    }

    await db.ref(`sessions/${sessionId}/secret/enabled`).set(enabled);
    res.json({ ok: true, message: `Admin por palabra ${enabled ? 'habilitado' : 'deshabilitado'}` });
  } catch (err) {
    console.error('Error enabling/disabling secret', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
// Mobile: Elevar a admin por palabra (scoped a la sala)
// Body: { sessionId, uid, secretAttempt }
//-------------------------------------------------
app.post('/session/admin/grant', async (req, res) => {
  try {
    const { sessionId, uid, secretAttempt } = req.body;
    if (!sessionId || !uid || typeof secretAttempt !== 'string' || !secretAttempt.trim()) {
      return res.status(400).json({ message: 'Datos inválidos' });
    }

    const snap = await db.ref(`sessions/${sessionId}`).once('value');
    if (!snap.exists()) return res.status(404).json({ message: 'Sala no encontrada' });

    const session = snap.val();
    const sec = session?.secret;

    if (!sec?.enabled || !sec?.salt || !sec?.hash) {
      return res.status(412).json({ message: 'Elevación por palabra deshabilitada o no configurada' });
    }

    if (!verifySecret(sec.salt, sec.hash, secretAttempt.trim())) {
      return res.status(403).json({ message: 'Palabra incorrecta' });
    }

    const userRef = db.ref(`sessions/${sessionId}/usuarios/${uid}`);
    const usrSnap = await userRef.once('value');

    if (!usrSnap.exists()) {
      await userRef.set({
        nombre: 'Usuario',
        dispositivo: 'movil',
        rol: 'admin',
        lastSeen: Date.now()
      });
    } else {
      await userRef.update({ rol: 'admin', lastSeen: Date.now() });
    }

    res.json({ ok: true, message: 'Elevado a admin', sessionId, uid });
  } catch (err) {
    console.error('Error granting admin', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
// Verificar código
//-------------------------------------------------
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

//-------------------------------------------------
// Obtener datos de sesión
//-------------------------------------------------
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
// Obtener cola (regresa objeto)
//-------------------------------------------------
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

//-------------------------------------------------
// Obtener orden de la cola
//-------------------------------------------------
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

//-------------------------------------------------
// Agregar canción a la cola (y array de orden) con UID
//-------------------------------------------------
app.post('/queue/add', async (req, res) => {
  try {
    const { sessionId, id, titulo, usuario, thumbnailUrl, duration, uid } = req.body;
    if (!sessionId || !id || !titulo || !usuario || !thumbnailUrl || !duration || !uid) {
      return res.status(400).json({ message: 'Datos incompletos' });
    }

    const ref = db.ref(`queues/${sessionId}`);

    const isIsoFormat = /^PT(\d+H)?(\d+M)?(\d+S)?$/.test(duration);
    const durationIso = isIsoFormat ? duration : convertirADuracionISO(duration);

    const nuevaCancion = { id, titulo, usuario, thumbnailUrl, duration: durationIso, uid };
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

//-------------------------------------------------
// Función auxiliar para convertir duración "3:14" → "PT3M14S"
//-------------------------------------------------
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

//-------------------------------------------------
// ➕ Agregar anfitriones predeterminados desde la TV
//-------------------------------------------------
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

//-------------------------------------------------
// ❌ Eliminar canción (de objeto y de array de orden)
//-------------------------------------------------
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

    const isHost = userId === 'tv'
                || userId === 'host'
                || session.host === userId
                || (session.guests && session.guests[userId] === 'host');

    const cancion = queue[pushKey];
    if (!cancion) return res.status(404).json({ message: 'Canción no encontrada' });

    // Elimina la canción del objeto
    await db.ref(`queues/${sessionId}/${pushKey}`).remove();

    // Elimina la key del array de orden
    const orderRef = db.ref(`queuesOrder/${sessionId}`);
    const orderSnap = await orderRef.once('value');
    let order = orderSnap.val() || [];
    order = order.filter(key => key !== pushKey);
    await orderRef.set(order);

    // Limpiar playbackState si ya no quedan canciones
    const updatedOrderSnap = await orderRef.once('value');
    const updatedOrder = updatedOrderSnap.val() || [];
    if (updatedOrder.length === 0) {
      await db.ref(`playbackState/${sessionId}`).set({
        playing: false,
        currentVideo: null
      });
    }

    res.json({ ok: true, message: 'Canción eliminada' });
  } catch (err) {
    console.error('Error removing song', err);
    res.status(500).json({ message: 'Internal error' });
  }
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

    // Quitar la canción de su posición actual y ponerla como siguiente (idx 1)
    const newOrder = order.filter(key => key !== pushKey);
    newOrder.splice(1, 0, pushKey);

    await orderRef.set(newOrder);

    res.json({ ok: true, message: 'Canción movida como siguiente en la cola', newOrder });
  } catch (err) {
    console.error('Error en Play Next', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
//  Agregar o actualizar usuario en una sala
//-------------------------------------------------
app.post('/session/:sessionId/user', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { uid, nombre, dispositivo, rol } = req.body;
    if (!uid || !nombre || !dispositivo) {
      return res.status(400).json({ message: 'Datos incompletos' });
    }

    const userRef = db.ref(`sessions/${sessionId}/usuarios/${uid}`);
    const userSnap = await userRef.once('value');
    const userData = userSnap.val();

    let rolFinal = 'invitado';
    if (userData) {
      rolFinal = rol || userData.rol || 'invitado';
    } else {
      rolFinal = rol || 'invitado';
    }

    await userRef.set({
      nombre,
      dispositivo,
      rol: rolFinal,
      lastSeen: Date.now()
    });

    res.json({ ok: true, message: 'Usuario registrado/actualizado', uid, rol: rolFinal });
  } catch (err) {
    console.error('Error agregando usuario', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
//  Cambiar rol de usuario (ascender/degradar anfitrión)
//-------------------------------------------------
app.post('/session/:sessionId/user/:uid/role', async (req, res) => {
  try {
    const { sessionId, uid } = req.params;
    const { rol, adminUid } = req.body;
    const allowedRoles = ['anfitrion', 'admin', 'invitado'];
    if (!rol || !allowedRoles.includes(rol)) {
      return res.status(400).json({ message: 'Rol inválido' });
    }

    // --- BLOQUE TEMPORAL: Saltar validaciones para ascender a admin ---
    if (rol === 'admin') {
      const userRef = db.ref(`sessions/${sessionId}/usuarios/${uid}`);
      const snap = await userRef.once('value');
      if (!snap.exists()) return res.status(404).json({ message: 'Usuario no encontrado' });

      await userRef.update({ rol });
      return res.json({ ok: true, message: `Rol actualizado a ${rol} (prueba sin restricción)` });
    }
    // --- FIN BLOQUE TEMPORAL ---

    // (Validaciones originales comentadas en tu versión)

    const userRef = db.ref(`sessions/${sessionId}/usuarios/${uid}`);
    const snap = await userRef.once('value');
    if (!snap.exists()) return res.status(404).json({ message: 'Usuario no encontrado' });

    await userRef.update({ rol });
    res.json({ ok: true, message: `Rol actualizado a ${rol}` });
  } catch (err) {
    console.error('Error cambiando rol', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
//  Obtener todos los usuarios de la sala
//-------------------------------------------------
app.get('/session/:sessionId/users', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const snap = await db.ref(`sessions/${sessionId}/usuarios`).once('value');
    const usuarios = snap.val() || {};

    const now = Date.now();
    Object.entries(usuarios).forEach(([uid, u]) => {
      usuarios[uid].conectado = u.lastSeen && now - u.lastSeen < 40000;
    });

    res.json(usuarios);
  } catch (err) {
    console.error('Error obteniendo usuarios', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
//  Banear usuario
//-------------------------------------------------
app.post('/session/:sessionId/user/:uid/ban', async (req, res) => {
  try {
    const { sessionId, uid } = req.params;
    const razon = req.body.razon || '';

    await db.ref(`sessions/${sessionId}/baneados/${uid}`).set(true);
    await db.ref(`sessions/${sessionId}/usuarios/${uid}`).remove();

    res.json({ ok: true, message: 'Usuario baneado', uid, razon });
  } catch (err) {
    console.error('Error baneando usuario', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
// Desbanear usuario
//-------------------------------------------------
app.post('/session/:sessionId/user/:uid/unban', async (req, res) => {
  try {
    const { sessionId, uid } = req.params;
    await db.ref(`sessions/${sessionId}/baneados/${uid}`).remove();
    res.json({ ok: true, message: 'Usuario desbaneado', uid });
  } catch (err) {
    console.error('Error desbaneando usuario', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
// Obtener usuarios baneados
//-------------------------------------------------
app.get('/session/:sessionId/banned', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const snap = await db.ref(`sessions/${sessionId}/baneados`).once('value');
    res.json(snap.val() || {});
  } catch (err) {
    console.error('Error obteniendo baneados', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
// Refrescar la sala: limpia la sala y genera un nuevo código de conexión
// (Se preserva la palabra secreta actual: NO tocamos sessions/{sessionId}/secret)
//-------------------------------------------------
app.post('/session/:sessionId/refresh', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Generar nuevo código
    const newCode = Math.floor(1000 + Math.random() * 9000).toString();

    // Limpiar la cola, el orden, el estado de reproducción y baneados
    await db.ref(`queues/${sessionId}`).set({});
    await db.ref(`queuesOrder/${sessionId}`).set([]);
    await db.ref(`playbackState/${sessionId}`).set({ playing: false, currentVideo: null });
    await db.ref(`sessions/${sessionId}/baneados`).set({});

    // Actualizar el código de conexión
    await db.ref(`sessions/${sessionId}/code`).set(newCode);

    res.json({ ok: true, message: 'Sala refrescada, código actualizado', code: newCode });
  } catch (err) {
    console.error('Error refrescando sala', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
// Expulsar (kick) usuario
//-------------------------------------------------
app.post('/session/:sessionId/user/:uid/kick', async (req, res) => {
  try {
    const { sessionId, uid } = req.params;
    await db.ref(`sessions/${sessionId}/usuarios/${uid}`).remove();
    res.json({ ok: true, message: 'Usuario expulsado', uid });
  } catch (err) {
    console.error('Error expulsando usuario', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
//  Actualizar nombre en todas las canciones del usuario en la sala
//-------------------------------------------------
app.post('/session/:sessionId/user/:uid/updateName', async (req, res) => {
  try {
    const { sessionId, uid } = req.params;
    const { nuevoNombre } = req.body;
    if (!nuevoNombre) return res.status(400).json({ message: 'Falta nuevo nombre' });

    const queueRef = db.ref(`queues/${sessionId}`);
    const snapshot = await queueRef.once('value');
    const updates = {};

    snapshot.forEach(child => {
      const cancion = child.val();
      if (cancion.uid === uid) {
        updates[`${child.key}/usuario`] = nuevoNombre;
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.json({ ok: true, message: 'No se encontraron canciones para actualizar' });
    }

    await queueRef.update(updates);
    res.json({ ok: true, actualizadas: Object.keys(updates).length });
  } catch (err) {
    console.error('Error actualizando nombre de usuario en canciones', err);
    res.status(500).json({ message: 'Internal error' });
  }
});

//-------------------------------------------------
//  Arrancar servidor (al final)
//-------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎧 Playlistify API corriendo en el puerto ${PORT}`);
});
