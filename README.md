# 🤖 J.A.R.V.I.S.

**Just A Rather Very Intelligent System**

A personal AI assistant with voice control, smart home integration, and more.

## ⚡ Quick Start

```bash
# 1. Setup (interactive wizard)
node jarvis.cjs setup

# 2. Start
node jarvis.cjs
```

That's it. Open **http://localhost:3000** in your browser.

## 🎤 Voice Control

- **Click** the Arc Reactor to talk
- **Enable Wake Word** to say "Hey Jarvis" hands-free
- Responses can be spoken aloud (requires ElevenLabs API key)

## ✨ What Can It Do?

| Feature | Example | Requires |
|---------|---------|----------|
| Chat | "What's the weather?" | AI only |
| Timers | "Set a 5 minute timer" | Nothing |
| Music | "Play jazz" | Spotify |
| Calendar | "What's on today?" | Google |
| Email | "Check my inbox" | Google |
| Smart Home | "Turn off lights" | Home Assistant |

## 🔧 Commands

```bash
node jarvis.cjs          # Start server
node jarvis.cjs setup    # Interactive setup
node jarvis.cjs doctor   # Diagnose issues
```

## 📁 Project Structure

```
jarvis/
├── src/                # Frontend (React)
│   ├── App.tsx         # Main app
│   ├── components/     # UI components
│   └── services/       # Client services
├── server/             # Backend (Node.js)
│   └── src/
│       ├── routes/     # API endpoints
│       ├── executors/  # Tool implementations
│       └── core/       # Brain & orchestrator
├── electron/           # Desktop app (optional)
└── jarvis.cjs          # CLI tool
```

## ⚙️ Configuration

Minimum `.env`:
```env
OPENAI_API_KEY=sk-...
```

Or use local LLM (free):
```env
LLM_BASE_URL=http://localhost:1234
```

Optional services:
```env
ELEVENLABS_API_KEY=...          # Voice output
SPOTIFY_CLIENT_ID=...           # Music control
GOOGLE_CLIENT_ID=...            # Calendar/Email
HOME_ASSISTANT_URL=...          # Smart home
```

## 📄 License

MIT
