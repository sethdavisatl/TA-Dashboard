// Proxy for the dashboard chat assistant. Keeps the Anthropic API key server side.
// Everything except /api/chat is served as static assets (run_worker_first limits the Worker to /api/*).
const MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = 600;
const MAX_BODY_BYTES = 600000;   // trimmed dashboard data is ~170 KB; this blocks oversized or abusive payloads
const MAX_TURNS = 12;

const json = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);
      if (!env.ANTHROPIC_API_KEY) return json({ error: { message: 'Chat is not configured yet.' } }, 503);

      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return json({ error: { message: 'Request too large' } }, 413);

      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: { message: 'Bad request' } }, 400); }

      const { system, messages } = body || {};
      const okMsgs = Array.isArray(messages) && messages.length > 0 &&
        messages.every(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
      if (typeof system !== 'string' || !okMsgs) return json({ error: { message: 'Bad request' } }, 400);

      let turns = messages.slice(-MAX_TURNS);
      while (turns.length > 1 && turns[0].role !== 'user') turns = turns.slice(1);

      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: turns,
        }),
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
