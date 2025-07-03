# Playlistify API

🎶 API Backend para gestionar sesiones, colas de reproducción y estado de reproducción en **Firebase Realtime Database**.

## 🚀 Tecnologías utilizadas

- Node.js
- Express
- Firebase Admin SDK
- Railway (Deployment recomendado)

## 📦 Instalación local

1. Clona el repositorio:
   ```bash
   git clone https://github.com/iKaz71/playlistify-api.git
   cd playlistify-api
   ```

2. Instala las dependencias:
   ```bash
   npm install
   ```

3. Crea un archivo `.env` basado en `.env.example`:
   ```bash
   cp .env.example .env
   ```

4. Llena tu archivo `.env` real con tus credenciales de Firebase.

## ⚙️ Variables de Entorno requeridas

```env
FIREBASE_PROJECT_ID=playlistify-f1a04
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nTU-PRIVATE-KEY-EN-UNA-LINEA\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@playlistify-f1a04.iam.gserviceaccount.com
FIREBASE_DATABASE_URL=https://playlistify-f1a04-default-rtdb.firebaseio.com
```

## 🛠️ Scripts disponibles

- **Iniciar servidor en local:**

  ```bash
  npm run start
  ```

- **Iniciar servidor con nodemon (modo desarrollo):**

  ```bash
  npm run dev
  ```

## 📚 Endpoints principales

| Método | Endpoint                  | Descripción                               |
|:------:|:-------------------------:|:------------------------------------------|
| POST   | `/session/create`         | Crear nueva sesión                        |
| POST   | `/session/verify`         | Verificar código de sesión                |
| GET    | `/queue/:sessionId`       | Obtener la cola de reproducción           |
| GET    | `/queueOrder/:sessionId`  | Obtener el orden de la cola               |
| POST   | `/queue/add`              | Agregar canción a la cola                 |
| POST   | `/queue/remove`           | Eliminar canción de la cola               |
| POST   | `/queue/playnext`         | Mover canción como siguiente a reproducir |
| GET    | `/session/:sessionId`     | Obtener datos de una sesión               |
| POST   | `/session/:sessionId/user`| Agregar/actualizar usuario en sala        |
| POST   | `/session/:sessionId/user/:uid/role` | Cambiar rol de usuario         |
| GET    | `/session/:sessionId/users`| Obtener todos los usuarios de la sala     |
| POST   | `/session/:sessionId/user/:uid/ban`   | Banear usuario                 |
| POST   | `/session/:sessionId/user/:uid/unban` | Desbanear usuario               |
| GET    | `/session/:sessionId/banned`| Obtener usuarios baneados               |
| POST   | `/session/:sessionId/refresh` | Refrescar sala/código de conexión      |
| POST   | `/session/:sessionId/user/:uid/kick`  | Expulsar usuario                  |
| POST   | `/session/:sessionId/user/:uid/updateName` | Actualizar nombre en canciones |
| POST   | `/hosts/default`           | Guardar anfitriones por defecto en sala   |

---

## 🧩 Detalles de uso

- **Seguridad:** Todas las operaciones críticas requieren datos completos y válidos.  
- **Integración:** Ideal para usarse junto con las apps Playlistify Android, iOS y TV.
- **Base de datos:** Todos los datos de sesión, usuarios, colas y estado de reproducción se almacenan en Firebase Realtime Database.
- **Despliegue:** Railway recomendado, pero compatible con cualquier entorno Node.js moderno.

---

## 💜 Licencia

Este proyecto está licenciado bajo la [MIT License](LICENSE).

---

## 🚀 Ecosistema Playlistify

- [Playlistify Android](https://github.com/iKaz71/Playlistify-Android)
- [Playlistify iOS](https://github.com/iKaz71/Playlistify-iOS)
- [TV Playlistify](https://github.com/iKaz71/TvPlaylistify)

---


