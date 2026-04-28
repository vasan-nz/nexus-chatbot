# NEXUS Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build NEXUS — a streaming AI chatbot widget deployed on Vercel that embeds into manickavasan.com with a glassmorphism dark UI and answers employer questions about Vasan.

**Architecture:** Standalone Vercel project with one serverless function (`api/chat.js`) that proxies Groq streaming, and two static assets (`public/nexus.js`, `public/nexus.css`) loaded via a 3-line snippet in the portfolio's `index.html`. Knowledge is stored in `NEXUS_KNOWLEDGE` env var, never in any file. API key is never exposed to the browser.

**Tech Stack:** Vanilla ES2022+, CSS3 (glassmorphism, `@property`, conic-gradient), Vercel Serverless (Node 20), Groq API (llama-3.3-70b-versatile), native `fetch` with `ReadableStream` for streaming — zero npm dependencies on the frontend.

---

## File Map

| File | Responsibility |
|---|---|
| `api/chat.js` | Serverless function: CORS, rate-limiting, system prompt, Groq streaming SSE |
| `public/nexus.js` | All chatbot UI: DOM creation, events, streaming fetch, timestamps, mobile |
| `public/nexus.css` | All styles: launcher, panel, messages, animations, mobile bottom sheet |
| `.env` | `GROQ_API_KEY` + `NEXUS_KNOWLEDGE` — git-ignored |
| `.env.example` | Safe placeholder template |
| `.gitignore` | Ignores `.env`, `node_modules` |
| `vercel.json` | Routes `/api/*` → serverless, `/*` → `public/` |

---

## Task 1: Project Scaffold

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `.env`
- Create: `vercel.json`

- [ ] **Step 1: Create `.gitignore`**

```
.env
node_modules/
.vercel/
*.log
```

- [ ] **Step 2: Create `.env.example`**

```
GROQ_API_KEY=gsk_your_groq_api_key_here
NEXUS_KNOWLEDGE=Your name is Vasan (Manickavasang Rajendran). You are a Full Stack Developer based in Hamilton, New Zealand. Skills: React, Node.js, TypeScript, HTML, CSS, JavaScript. Replace this with your full bio.
```

- [ ] **Step 3: Create `.env`**

```
GROQ_API_KEY=gsk_your_actual_groq_api_key_here
NEXUS_KNOWLEDGE=Your name is Vasan (Manickavasang Rajendran). You are a Full Stack Developer based in Hamilton, New Zealand. Skills: React, Node.js, TypeScript, HTML, CSS, JavaScript. Replace this value with your complete professional bio before deploying.
```

- [ ] **Step 4: Create `vercel.json`**

```json
{
  "version": 2,
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1" },
    { "src": "/(.*)", "dest": "/public/$1" }
  ]
}
```

- [ ] **Step 5: Verify directory structure**

Run:
```bash
ls -la
```
Expected output shows: `.env`, `.env.example`, `.gitignore`, `vercel.json`, `api/`, `public/`, `docs/`

- [ ] **Step 6: Commit**

```bash
git init
git add .gitignore .env.example vercel.json
git commit -m "feat: scaffold NEXUS project — config files and directory structure"
```

---

## Task 2: Backend Serverless Function (`api/chat.js`)

**Files:**
- Create: `api/chat.js`

- [ ] **Step 1: Create `api/chat.js` with the complete implementation**

```javascript
/**
 * NEXUS — /api/chat
 * Vercel serverless function: rate-limiting, CORS, Groq streaming.
 * Knowledge is read exclusively from process.env.NEXUS_KNOWLEDGE.
 */

const rateLimitStore = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Extract client IP from request headers.
 * @param {import('@vercel/node').VercelRequest} req
 * @returns {string}
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Check and increment rate limit for a given IP.
 * @param {string} ip
 * @returns {{ allowed: boolean, resetAt?: number }}
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now > record.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true };
  }

  if (record.count >= RATE_LIMIT) {
    return { allowed: false, resetAt: record.resetAt };
  }

  record.count += 1;
  return { allowed: true };
}

/**
 * Set CORS headers. Only allows manickavasan.com and localhost:5173.
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 */
function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ['https://manickavasan.com', 'http://localhost:5173', 'http://localhost:3000'];
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

/**
 * Build the NEXUS system prompt using the NEXUS_KNOWLEDGE env var.
 * @returns {string}
 */
function buildSystemPrompt() {
  const knowledge = process.env.NEXUS_KNOWLEDGE || '';
  return `You are NEXUS, an AI assistant embedded in Vasan's personal portfolio at manickavasan.com. Your sole purpose is to help employers, recruiters, and collaborators learn about Vasan.

Here is everything you know about Vasan:
${knowledge}

