# NEXUS Chatbot — Design Spec
**Date:** 2026-04-24  
**Author:** Vasan (Manicka Vasan)  
**Status:** Approved

---

## Overview

NEXUS is an AI-powered chatbot deployed as a standalone Vercel project and embedded into `manickavasan.com` via a 3-line HTML snippet. It answers employer questions about Vasan using knowledge stored in an environment variable. It uses Groq's free API with streaming responses and a premium glassmorphism dark UI designed to blend with the existing portfolio.

---

## Architecture

```
manickavasan-portfolio (existing Vite + React repo)
  └── index.html  ← 3-line snippet added before </body>

nexus-chatbot/ (standalone Vercel project)
  ├── api/
  │   └── chat.js          ← Vercel serverless function
  ├── public/
  │   ├── nexus.js         ← All chatbot UI logic (vanilla ES2022+)
  │   └── nexus.css        ← All styles (glassmorphism dark theme)
  ├── .env                 ← GROQ_API_KEY + NEXUS_KNOWLEDGE (git-ignored)
  ├── .env.example         ← Safe placeholder template
  ├── .gitignore
  └── vercel.json          ← Routes /api/* → serverless, /* → public/
```

### Data Flow

1. Portfolio page loads → `<script>` and `<link>` tags fetch `nexus.js` + `nexus.css` from the NEXUS Vercel deployment
2. User opens chat → `nexus.js` maintains conversation history (last 6 messages) in memory
3. On message send → `POST /api/chat` with `{ message: string, history: Message[] }`
4. `api/chat.js` reads `NEXUS_KNOWLEDGE` from env, builds system prompt, calls Groq with streaming enabled
5. Response streams back as SSE (`text/event-stream`) → frontend reads `ReadableStream`, appends tokens word-by-word into the active bot bubble
6. On error → structured JSON error displayed in a red retry bubble

---

## Backend (`api/chat.js`)

### Inputs
```json
{
  "message": "string (max 200 chars)",
  "history": [{ "role": "user|assistant", "content": "string" }]
}
```
History is capped at the last 6 messages before being sent.

### Configuration
| Setting | Value |
|---|---|
| Model | `llama-3.3-70b-versatile` |
| Temperature | `0.75` |
| Max tokens | `350` |
| Streaming | `true` |

### System Prompt Persona
NEXUS introduces itself as "NEXUS" (not as Vasan). It is friendly, confident, slightly witty, and professional. It answers questions about Vasan using `NEXUS_KNOWLEDGE`. For off-topic questions it politely redirects back to Vasan.

### Knowledge Source
`process.env.NEXUS_KNOWLEDGE` — never read from any file.

### Rate Limiting
In-memory `Map<ip, { count: number, resetAt: number }>`. Max 20 requests per IP per hour. Returns `HTTP 429` with `Retry-After` header on breach.

### CORS
- `Access-Control-Allow-Origin: https://manickavasan.com`
- Also allows `http://localhost:5173` in development

### Error Responses
All errors return structured JSON:
```json
{ "error": { "code": "RATE_LIMITED|BAD_REQUEST|UPSTREAM_ERROR", "message": "string" } }
```

| Code | HTTP Status | Cause |
|---|---|---|
| `BAD_REQUEST` | 400 | Missing/invalid message or history |
| `RATE_LIMITED` | 429 | >20 req/hour from same IP |
| `UPSTREAM_ERROR` | 500 | Groq API failure |

### Streaming
Uses Groq's streaming API. Tokens are written as SSE chunks (`data: <token>\n\n`). Stream ends with `data: [DONE]\n\n`.

---

## Frontend (`nexus.js` + `nexus.css`)

### Color Palette (matched to portfolio)
| Variable | Value | Usage |
|---|---|---|
| `--nx-bg` | `#020617` | Panel background base |
| `--nx-accent` | `#646cff` | Primary accent (purple-blue) |
| `--nx-accent-2` | `#a78bfa` | Secondary accent (lighter purple) |
| `--nx-glass` | `rgba(2,6,23,0.85)` | Glassmorphism panel bg |
| `--nx-border` | `rgba(100,108,255,0.2)` | Panel/bubble borders |
| `--nx-font` | `Inter, ui-sans-serif, system-ui` | Font (matches portfolio) |

### Launcher Button
- Fixed position: bottom-right (`bottom: 24px; right: 24px`)
- Pill shape (`border-radius: 50px`)
- Animated rotating `conic-gradient` border (CSS `@keyframes` only)
- Text: `NEXUS ✦` with breathing `@keyframes` pulse
- Hover: spring-like `transform: scale(1.05)` with `cubic-bezier`

### Chat Panel
- Size: 360px wide × 520px tall (desktop)
- `backdrop-filter: blur(20px)` glassmorphism
- Opens with `cubic-bezier(0.34, 1.56, 0.64, 1)` spring slide-up
- Header: "NEXUS" title + pulsing green status dot
- Suggestion chips below header: "What's his stack?", "Is he available?", "Show me his projects" — hidden after first message sent

### Messages
| Type | Alignment | Style |
|---|---|---|
| Bot | Left | Dark bubble, 3px purple left border, streams word-by-word |
| User | Right | Purple→blue gradient bubble |
| Error | Left | Red bubble with retry button |

- Staggered fade-slide-up animation on arrival
- Timestamps: relative ("just now", "2 min ago")
- Typing indicator: 3 CSS-animated bouncing dots, shown until first streaming token arrives

### Input Area
- `<textarea>` auto-resizes as user types
- 200 character limit with SVG arc progress indicator
- Enter sends, Shift+Enter = new line
- Send button: arrow icon only, glows `#646cff` on hover

### Micro-interactions
- Bot typing: slow purple shimmer on panel border
- Message arrives: barely visible ripple on panel
- Error: bubble turns red, retry button appears
- Empty state: CSS-drawn avatar placeholder (no images)

### Mobile
- Panel takes full screen as a bottom sheet
- Drag handle at top for swipe-to-close gesture

---

## Environment Variables

```env
GROQ_API_KEY=your_groq_api_key_here
NEXUS_KNOWLEDGE=Your name is Vasan. You are a Full Stack Developer based in Hamilton, New Zealand. [replace with full info]
```

`.env` is git-ignored. `.env.example` is committed with placeholder values.

---

## `vercel.json` Routing

```json
{
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1" },
    { "src": "/(.*)", "dest": "/public/$1" }
  ]
}
```

---

## Integration Snippet

Three lines added to the portfolio's `index.html` before `</body>`:

```html
<link rel="stylesheet" href="https://<your-vercel-url>/nexus.css">
<script src="https://<your-vercel-url>/nexus.js" defer></script>
<!-- NEXUS chatbot by Vasan -->
```

Replace `<your-vercel-url>` with the URL Vercel assigns on first deploy (e.g. `nexus-chatbot.vercel.app`), or your custom domain if you add one later.

---

## Success Criteria

- [ ] Chatbot launches from portfolio with zero page reload
- [ ] API key never exposed in browser network tab
- [ ] Streaming text appears word-by-word in bot bubble
- [ ] Rate limiting blocks >20 req/hour per IP
- [ ] Mobile bottom sheet works with swipe-to-close
- [ ] All animations run at 60fps (CSS only, no JS animation loops)
- [ ] Suggestion chips disappear after first message
- [ ] Error state shows red bubble with retry button
