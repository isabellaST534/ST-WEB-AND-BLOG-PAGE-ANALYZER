import { getStore } from '@netlify/blobs';

// Tries free AI providers in order: Groq, Cerebras, Gemini, Mistral, Cloudflare, SambaNova, NVIDIA (free keys), then OpenRouter free models.
// Providers without a key are skipped. OpenRouter models are used only if listed at price 0.
const PREF = [/llama-3\.3-70b/, /gpt-oss-120b/, /gpt-oss/, /llama-4/, /deepseek/, /qwen/, /kimi/, /gemma/, /mistral/, /llama/, /glm/, /nemotron/];
const TRUSTED = /^(meta-llama|deepseek|qwen|google|mistralai|openai|nvidia|z-ai|moonshotai|nousresearch|microsoft)\//;
const BAD = /r1|thinking|reason|vision|\bvl\b|coder|guard|embed|whisper|tts|orpheus|safeguard/i;
const dead = new Map();
const zero = v => v === undefined || v === null || Number(v) === 0;
const isFree = m => m.pricing && m.pricing.prompt !== undefined && m.pricing.completion !== undefined &&
  Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0 && zero(m.pricing.request) && zero(m.pricing.image);

async function list(base, key) {
  const r = await fetch(base + '/models', { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000) });
  return (await r.json()).data || [];
}
const score = (id, ctx = 0) => {
  const i = PREF.findIndex(p => p.test(id));
  let s = (i < 0 ? 0 : (PREF.length - i) * 2) + Math.min(ctx, 128000) / 128000;
  if (BAD.test(id)) s -= 8;
  if (/-(1|2|3|4|7|8)b\b/i.test(id)) s -= 3;
  return s;
};
const freeIds = data => data
  .filter(m => isFree(m) && /text/.test((m.architecture?.output_modalities || ['text']).join()) &&
    /text/.test((m.architecture?.input_modalities || ['text']).join()) && (m.context_length || 0) >= 8000 && TRUSTED.test(m.id))
  .map(m => ({ id: m.id, s: score(m.id, m.context_length) })).sort((a, b) => b.s - a.s).map(x => x.id);

