# Soft Steps
Soft Steps is a web app for recording hiking biomechanics data from an ESP32-based sensor, storing hike summaries in Supabase, and asking AI questions about your recorded hikes.

## Hardware Requirements
- ESP32
- 2 x IMU

## What the project includes

- **Frontend (`/frontend`)**
  - Sign up/sign in with Supabase Auth
  - Start a hike session and connect to an ESP32 over Web Bluetooth
  - Live metrics (knee angle, acceleration, impact detection)
  - Hike history and detail pages
  - AI chat page for questions about your own hike data
- **Backend (`/backend`)**
  - Express API for health checks and AI chat
  - Supabase token validation per request
  - User-scoped hike lookup
  - Snowflake Cortex integration through the OpenAI SDK

## Repository structure

```text
hiking-sensor/
├── frontend/   # static web app (HTML/CSS/JS)
└── backend/    # Node.js Express API
```

## Prerequisites

- Node.js 18+ (for backend)
- A Supabase project (Auth, `hikes` table, `hike-data` storage bucket)
- Snowflake Cortex access (for AI chat responses)
- A Web Bluetooth-capable browser (for live sensor use)

## Backend setup

1. Go to the backend folder:
   ```bash
   cd /home/runner/work/hiking-sensor/hiking-sensor/backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in `/backend`:
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_service_or_secret_key
   SNOWFLAKE_ACCOUNT_URL=your_snowflake_account_url
   SNOWFLAKE_PAT=your_snowflake_personal_access_token
   SNOWFLAKE_MODEL=your_cortex_model_name
   PORT=3000
   ```
4. Start the backend:
   ```bash
   npm start
   ```

### Backend API

- `GET /health` → backend status
- `GET /hikes` → signed-in user hikes (requires a valid Supabase access token)
- `POST /chat` → answers questions using the signed-in user’s hikes

## Frontend setup

1. Edit `/home/runner/work/hiking-sensor/hiking-sensor/frontend/supabase-config.js` with your Supabase URL and anon key.
2. Serve `/frontend` with a local static server (for example, VS Code Live Server or `python -m http.server`).
3. Open `index.html` from that local server.

### Frontend flow

1. Sign in from `index.html`
2. Open dashboard and start a new hike
3. Connect ESP32 and record a session
4. Finish hike to upload data and compute stats
5. Open `chat.html` to ask questions about your own hikes

## Development notes

- `frontend/chat.js` targets `http://localhost:3000/chat`; keep backend running on port 3000 unless you update that URL.
- If Web Bluetooth is unavailable, hike recording cannot connect to real hardware.
- New hike pages support a mock mode with `?mockBluetooth=1` for sensor simulation.
