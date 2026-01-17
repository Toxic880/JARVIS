# JARVIS Server

Secure backend for the JARVIS voice assistant. Handles authentication, LLM proxying, TTS, memory persistence, and tool execution with proper security controls.

## Features

- **JWT Authentication** - Secure token-based auth with refresh tokens
- **LLM Proxy** - Routes requests to LM Studio/OpenAI with sanitization
- **TTS Proxy** - ElevenLabs integration with server-side API keys
- **Persistent Memory** - SQLite storage with client sync
- **Tool Guard** - Allowlist validation, logging, and confirmation for destructive actions
- **Home Assistant Proxy** - Secure device control with audit logging
- **OAuth Token Exchange** - Server-side secret handling for Spotify/Google

## Quick Start

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

Required variables:
- `JWT_SECRET` - Random string for signing access tokens (min 32 chars)
- `JWT_REFRESH_SECRET` - Random string for refresh tokens (min 32 chars)

Optional integrations:
- `LLM_BASE_URL` - LM Studio or OpenAI-compatible endpoint
- `ELEVENLABS_API_KEY` - For TTS
- `HOME_ASSISTANT_URL` & `HOME_ASSISTANT_TOKEN` - For smart home
- `SPOTIFY_CLIENT_ID` & `SPOTIFY_CLIENT_SECRET` - For music control
- `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` - For calendar/tasks

### 3. Start Development Server

```bash
npm run dev
```

Server runs on http://localhost:3001

### 4. Initial Setup

On first run, create an admin account:

```bash
curl -X POST http://localhost:3001/api/v1/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-secure-password"}'
```

## Production Deployment

### Using Docker

```bash
# Build image
docker build -t jarvis-server .

# Run container
docker run -d \
  --name jarvis-server \
  -p 3001:3001 \
  -v jarvis-data:/app/data \
  -v jarvis-logs:/app/logs \
  -e JWT_SECRET=your-secret-here \
  -e JWT_REFRESH_SECRET=your-refresh-secret \
  -e LLM_BASE_URL=http://host.docker.internal:1234 \
  jarvis-server
```

### Using Docker Compose

From the project root:

```bash
# Copy and edit environment
cp .env.example .env
nano .env

# Start all services
docker-compose up -d
```

### Security Checklist

Before exposing to any network:

- [ ] Change default JWT secrets
- [ ] Create admin account with strong password
- [ ] Enable HTTPS (use reverse proxy like Caddy or nginx)
- [ ] Configure CORS to only allow your client origin
- [ ] Review and restrict `ALLOWED_ORIGINS`
- [ ] Enable rate limiting (already configured)
- [ ] Set up log monitoring

## API Endpoints

### Authentication

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/v1/auth/status` | Check if setup required | No |
| POST | `/api/v1/auth/setup` | Create admin (first run only) | No |
| POST | `/api/v1/auth/login` | Login | No |
| POST | `/api/v1/auth/refresh` | Refresh access token | No |
| POST | `/api/v1/auth/logout` | Logout | Yes |
| GET | `/api/v1/auth/me` | Get current user | Yes |

### LLM Proxy

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/v1/llm/chat/completions` | Chat completion | Yes |
| GET | `/api/v1/llm/models` | List models | Yes |
| GET | `/api/v1/llm/status` | Check LLM backend | Yes |

### TTS Proxy

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/v1/tts/speak` | Text to speech | Yes |
| GET | `/api/v1/tts/voices` | List voices | Yes |
| GET | `/api/v1/tts/status` | Check TTS status | Yes |

### Memory

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/v1/memory` | List memories | Yes |
| POST | `/api/v1/memory` | Create memory | Yes |
| PUT | `/api/v1/memory/:id` | Update memory | Yes |
| DELETE | `/api/v1/memory/:id` | Delete memory | Yes |
| POST | `/api/v1/memory/sync` | Sync with client | Yes |
| GET | `/api/v1/memory/export/all` | Export all | Yes |
| POST | `/api/v1/memory/import` | Import (admin) | Admin |