function buildProviders() {
  const E = process.env, P = [];
  if (E.GROQ_API_KEY) {
    const base = 'https://api.groq.com/openai/v1';
    P.push({ name: 'Groq', base, key: E.GROQ_API_KEY, json: true, models: async () =>
      (await list(base, E.GROQ_API_KEY)).map(m => m.id).filter(id => !BAD.test(id)).sort((a, b) => score(b) - score(a)).slice(0, 3) });
  }
  if (E.CEREBRAS_API_KEY) {
    const base = 'https://api.cerebras.ai/v1';
    P.push({ name: 'Cerebras', base, key: E.CEREBRAS_API_KEY, json: true, models: async () =>
      (await list(base, E.CEREBRAS_API_KEY)).map(m => m.id).filter(id => !BAD.test(id)).sort((a, b) => score(b) - score(a)).slice(0, 3) });
  }
  if (E.GEMINI_API_KEY) {
    P.push({ name: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: E.GEMINI_API_KEY, json: true,
      models: async () => ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'] });
  }
  if (E.MISTRAL_API_KEY) {
    P.push({ name: 'Mistral', base: 'https://api.mistral.ai/v1', key: E.MISTRAL_API_KEY, json: true,
      models: async () => ['mistral-small-latest', 'open-mistral-nemo'] });
  }
  if (E.CLOUDFLARE_API_TOKEN && E.CLOUDFLARE_ACCOUNT_ID) {
    P.push({ name: 'Cloudflare', base: 'https://api.cloudflare.com/client/v4/accounts/' + E.CLOUDFLARE_ACCOUNT_ID + '/ai/v1', key: E.CLOUDFLARE_API_TOKEN, json: false,
      models: async () => ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/openai/gpt-oss-120b', '@cf/meta/llama-3.1-8b-instruct'] });
  }
  if (E.SAMBANOVA_API_KEY) {
    const base = 'https://api.sambanova.ai/v1';
    P.push({ name: 'SambaNova', base, key: E.SAMBANOVA_API_KEY, json: false, models: async () =>
      (await list(base, E.SAMBANOVA_API_KEY)).map(m => m.id).filter(id => /llama|gpt-oss|deepseek|qwen/i.test(id) && !BAD.test(id)).sort((a, b) => score(b) - score(a)).slice(0, 3) });
  }
  if (E.NVIDIA_API_KEY) {
    P.push({ name: 'NVIDIA', base: 'https://integrate.api.nvidia.com/v1', key: E.NVIDIA_API_KEY, json: false,
      models: async () => ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-70b-instruct', 'mistralai/mistral-small-3.1-24b-instruct-2503'] });
  }
  const ork = E.AI_API_KEY || E.OPENROUTER_API_KEY;
  const base = (E.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const pinned = (E.AI_MODEL || '').split(',').map(s => s.trim()).filter(Boolean);
  if (ork) {
    if (base.includes('openrouter.ai')) P.push({ name: 'OpenRouter', base, key: ork, json: false, models: async () => {
      const free = freeIds(await list(base, ork));
      return [...pinned.filter(p => free.includes(p)), ...free.filter(m => !pinned.includes(m))].slice(0, 2);
    } });
    else P.push({ name: 'Custom', base, key: ork, json: false, models: async () => pinned });
  }
  return P;
}

// Pulls one JSON object out of a model reply and repairs the usual small mistakes.
function clean(t) {
  t = String(t || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  t = t.slice(a, b + 1).replace(/[\u0000-\u001f]/g, ' ').replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(t); } catch { return null; }
}

async function attempt(p, model, prompt) {
  const body = { model, temperature: 0.2, max_tokens: 2200, messages: [
    { role: 'system', content: 'You are a precise SEO auditor. Reply with one valid JSON object only. No markdown, no commentary. Never put double quotes inside string values; use single quotes instead.' },
    { role: 'user', content: String(prompt).slice(0, 24000) }] };
  if (p.json) body.response_format = { type: 'json_object' };
  if (p.name === 'Gemini' && /2\.5/.test(model)) body.reasoning_effort = 'none';
  const r = await fetch(p.base + '/chat/completions', { method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.key, 'x-title': 'Page Analyzer' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  const t = j.choices?.[0]?.message?.content;
  const o = r.ok && t ? clean(t) : null;
  if (o) return o;
  const raw = j.error?.metadata?.raw ? ': ' + String(j.error.metadata.raw).slice(0, 120) : '';
  throw new Error((j.error?.message || (t ? 'invalid JSON in reply' : 'HTTP ' + r.status)) + raw);
}

async function callAI(prompt, retry = true) {
  const P = buildProviders();
  if (!P.length) throw new Error('No AI key set. Add GROQ_API_KEY (free at console.groq.com/keys) in Netlify environment variables.');
  const errs = []; let tried = 0;
  for (const p of P) {
    let ms = [];
    try { ms = await p.models(); } catch (e) { errs.push(p.name + ': could not list models (' + e.message + ')'); continue; }
    for (const m of ms) {
      const k = p.name + '/' + m;
      if (dead.get(k) > Date.now()) continue;
      tried++;
      try { return { text: JSON.stringify(await attempt(p, m, prompt)), model: k }; }
      catch (e) { errs.push(k + ': ' + e.message); dead.set(k, Date.now() + (/429|rate|quota|limit/i.test(e.message) ? 60000 : 300000)); }
    }
  }
  if (!tried && retry) { dead.clear(); return callAI(prompt, false); }
  throw new Error('Keys found for: ' + P.map(p => p.name).join(', ') + '. All failed. ' + errs.map(e => e.slice(0, 170)).join(' | '));
}

// Background function: runs up to 15 minutes, result is saved for analyze-status to return.
export default async (req) => {
  const store = getStore({ name: 'jobs', consistency: 'strong' });
  let id;
  try {
    const b = await req.json();
    id = b.id;
    const code = process.env.ACCESS_CODE;
    if (code && req.headers.get('x-access-code') !== code) { await store.setJSON(id, { status: 'error', error: 'Access code required. Reload the page and enter it.' }); return; }
    await store.setJSON(id, { status: 'done', ...(await callAI(b.prompt)) });
  } catch (e) {
    if (id) await store.setJSON(id, { status: 'error', error: e.message });
  }
};
