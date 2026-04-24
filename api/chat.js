/**
 * NEXUS — /api/chat
 * Vercel serverless function: rate-limiting, CORS, Groq streaming.
 * Knowledge is read exclusively from process.env.NEXUS_KNOWLEDGE.
 */

// NOTE: Stale entries are not actively evicted. On a low-traffic personal
// portfolio, Vercel instance recycling provides adequate cleanup. For
// higher-traffic deployments, add a periodic sweep or use an external store.
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
    let streamDone = false;

    while (true) {
      if (streamDone) break;
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
          streamDone = true;
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
      try { res.write('data: [ERROR]\n\n'); res.end(); } catch { /* client disconnected */ }
    }
  }
}
