/* Mini Plemiona – synchronizacja zapisu między urządzeniami (Cloudflare Worker + KV).
   Zapis leży w KV (binding SAVES) pod kluczem = SHA-256 z kodu synchronizacji, więc sam kod nie trafia do magazynu.
   GET  /api/save/<kod>            – pobiera zapis (nagłówek X-Saved-At); ?meta=1 zwraca tylko {savedAt}
   PUT  /api/save/<kod>            – wysyła zapis; nagłówek X-Base = savedAt ostatnio zsynchronizowanej wersji,
                                     X-Force: 1 nadpisuje mimo konfliktu (409, gdy w chmurze jest inna wersja)
   Pozostałe ścieżki obsługują statyczne pliki gry (binding ASSETS, patrz wrangler.jsonc). */
const MAX_BYTES = 8 * 1024 * 1024;
const TTL = 365 * 24 * 3600; // każdy zapis odnawia ważność o rok

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

async function keyFor(code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return 'save:' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/api\/save\/([A-Za-z0-9_-]{20,64})$/);
  if (!m) return json({ error: 'not_found' }, 404);
  if (!env.SAVES) return json({ error: 'no_storage' }, 503);
  const key = await keyFor(m[1]);

  if (request.method === 'GET') {
    const { value, metadata } = await env.SAVES.getWithMetadata(key, 'text');
    if (value == null) return json({ error: 'empty' }, 404);
    const savedAt = (metadata && metadata.savedAt) || 0;
    if (url.searchParams.get('meta')) return json({ savedAt });
    return new Response(value, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Saved-At': String(savedAt) }
    });
  }

  if (request.method === 'PUT') {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ error: 'too_large' }, 413);
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return json({ error: 'bad_json' }, 400); }
    if (!obj || obj.app !== 'mini-plemiona' || !obj.state || !Number.isFinite(obj.savedAt)) return json({ error: 'bad_save' }, 400);
    if (request.headers.get('X-Force') !== '1') {
      const cur = await env.SAVES.getWithMetadata(key, 'text');
      if (cur.value != null) {
        const curAt = (cur.metadata && cur.metadata.savedAt) || 0;
        if (curAt !== Number(request.headers.get('X-Base') || 0)) return json({ error: 'conflict', savedAt: curAt }, 409);
      }
    }
    await env.SAVES.put(key, text, { metadata: { savedAt: obj.savedAt }, expirationTtl: TTL });
    return json({ ok: true, savedAt: obj.savedAt });
  }

  return json({ error: 'method' }, 405);
}

export default {
  fetch(request, env) { return handle(request, env); }
};
