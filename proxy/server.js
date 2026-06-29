/* ============================================================
   EAR3301 "Live Assistant" — Anthropic proxy (Render)
   ------------------------------------------------------------
   Holds the secret ANTHROPIC_API_KEY server-side so it is NEVER
   exposed in the public GitHub Pages HTML.

   Endpoint:  POST /chat
   Body:      { messages:[{role,content}], context:{ currentChapter, courseMap } }
   Returns:   { reply: "<assistant text>" }

   Env vars (set in Render dashboard):
     ANTHROPIC_API_KEY   your Anthropic key (required)
     ALLOWED_ORIGIN      https://gomaaarchitect-coder.github.io  (no trailing slash)
     MODEL               claude-sonnet-4-6  (optional override)
     PORT                provided by Render automatically
   ============================================================ */

const express = require('express');
const app = express();
app.use(express.json({ limit: '256kb' }));

const API_KEY        = process.env.ANTHROPIC_API_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://gomaaarchitect-coder.github.io';
const MODEL          = process.env.MODEL || 'claude-sonnet-4-6';
const PORT           = process.env.PORT || 3000;

/* ---------- CORS (locked to the book's origin) ---------- */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------- Rate limiting (protects the shared key) ----------
   In-memory token buckets keyed by IP. Resets if the dyno restarts,
   which is fine for classroom-scale abuse protection.            */
const PER_MIN = 12;          // max requests per IP per minute
const PER_DAY = 250;         // max requests per IP per day
const minBuckets = new Map();
const dayBuckets = new Map();

function hit(map, key, windowMs) {
  const now = Date.now();
  let b = map.get(key);
  if (!b || now - b.start > windowMs) { b = { start: now, n: 0 }; map.set(key, b); }
  b.n++;
  return b.n;
}
function rateLimited(ip) {
  const m = hit(minBuckets, ip, 60 * 1000);
  const d = hit(dayBuckets, ip, 24 * 60 * 60 * 1000);
  return m > PER_MIN || d > PER_DAY;
}
// periodic cleanup so the maps don't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of minBuckets) if (now - b.start > 60 * 1000) minBuckets.delete(k);
  for (const [k, b] of dayBuckets) if (now - b.start > 24 * 60 * 60 * 1000) dayBuckets.delete(k);
}, 5 * 60 * 1000);

/* ---------- Socratic system prompt + grounding ---------- */
function buildSystem(context) {
  const cm = (context && Array.isArray(context.courseMap)) ? context.courseMap : [];
  const mapLines = cm.map(c => `- [[${c.id}]] ${c.title}: ${c.desc || ''}`).join('\n');
  const cur = context && context.currentChapter;
  const curBlock = cur && cur.text
    ? `\n\n## The student is currently reading\n**${cur.title}** (id: ${cur.id})\n"""\n${String(cur.text).slice(0, 7000)}\n"""`
    : '';

  return `You are the **Live Assistant** for EAR3301 "Environmental Design", an architecture course. You help students learn the way this course teaches.

# Your ONE teaching method: the Socratic method
- NEVER give the final answer, the finished calculation, or the model solution outright.
- Lead the student to the answer with short, well-aimed questions, one or two at a time.
- Build on what they say. If they are wrong, don't correct bluntly — ask a question that exposes the gap.
- Praise good reasoning. Keep each reply short (a few sentences). End with a question that moves them one step forward.
- If a student demands "just give me the answer", warmly refuse and offer the next guiding question instead. This is by design.

# Ground every answer in the course material
- Base your reasoning ONLY on this course's content (summarised below and in the page the student is reading). Do not introduce outside frameworks, formulas, or facts that contradict the course.
- This course covers: design concept, biodiversity, sun & solar geometry, orientation, building skin & OTTV, building geometry (SA/V), solar control, daylighting & ADF, natural ventilation.
- If a question falls outside the course, say so briefly and steer back to the relevant chapter.

# Linking to the book (required)
When you point a student to a part of the book, write the reference as a token: [[chId|short label]] — for example [[ch7|Building Skin & OTTV]] or [[ch5|solar geometry]]. The app turns these tokens into clickable links that jump to that chapter. Use the chapter ids from the map below. Add at least one relevant link when it helps the student locate the material.

# Chapter map (ids you may link to)
${mapLines}${curBlock}

Stay in character as a patient Socratic tutor at all times.`;
}

/* ---------- Chat endpoint ---------- */
app.post('/chat', async (req, res) => {
  try {
    if (!API_KEY) return res.status(500).json({ error: 'Server missing ANTHROPIC_API_KEY.' });

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
      .toString().split(',')[0].trim();
    if (rateLimited(ip)) {
      return res.status(429).json({ error: 'You are sending messages too quickly. Please wait a moment and try again.' });
    }

    const { messages, context } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'No messages provided.' });
    }

    // sanitise: keep only role + string content, cap history length and size
    const clean = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
    if (!clean.length || clean[clean.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'Last message must be from the student.' });
    }

    const anthropicReq = {
      model: MODEL,
      max_tokens: 1024,
      system: buildSystem(context),
      messages: clean
    };

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicReq)
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('Anthropic error', r.status, detail);
      return res.status(502).json({ error: 'The assistant is unavailable right now. Please try again shortly.' });
    }

    const data = await r.json();
    const reply = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim() || '…';

    res.json({ reply });
  } catch (err) {
    console.error('Proxy error', err);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
});

app.get('/', (_req, res) => res.send('EAR3301 Live Assistant proxy is running.'));

app.listen(PORT, () => console.log(`Live Assistant proxy listening on ${PORT}, model ${MODEL}`));
