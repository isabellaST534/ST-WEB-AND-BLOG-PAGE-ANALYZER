import { lookup } from 'node:dns/promises';
import net from 'node:net';
const UA = 'Mozilla/5.0 (compatible; PageAnalyzer/1.0)';
const priv = ip => {
  if (net.isIPv6(ip)) return ip === '::' || /^(::1$|fc|fd|fe80|::ffff:(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01])))/i.test(ip);
  const p = ip.split('.').map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
};
async function safe(u) {
  const x = new URL(u);
  if (!/^https?:$/.test(x.protocol)) throw new Error('Only http and https URLs are allowed.');
  const a = await lookup(x.hostname, { all: true });
  if (!a.length || a.some(r => priv(r.address))) throw new Error('That address is not allowed.');
}
async function get(u, ms = 12000) {
  let cur = u;
  for (let i = 0; i < 5; i++) {
    await safe(cur);
    const r = await fetch(cur, { redirect: 'manual', signal: AbortSignal.timeout(ms), headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { cur = new URL(r.headers.get('location'), cur).href; continue; }
    return { r, url: cur };
  }
  throw new Error('Too many redirects.');
}
export default async (req) => {
  const code = process.env.ACCESS_CODE;
  if (code && req.headers.get('x-access-code') !== code) return Response.json({ error: 'Access code required.' }, { status: 401 });
  try {
    let { url } = await req.json();
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const { r, url: final } = await get(url);
    if (!r.ok) return Response.json({ ok: false, code: r.status, url: final });
    const html = (await r.text()).slice(0, 700000);
    const base = new URL(final).origin;
    const opt = async p => {
      try {
        const x = await get(base + p, 6000);
        if (!x.r.ok) return null;
        const t = (await x.r.text()).slice(0, 50000);
        return t.trim().startsWith('<') ? null : t;
      } catch { return null; }
    };
    const [robots, llms, sm] = await Promise.all([opt('/robots.txt'), opt('/llms.txt'), opt('/sitemap.xml')]);
    return Response.json({ ok: true, url: final, html, robots, llms, sitemap: !!sm });
  } catch (e) {
    return Response.json({ ok: false, error: 'Could not fetch the page: ' + e.message });
  }
};