Rules you must follow:
- Always introduce yourself as NEXUS, not as Vasan.
- Be friendly, confident, slightly witty, and professional.
- Keep answers concise — 2 to 4 sentences unless more detail is genuinely needed.
- If asked anything not related to Vasan or his professional background, respond with: "I'm NEXUS — Vasan's personal AI assistant. I can only tell you about him. What would you like to know?"
- Never fabricate information about Vasan that is not in your knowledge base. If you don't know something, say so honestly.
- Speak positively and enthusiastically about Vasan's skills, projects, and potential.`;
}

/**
 * Main Vercel serverless handler.
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 */
export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are accepted.' } });
    return;
  }

  const ip = getClientIp(req);
  const rateCheck = checkRateLimit(ip);

  if (!rateCheck.allowed) {
    const retryAfterSecs = Math.ceil((rateCheck.resetAt - Date.now()) / 1000);
    res.setHeader('Retry-After', retryAfterSecs);
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Please try again in ${Math.ceil(retryAfterSecs / 60)} minutes.`
      }
    });
    return;
  }

  const { message, history } = req.body ?? {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'message is required and must be a non-empty string.' } });
    return;
  }

  if (message.length > 200) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'message exceeds the 200-character limit.' } });
    return;
  }

  const safeHistory = Array.isArray(history)
    ? history
        .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
        .slice(-6)
    : [];

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...safeHistory,
    { role: 'user', content: message.trim() }
  ];

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.75,
        max_tokens: 350,
        stream: true
      })
    });

    if (!groqRes.ok) {
      const errorBody = await groqRes.text().catch(() => '');
      throw new Error(`Groq responded ${groqRes.status}: ${errorBody}`);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = groqRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') {
          res.write('data: [DONE]\n\n');
          break;
        }
        try {
          const parsed = JSON.parse(raw);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch {
          // Discard malformed SSE chunks from Groq
        }
      }
    }

    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          code: 'UPSTREAM_ERROR',
          message: 'Failed to reach the AI. Please try again in a moment.'
        }
      });
    } else {
      res.write('data: [ERROR]\n\n');
      res.end();
    }
  }
}
```

- [ ] **Step 2: Install Vercel CLI and start local dev server**

```bash
npm install -g vercel
vercel dev
```

Expected: server starts at `http://localhost:3000`. You should see:
```
> Ready! Available at http://localhost:3000
```

- [ ] **Step 3: Smoke-test the OPTIONS preflight**

In a new terminal:
```bash
curl -s -X OPTIONS http://localhost:3000/api/chat \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -i | head -20
```

Expected: HTTP 200 with `Access-Control-Allow-Origin: http://localhost:5173`

- [ ] **Step 4: Test a valid streaming request**

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"message":"Who is Vasan?","history":[]}' \
  --no-buffer
```

Expected: series of SSE lines like:
```
data: {"token":"Vasan"}
data: {"token":" is"}
data: {"token":" a"}
...
data: [DONE]
```

- [ ] **Step 5: Test rate limiting (run 21 identical requests)**

```bash
for i in $(seq 1 21); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/chat \
    -H "Content-Type: application/json" \
    -d '{"message":"test","history":[]}'
done
```

Expected: first 20 return `200`, the 21st returns `429`.

- [ ] **Step 6: Test bad input**

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"","history":[]}' | cat
```

Expected: `{"error":{"code":"BAD_REQUEST","message":"message is required and must be a non-empty string."}}`

- [ ] **Step 7: Commit**

```bash
git add api/chat.js
git commit -m "feat: add NEXUS serverless function with Groq streaming, rate-limiting, and CORS"
```

---

## Task 3: Styles (`public/nexus.css`)

**Files:**
- Create: `public/nexus.css`

- [ ] **Step 1: Create `public/nexus.css` with the complete stylesheet**