### Tools

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/v1/tools` | List tool definitions | Yes |
| POST | `/api/v1/tools/execute` | Execute tool | Yes |
| POST | `/api/v1/tools/confirm` | Confirm dangerous tool | Yes |
| GET | `/api/v1/tools/pending` | Get pending confirmations | Yes |
| GET | `/api/v1/tools/history` | Get execution history | Yes |

### Home Assistant

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/v1/home-assistant/status` | Check connection | Yes |
| GET | `/api/v1/home-assistant/states` | Get all states | Yes |
| POST | `/api/v1/home-assistant/control` | Control device | Yes |
| POST | `/api/v1/home-assistant/services` | Call service | Yes |
| POST | `/api/v1/home-assistant/scenes/activate` | Activate scene | Yes |

### OAuth

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/v1/oauth/spotify/config` | Get Spotify OAuth config | Optional |
| POST | `/api/v1/oauth/spotify/token` | Exchange code for tokens | Yes |
| POST | `/api/v1/oauth/spotify/refresh` | Refresh tokens | Yes |
| GET | `/api/v1/oauth/google/config` | Get Google OAuth config | Optional |
| POST | `/api/v1/oauth/google/token` | Exchange code | Yes |
| POST | `/api/v1/oauth/google/refresh` | Refresh tokens | Yes |

### Health

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/v1/health` | Basic health check | No |
| GET | `/api/v1/health/ready` | Readiness check | No |
| GET | `/api/v1/health/version` | Version info | No |
| GET | `/api/v1/health/config` | Service config status | No |

## Tool Security

Tools are categorized by risk level:

### Safe (No confirmation)
- `getTime`, `getDate`, `getWeather`
- `getTimers`, `getAlarms`, `getReminders`
- `getList`, `getNote`, `getSchedule`
- `getCurrentTrack`, `getNews`, `getStockPrice`
- `calculate`, `recall`, `getSystemStatus`

### Moderate (Logged, no confirmation)
- `setTimer`, `cancelTimer`, `setAlarm`, `setReminder`
- `addToList`, `removeFromList`, `createNote`
- `remember`, `playMusic`, `pauseMusic`, `setVolume`
- `setMode`, `announce`

### Dangerous (Requires confirmation)
- `controlDevice` - Smart home control
- `sendEmail` - Send email
- `sendSMS` - Send text message
- `createEvent`, `deleteEvent` - Calendar changes
- `forget`, `clearList` - Data deletion

## Database Schema

SQLite database at `DATABASE_PATH` (default: `./data/jarvis.db`)

### Tables

- `users` - Authentication
- `sessions` - Refresh tokens
- `memory` - Persistent memory
- `tool_logs` - Audit trail
- `timers`, `alarms`, `reminders` - Scheduled items
- `lists`, `list_items` - Lists
- `notes` - Notes
- `settings` - User preferences

## Logging

Logs are written to:
- `logs/jarvis.log` - All logs
- `logs/error.log` - Errors only
- `logs/audit.log` - Security events

Log format: JSON with timestamp, level, message, and metadata.

## Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm test -- --coverage
```

## Security Best Practices

1. **Never commit `.env`** - Contains secrets
2. **Rotate JWT secrets periodically**
3. **Use HTTPS in production** - Required for OAuth
4. **Monitor audit logs** - Check for suspicious activity
5. **Keep dependencies updated** - `npm audit`
6. **Restrict CORS origins** - Only your client domains
7. **Use rate limiting** - Already enabled
8. **Validate all inputs** - Zod schemas throughout

## Troubleshooting

### "Database not initialized"
```bash
npm run db:migrate
```

### "JWT secret not set"
Check `.env` file has `JWT_SECRET` and `JWT_REFRESH_SECRET`

### "LLM backend not configured"
Set `LLM_BASE_URL` in `.env` to your LM Studio/OpenAI endpoint

### "CORS blocked"
Add your client origin to `ALLOWED_ORIGINS` in `.env`

### Tool execution rejected
Check `logs/audit.log` for the rejection reason. Common causes:
- Tool not in allowlist
- Invalid parameters
- Missing confirmation for dangerous action

## License

MIT
