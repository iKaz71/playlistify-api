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

## 📚 Endpoints disponibles

| Método | Endpoint | Descripción |
|:------:|:--------:|:-----------:|
| `POST` | `/session/create` | Crear nueva sesión |
| `POST` | `/session/verify` | Verificar código de sesión |
| `GET`  | `/queue/:sessionId` | Obtener la cola de reproducción |

## 💜 Licencia

Proyecto para uso personal y educativo.