```css
/* ─── NEXUS Chatbot Styles ──────────────────────────────────────────────── */

/* CSS Houdini property required for conic-gradient border animation.
   Supported: Chrome 85+, Edge 85+, Safari 16.4+, Firefox 128+           */
@property --nx-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

:root {
  --nx-bg:          #020617;
  --nx-accent:      #646cff;
  --nx-accent-2:    #a78bfa;
  --nx-glass:       rgba(2, 6, 23, 0.88);
  --nx-border:      rgba(100, 108, 255, 0.18);
  --nx-font:        Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
  --nx-radius:      16px;
  --nx-shadow:      0 24px 48px rgba(0, 0, 0, 0.55), 0 8px 16px rgba(0, 0, 0, 0.3);
  --nx-green:       #22c55e;
  --nx-red:         #ef4444;
  --nx-amber:       #f59e0b;
  --nx-text:        rgba(255, 255, 255, 0.92);
  --nx-text-muted:  rgba(255, 255, 255, 0.45);
  --nx-spring:      cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* ─── Keyframes ─────────────────────────────────────────────────────────── */

@keyframes nx-border-spin {
  from { --nx-angle: 0deg; }
  to   { --nx-angle: 360deg; }
}

@keyframes nx-breathe {
  0%, 100% { opacity: 1;   transform: scale(1);    }
  50%       { opacity: 0.8; transform: scale(0.975); }
}

@keyframes nx-slide-up {
  from { opacity: 0; transform: translateY(16px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0)     scale(1);   }
}

@keyframes nx-bounce-dot {
  0%, 100% { transform: translateY(0);  opacity: 0.4; }
  50%       { transform: translateY(-5px); opacity: 1;   }
}

@keyframes nx-shimmer {
  0%, 100% { border-color: rgba(100, 108, 255, 0.18); box-shadow: var(--nx-shadow); }
  50%       { border-color: rgba(100, 108, 255, 0.55); box-shadow: var(--nx-shadow), 0 0 24px rgba(100,108,255,0.12); }
}

@keyframes nx-status-glow {
  0%, 100% { box-shadow: 0 0 0 0   rgba(34, 197, 94, 0.5); }
  50%       { box-shadow: 0 0 0 5px rgba(34, 197, 94, 0);   }
}

@keyframes nx-fade-up {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0);   }
}

/* ─── Launcher Button ───────────────────────────────────────────────────── */

#nx-launcher {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 999998;

  padding: 11px 22px;
  border-radius: 50px;

  /* Glass base */
  background: var(--nx-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);

  /* No native border — conic pseudo-element provides it */
  border: none;

  color: var(--nx-text);
  font-family: var(--nx-font);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 1px;
  cursor: pointer;
  user-select: none;
  outline: none;

  transition: transform 0.25s var(--nx-spring), box-shadow 0.25s ease;
  animation: nx-breathe 3s ease-in-out infinite;
}

/* Rotating conic-gradient border */
#nx-launcher::before {
  content: '';
  position: absolute;
  inset: -1.5px;
  border-radius: 52px;
  background: conic-gradient(
    from var(--nx-angle),
    transparent 0deg,
    var(--nx-accent) 80deg,
    var(--nx-accent-2) 160deg,
    transparent 220deg,
    transparent 360deg
  );
  animation: nx-border-spin 3s linear infinite;
  z-index: -1;
}

/* Inner fill — sits on top of ::before, creates "border" effect */
#nx-launcher::after {
  content: '';
  position: absolute;
  inset: 1px;
  border-radius: 48px;
  background: var(--nx-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  z-index: -1;
}

#nx-launcher:hover {
  transform: scale(1.06);
  animation: none;
  box-shadow: 0 0 0 1px rgba(100, 108, 255, 0.4),
              0 8px 32px rgba(100, 108, 255, 0.25);
}

#nx-launcher:active {
  transform: scale(0.97);
}

/* ─── Chat Panel ────────────────────────────────────────────────────────── */

#nx-panel {
  position: fixed;
  bottom: 80px;
  right: 24px;
  width: 360px;
  height: 520px;
  z-index: 999999;

  display: flex;
  flex-direction: column;

  border-radius: var(--nx-radius);
  background: var(--nx-glass);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--nx-border);
  box-shadow: var(--nx-shadow);

  font-family: var(--nx-font);
  overflow: hidden;
  transform-origin: bottom right;

  animation: nx-slide-up 0.4s var(--nx-spring) forwards;
  transition: border-color 0.4s ease, box-shadow 0.4s ease;
}

#nx-panel.nx-hidden {
  display: none;
}

/* Purple shimmer while bot is typing */
#nx-panel.nx-typing {
  animation: nx-shimmer 1.8s ease-in-out infinite;
}

/* ─── Drag Handle (mobile only) ─────────────────────────────────────────── */

#nx-drag-handle {
  display: none;
  justify-content: center;
  padding: 10px 0 2px;
  cursor: grab;
  flex-shrink: 0;
}

.nx-drag-bar {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
}

/* ─── Header ────────────────────────────────────────────────────────────── */

#nx-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--nx-border);
  flex-shrink: 0;
}

.nx-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.nx-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--nx-green);
  flex-shrink: 0;
  animation: nx-status-glow 2s ease-in-out infinite;
}

.nx-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--nx-text);
  letter-spacing: 1.5px;
}

.nx-subtitle {
  font-size: 10px;
  color: var(--nx-text-muted);
  font-weight: 400;
  letter-spacing: 0.2px;
  margin-top: 1px;
}

#nx-close-btn {
  background: none;
  border: none;
  color: var(--nx-text-muted);
  cursor: pointer;
  padding: 5px 6px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1;
  transition: color 0.15s, background 0.15s;
}

#nx-close-btn:hover {
  color: var(--nx-text);
  background: rgba(255, 255, 255, 0.06);
}

/* ─── Suggestion Chips ──────────────────────────────────────────────────── */

#nx-chips {
  display: flex;
  gap: 6px;
  padding: 9px 14px;
  overflow-x: auto;
  flex-shrink: 0;
  border-bottom: 1px solid var(--nx-border);
  scrollbar-width: none;
  -ms-overflow-style: none;
}

#nx-chips::-webkit-scrollbar {
  display: none;
}

#nx-chips.nx-hidden {
  display: none;
}

.nx-chip {
  padding: 5px 11px;
  border-radius: 20px;
  border: 1px solid var(--nx-border);
  background: rgba(100, 108, 255, 0.07);
  color: var(--nx-accent-2);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  font-family: var(--nx-font);
  transition: background 0.2s, border-color 0.2s, transform 0.15s;
}

.nx-chip:hover {
  background: rgba(100, 108, 255, 0.18);
  border-color: rgba(100, 108, 255, 0.45);
  transform: scale(1.04);
}

.nx-chip:active {
  transform: scale(0.97);
}

/* ─── Messages ──────────────────────────────────────────────────────────── */

#nx-messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: thin;
  scrollbar-color: rgba(100, 108, 255, 0.15) transparent;
}

#nx-messages::-webkit-scrollbar       { width: 3px; }
#nx-messages::-webkit-scrollbar-track { background: transparent; }
#nx-messages::-webkit-scrollbar-thumb { background: rgba(100, 108, 255, 0.2); border-radius: 3px; }

/* Empty state */
.nx-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 10px;
  text-align: center;
  padding: 20px;
  pointer-events: none;
}

/* CSS-drawn avatar — no images */
.nx-avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1px solid var(--nx-border);
  background: linear-gradient(145deg, rgba(100, 108, 255, 0.15), rgba(167, 139, 250, 0.1));
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
}

/* Avatar head */
.nx-avatar::before {
  content: '';
  position: absolute;
  top: 9px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(167, 139, 250, 0.3);
}

/* Avatar shoulders */
.nx-avatar::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%);
  width: 42px;
  height: 22px;
  border-radius: 50% 50% 0 0;
  background: rgba(100, 108, 255, 0.2);
}

.nx-empty-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--nx-text);
  letter-spacing: 0.5px;
}

.nx-empty-sub {
  font-size: 11px;
  color: var(--nx-text-muted);
  line-height: 1.5;
  max-width: 220px;
}

/* Message wrapper */
.nx-message {
  display: flex;
  flex-direction: column;
  max-width: 86%;
  animation: nx-fade-up 0.28s ease forwards;
}

.nx-message.nx-bot  { align-self: flex-start; align-items: flex-start; }
.nx-message.nx-user { align-self: flex-end;   align-items: flex-end;   }

/* Bubble */
.nx-bubble {
  padding: 9px 13px;
  font-size: 13px;
  line-height: 1.57;
  color: var(--nx-text);
  word-wrap: break-word;
  white-space: pre-wrap;
}

.nx-bot .nx-bubble {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--nx-border);
  border-left: 3px solid var(--nx-accent);
  border-radius: 4px 12px 12px 4px;
}

.nx-user .nx-bubble {
  background: linear-gradient(135deg, var(--nx-accent) 0%, #818cf8 100%);
  border-radius: 12px 4px 4px 12px;
}

/* Error bubble */
.nx-message.nx-error .nx-bubble {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-left: 3px solid var(--nx-red);
  border-radius: 4px 12px 12px 4px;
  color: #fca5a5;
}

.nx-timestamp {
  font-size: 10px;
  color: var(--nx-text-muted);
  margin-top: 3px;
  padding: 0 3px;
}

.nx-retry-btn {
  margin-top: 5px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #fca5a5;
  font-size: 11px;
  cursor: pointer;
  font-family: var(--nx-font);
  transition: background 0.15s;
}

.nx-retry-btn:hover { background: rgba(239, 68, 68, 0.22); }

/* ─── Typing Indicator ──────────────────────────────────────────────────── */

.nx-typing-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--nx-border);
  border-left: 3px solid var(--nx-accent);
  border-radius: 4px 12px 12px 4px;
  align-self: flex-start;
  animation: nx-fade-up 0.28s ease forwards;
}

.nx-typing-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--nx-accent-2);
  animation: nx-bounce-dot 1.2s ease-in-out infinite;
}

.nx-typing-dot:nth-child(2) { animation-delay: 0.2s; }
.nx-typing-dot:nth-child(3) { animation-delay: 0.4s; }

/* ─── Input Area ────────────────────────────────────────────────────────── */

#nx-input-area {
  padding: 10px 12px 12px;
  border-top: 1px solid var(--nx-border);
  display: flex;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.18);
}

#nx-textarea {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--nx-border);
  border-radius: 10px;
  color: var(--nx-text);
  font-family: var(--nx-font);
  font-size: 13px;
  line-height: 1.5;
  padding: 8px 11px;
  resize: none;
  outline: none;
  min-height: 36px;
  max-height: 100px;
  overflow-y: auto;
  transition: border-color 0.2s;
  scrollbar-width: none;
}

#nx-textarea::-webkit-scrollbar { display: none; }

#nx-textarea::placeholder { color: var(--nx-text-muted); }

#nx-textarea:focus { border-color: rgba(100, 108, 255, 0.45); }

.nx-input-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

#nx-send-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--nx-accent);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
  padding: 0;
}

#nx-send-btn:hover:not(:disabled) {
  background: var(--nx-accent-2);
  box-shadow: 0 0 14px rgba(100, 108, 255, 0.5);
  transform: scale(1.06);
}

#nx-send-btn:active:not(:disabled) { transform: scale(0.95); }

#nx-send-btn:disabled {
  background: rgba(100, 108, 255, 0.25);
  cursor: not-allowed;
}

#nx-send-btn svg {
  width: 14px;
  height: 14px;
  fill: white;
  pointer-events: none;
}

/* Character arc progress */
#nx-char-arc {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.2s;
}

#nx-char-arc.nx-visible { opacity: 1; }

#nx-char-arc circle {
  transition: stroke-dashoffset 0.15s ease, stroke 0.15s ease;
}

/* ─── Mobile: Bottom Sheet ──────────────────────────────────────────────── */

@media (max-width: 480px) {
  #nx-panel {
    bottom: 0;
    right: 0;
    left: 0;
    width: 100%;
    height: 88vh;
    border-radius: 20px 20px 0 0;
    transform-origin: bottom center;
  }

  #nx-drag-handle {
    display: flex;
  }

  #nx-launcher {
    bottom: 20px;
    right: 20px;
  }
}
```

- [ ] **Step 2: Visually verify the CSS loaded correctly**

Open `http://localhost:3000/nexus.css` in your browser.

Expected: the raw CSS content is returned with no 404 error.

- [ ] **Step 3: Add the message-arrival ripple animation**

Add these lines to `public/nexus.css` after the existing `@keyframes` block:

```css
@keyframes nx-arrive-ripple {
  0%   { box-shadow: var(--nx-shadow), 0 0 0 0   rgba(100, 108, 255, 0.1); }
  60%  { box-shadow: var(--nx-shadow), 0 0 0 10px rgba(100, 108, 255, 0);  }
  100% { box-shadow: var(--nx-shadow); }
}

#nx-panel.nx-arrived {
  animation: nx-arrive-ripple 0.55s ease forwards;
}
```

- [ ] **Step 4: Commit**

```bash
git add public/nexus.css
git commit -m "feat: add NEXUS stylesheet — glassmorphism, animations, mobile bottom sheet"
```

---

## Task 4: Frontend Logic (`public/nexus.js`)

**Files:**
- Create: `public/nexus.js`

- [ ] **Step 1: Create `public/nexus.js` with the complete implementation**

```javascript
/**
 * NEXUS Chatbot — Vanilla ES2022+
 * All UI logic for the NEXUS chatbot widget.
 * Injected into manickavasan.com via a <script defer> tag.
 */
(function () {
  'use strict';

  const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  /**
   * Derive the API base URL from this script's own src attribute.
   * Works cross-domain: the script is hosted on the Vercel deployment but
   * runs in the context of the portfolio page.
   */
  const scriptEl =
    document.currentScript ||
    document.querySelector('script[src*="nexus.js"]');
  const API_BASE = scriptEl ? new URL(scriptEl.src).origin : '';
  const API_URL  = `${API_BASE}/api/chat`;

  const CHIPS = ["What's his stack?", 'Is he available?', 'Show me his projects'];

  /** SVG arc circumference: 2 * Math.PI * r(8) ≈ 50.27 */
  const ARC_CIRCUMFERENCE = 50.27;

  class NexusChatbot {
    #isOpen           = false;
    #history          = [];
    #isStreaming      = false;
    #chipsHidden      = false;
    #lastUserMessage  = null;
    #touchStartY      = 0;

    constructor() {
      this.#injectDOM();
      this.#bindEvents();
      this.#startTimestampUpdater();
    }

    /** Build and inject all DOM elements into document.body */
    #injectDOM() {
      this.launcher = document.createElement('button');
      this.launcher.id = 'nx-launcher';
      this.launcher.setAttribute('aria-label', 'Open NEXUS AI assistant');
      this.launcher.setAttribute('aria-expanded', 'false');
      this.launcher.textContent = 'NEXUS ✦';

      this.panel = document.createElement('div');
      this.panel.id = 'nx-panel';
      this.panel.classList.add('nx-hidden');
      this.panel.setAttribute('role', 'dialog');
      this.panel.setAttribute('aria-modal', 'true');
      this.panel.setAttribute('aria-label', 'NEXUS AI assistant');

      this.panel.innerHTML = `
        <div id="nx-drag-handle" aria-hidden="true">
          <div class="nx-drag-bar"></div>
        </div>
        <div id="nx-header">
          <div class="nx-header-left">
            <div class="nx-status-dot" aria-hidden="true"></div>
            <div>
              <div class="nx-title">NEXUS</div>
              <div class="nx-subtitle">Ask me about Vasan</div>
            </div>
          </div>
          <button id="nx-close-btn" aria-label="Close NEXUS">&#x2715;</button>
        </div>
        <div id="nx-chips" role="group" aria-label="Suggested questions">
          ${CHIPS.map(c => `<button class="nx-chip">${c}</button>`).join('')}
        </div>
        <div id="nx-messages" role="log" aria-live="polite" aria-label="Conversation">
          ${this.#emptyStateHTML()}
        </div>
        <div id="nx-input-area">
          <textarea
            id="nx-textarea"
            placeholder="Ask about Vasan…"
            rows="1"
            maxlength="200"
            aria-label="Your message"
          ></textarea>
          <div class="nx-input-controls">
            <button id="nx-send-btn" aria-label="Send">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
            <svg id="nx-char-arc" viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="8" fill="none"
                stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
              <circle id="nx-char-progress" cx="10" cy="10" r="8"
                fill="none" stroke="#646cff" stroke-width="2"
                stroke-linecap="round"
                stroke-dasharray="${ARC_CIRCUMFERENCE}"
                stroke-dashoffset="${ARC_CIRCUMFERENCE}"
                transform="rotate(-90 10 10)"/>
            </svg>
          </div>
        </div>
      `;

      document.body.appendChild(this.launcher);
      document.body.appendChild(this.panel);

      this.$messages     = this.panel.querySelector('#nx-messages');
      this.$textarea     = this.panel.querySelector('#nx-textarea');
      this.$sendBtn      = this.panel.querySelector('#nx-send-btn');
      this.$chips        = this.panel.querySelector('#nx-chips');
      this.$charArc      = this.panel.querySelector('#nx-char-arc');
      this.$charProgress = this.panel.querySelector('#nx-char-progress');
    }

    /** @returns {string} Empty state HTML */
    #emptyStateHTML() {
      return `
        <div class="nx-empty-state" aria-hidden="true">
          <div class="nx-avatar"></div>
          <div class="nx-empty-title">Hi, I'm NEXUS</div>
          <div class="nx-empty-sub">Vasan's personal AI. Ask me anything about him.</div>
        </div>
      `;
    }

    /** Attach all DOM event listeners */
    #bindEvents() {
      this.launcher.addEventListener('click', () => this.toggle());

      this.panel.querySelector('#nx-close-btn')
        .addEventListener('click', () => this.close());

      this.$textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.#submit();
        }
      });

      this.$textarea.addEventListener('input', () => {
        this.#autoResize();
        this.#updateCharArc();
      });

      this.$sendBtn.addEventListener('click', () => this.#submit());

      this.$chips.querySelectorAll('.nx-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          this.$textarea.value = chip.textContent;
          this.#submit();
        });
      });

      // Mobile swipe-down-to-close on drag handle
      const handle = this.panel.querySelector('#nx-drag-handle');
      handle.addEventListener('touchstart', (e) => {
        this.#touchStartY = e.touches[0].clientY;
      }, { passive: true });
      handle.addEventListener('touchend', (e) => {
        const delta = e.changedTouches[0].clientY - this.#touchStartY;
        if (delta > 60) this.close();
      }, { passive: true });

      // Click outside panel closes it
      document.addEventListener('click', (e) => {
        if (
          this.#isOpen &&
          !this.panel.contains(e.target) &&
          e.target !== this.launcher
        ) {
          this.close();
        }
      });
    }

    /** Toggle open/close */
    toggle() {
      this.#isOpen ? this.close() : this.open();
    }

    /** Open the chat panel */
    open() {
      this.#isOpen = true;
      this.panel.classList.remove('nx-hidden');
      this.launcher.setAttribute('aria-expanded', 'true');

      // Re-trigger spring animation each open
      this.panel.style.animation = 'none';
      void this.panel.offsetWidth; // force reflow
      this.panel.style.animation = '';

      requestAnimationFrame(() => {
        setTimeout(() => this.$textarea.focus(), 350);
      });
    }

    /** Close the chat panel */
    close() {
      this.#isOpen = false;
      this.panel.classList.add('nx-hidden');
      this.launcher.setAttribute('aria-expanded', 'false');
    }

    /** Auto-resize textarea to fit content, capped at 100px */
    #autoResize() {
      this.$textarea.style.height = 'auto';
      this.$textarea.style.height = `${Math.min(this.$textarea.scrollHeight, 100)}px`;
    }

    /** Update SVG arc to reflect character usage (0–200) */
    #updateCharArc() {
      const len = this.$textarea.value.length;
      const ratio = len / 200;
      const offset = ARC_CIRCUMFERENCE - ratio * ARC_CIRCUMFERENCE;
      this.$charProgress.style.strokeDashoffset = offset;

      if (len > 180) {
        this.$charProgress.style.stroke = '#ef4444';
      } else if (len > 150) {
        this.$charProgress.style.stroke = '#f59e0b';
      } else {
        this.$charProgress.style.stroke = '#646cff';
      }

      // Show arc only after user starts typing
      this.$charArc.classList.toggle('nx-visible', len > 0);
    }

    /** Remove the empty-state placeholder on first message */
    #removeEmptyState() {
      this.$messages.querySelector('.nx-empty-state')?.remove();
    }

    /** Hide suggestion chips after first interaction */
    #hideChips() {
      if (!this.#chipsHidden) {
        this.#chipsHidden = true;
        this.$chips.classList.add('nx-hidden');
      }
    }

    /**
     * Append a message bubble to the conversation.
     * @param {'bot'|'user'|'error'} role
     * @param {string} [text='']
     * @returns {HTMLElement} The inner `.nx-bubble` element
     */
    #appendMessage(role, text = '') {
      this.#removeEmptyState();

      const wrap = document.createElement('div');
      wrap.classList.add('nx-message', `nx-${role}`);

      const bubble = document.createElement('div');
      bubble.classList.add('nx-bubble');
      bubble.textContent = text;

      const ts = document.createElement('div');
      ts.classList.add('nx-timestamp');
      ts.dataset.time = String(Date.now());
      ts.textContent = 'just now';

      wrap.appendChild(bubble);
      wrap.appendChild(ts);

      if (role === 'error') {
        const retry = document.createElement('button');
        retry.classList.add('nx-retry-btn');
        retry.textContent = '↺ Retry';
        retry.addEventListener('click', () => {
          wrap.remove();
          if (this.#lastUserMessage) {
            this.$textarea.value = this.#lastUserMessage;
            this.#submit();
          }
        });
        wrap.appendChild(retry);
      }

      this.$messages.appendChild(wrap);
      this.#scrollToBottom();

      // Trigger barely-visible arrival ripple on the panel
      this.panel.classList.remove('nx-arrived');
      void this.panel.offsetWidth; // force reflow to restart animation
      this.panel.classList.add('nx-arrived');
      setTimeout(() => this.panel.classList.remove('nx-arrived'), 600);

      return bubble;
    }

    /** Show animated three-dot typing indicator */
    #showTyping() {
      const el = document.createElement('div');
      el.id = 'nx-typing';
      el.classList.add('nx-typing-indicator');
      el.innerHTML = `
        <div class="nx-typing-dot"></div>
        <div class="nx-typing-dot"></div>
        <div class="nx-typing-dot"></div>
      `;
      this.$messages.appendChild(el);
      this.#scrollToBottom();
      return el;
    }

    /** Scroll messages list to the bottom */
    #scrollToBottom() {
      this.$messages.scrollTop = this.$messages.scrollHeight;
    }

    /**
     * Update all timestamps in the conversation relative to now.
     * Runs on a 30-second interval.
     */
    #startTimestampUpdater() {
      setInterval(() => {
        this.$messages?.querySelectorAll('.nx-timestamp[data-time]').forEach((el) => {
          const elapsed = Date.now() - parseInt(el.dataset.time, 10);
          if (elapsed < 60_000) {
            el.textContent = 'just now';
          } else if (elapsed < 3_600_000) {
            el.textContent = `${Math.floor(elapsed / 60_000)} min ago`;
          } else {
            el.textContent = `${Math.floor(elapsed / 3_600_000)}h ago`;
          }
        });
      }, 30_000);
    }

    /** Read textarea, validate, then fire the streaming request */
    async #submit() {
      const text = this.$textarea.value.trim();
      if (!text || this.#isStreaming) return;

      this.#isStreaming     = true;
      this.#lastUserMessage = text;
      this.$sendBtn.disabled = true;
      this.$textarea.value   = '';
      this.$textarea.style.height = 'auto';
      this.#updateCharArc();
      this.#hideChips();

      this.#appendMessage('user', text);
      const typingEl = this.#showTyping();
      this.panel.classList.add('nx-typing');

      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history: this.#history.slice(-6)
          })
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
          throw new Error(body.error?.message || `Request failed with status ${res.status}`);
        }

        typingEl.remove();
        const botBubble = this.#appendMessage('bot', '');
        let fullText = '';

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]')  break;
            if (payload === '[ERROR]') throw new Error('The AI stream encountered an error. Please try again.');

            try {
              const { token } = JSON.parse(payload);
              if (token) {
                fullText += token;
                botBubble.textContent = fullText;
                this.#scrollToBottom();
              }
            } catch {
              // Skip malformed SSE chunks
            }
          }
        }

        // Keep last 12 messages (6 turns) in history
        this.#history.push(
          { role: 'user',      content: text },
          { role: 'assistant', content: fullText }
        );
        if (this.#history.length > 12) {
          this.#history = this.#history.slice(-12);
        }

      } catch (err) {
        typingEl.remove();

        // Clean up any empty bot bubble created before the error
        this.$messages.querySelectorAll('.nx-bot .nx-bubble').forEach((b) => {
          if (!b.textContent.trim()) b.closest('.nx-message')?.remove();
        });

        this.#appendMessage('error', err.message || 'Something went wrong. Please try again.');
        if (isDev) console.error('[NEXUS]', err);

      } finally {
        this.#isStreaming      = false;
        this.$sendBtn.disabled = false;
        this.panel.classList.remove('nx-typing');
        this.$textarea.focus();
      }
    }
  }

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new NexusChatbot());
  } else {
    new NexusChatbot();
  }

})();
```

- [ ] **Step 2: Open the test page in a browser**

Create a temporary `public/test.html` file:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NEXUS Test</title>
  <style>
    body { background: #020617; color: white; font-family: Inter, sans-serif;
           min-height: 100vh; display: flex; align-items: center;
           justify-content: center; margin: 0; }
    h1 { opacity: 0.4; font-size: 14px; letter-spacing: 2px; }
  </style>
</head>
<body>
  <h1>NEXUS TEST PAGE</h1>
  <link rel="stylesheet" href="/nexus.css">
  <script src="/nexus.js" defer></script>
</body>
</html>
```

Open `http://localhost:3000/test.html` in Chrome.

Expected:
- The "NEXUS ✦" pill button appears bottom-right with a rotating gradient border
- Clicking it opens the glass panel with a spring animation
- The header shows "NEXUS" with a pulsing green dot
- Chips "What's his stack?", "Is he available?", "Show me his projects" are visible
- Typing a message and pressing Enter sends it; typing indicator (three dots) shows then transitions to streaming text
- Error state: temporarily break the API URL in nexus.js to `API_URL + 'x'` and send a message — red bubble with ↺ Retry should appear

- [ ] **Step 3: Delete the temporary test file**

```bash
rm public/test.html
```

- [ ] **Step 4: Verify mobile layout**

In Chrome DevTools, enable responsive mode and set viewport to 375×812 (iPhone 14).

Expected:
- Panel takes full-screen bottom sheet style
- Drag handle bar is visible at the top
- Dragging down by 60px+ closes the panel

- [ ] **Step 5: Commit**

```bash
git add public/nexus.js
git commit -m "feat: add NEXUS frontend — streaming UI, glassmorphism, mobile bottom sheet"
```

---

## Task 5: End-to-End Verification + Integration Snippet

**Files:**
- No new files — verification only, then provide the integration snippet

- [ ] **Step 1: Full conversation test**

With `vercel dev` running, open `http://localhost:3000/test.html` (recreate it temporarily from Task 4 Step 2).

Send these messages in order:
1. `"Who is Vasan?"` — expect a streaming bio response
2. `"What's his stack?"` — expect a tech stack list (also test the chip version: click the chip)
3. `"What's 2+2?"` — expect NEXUS to redirect politely rather than answer math
4. Verify suggestion chips disappear after the first message is sent
5. Verify timestamps show "just now" then update to "1 min ago" after ~60 seconds

- [ ] **Step 2: Verify API key is never in the browser**

In Chrome DevTools → Network → filter for `api/chat`:
- Request payload should contain `{ message, history }` — no API key
- Response headers should show `content-type: text/event-stream`
- The actual `GROQ_API_KEY` value must not appear anywhere in Network tab

- [ ] **Step 3: Final commit**

```bash
rm public/test.html
git add -A
git commit -m "chore: remove test file — NEXUS verified end-to-end"
```

- [ ] **Step 4: Deploy to Vercel**

```bash
vercel --prod
```

Vercel will output a production URL like `https://nexus-chatbot-xxxx.vercel.app`.

Set environment variables in the Vercel dashboard:
- `GROQ_API_KEY` → your actual key
- `NEXUS_KNOWLEDGE` → your full professional bio

- [ ] **Step 5: Add the integration snippet to your portfolio**

In your portfolio repo (`manickavasan-portfolio`), open `index.html` and add these three lines before `</body>`:

```html
<link rel="stylesheet" href="https://YOUR-VERCEL-URL.vercel.app/nexus.css">
<script src="https://YOUR-VERCEL-URL.vercel.app/nexus.js" defer></script>
<!-- NEXUS — AI assistant by Vasan -->
```

Replace `YOUR-VERCEL-URL` with the actual URL from Step 4.

- [ ] **Step 6: Smoke-test on live portfolio**

Open `https://manickavasan.com` after deploying the portfolio changes.

Expected:
- "NEXUS ✦" pill button appears bottom-right
- Fonts match (Inter)
- Dark glass panel fits the portfolio's dark `#020617` background
- Streaming works on the live domain (CORS allows `https://manickavasan.com`)

---

## Final Checklist

- [ ] API key never appears in browser Network tab
- [ ] Streaming: text appears word-by-word in bot bubble
- [ ] Typing indicator (3 dots) shows until first token arrives, then disappears
- [ ] Rate limiting: 21st request from same IP within 1 hour returns 429
- [ ] Suggestion chips disappear after first message sent
- [ ] Error bubble is red with ↺ Retry button that re-sends the last message
- [ ] Mobile: full-screen bottom sheet with drag-to-close ≥ 60px
- [ ] All animations are CSS-only (no JS `setInterval` animation loops)
- [ ] Character arc shows and turns amber at 150, red at 180
- [ ] `.env` is not committed (verify with `git log --all -- .env`)
