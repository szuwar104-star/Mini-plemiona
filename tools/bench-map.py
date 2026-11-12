#!/usr/bin/env python3
"""Benchmark płynności mapy: python3 tools/bench-map.py [--moves 500] [--world huge] [--label nazwa]

Uruchamia grę w prawdziwej przeglądarce (Chrome przez Playwright), tworzy świat, dokłada setki marszów
wojsk i mierzy czas klatek podczas bezczynności, przesuwania i zbliżania mapy oraz koszt przejęcia wioski
(przerysowanie terytoriów). Wynik: średnia i percentyle czasu klatki, liczba klatek > 33 ms i najdłuższe zadania.
"""
import argparse, json, os, subprocess, sys, time, socket
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SETUP = """
([moves, world]) => {
  const E = MP.Engine, G = MP.Game;
  G.state = E.newGame(Date.now(), 987654321, 'normal', world);
  const s = G.state;
  // gracz dostaje ~40 wiosek (różne punkty startu marszów)
  const vs = Object.values(s.villages);
  let r = 12345; const rnd = () => (r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296;
  vs.filter(v => v.owner !== 'player').sort(() => rnd() - .5).slice(0, 40).forEach(v => { v.owner = 'player'; });
  const mine = vs.filter(v => v.owner === 'player'), others = vs.filter(v => v.owner !== 'player');
  const now = G.clock(); s.now = now;
  const types = ['attack', 'attack', 'attack', 'return', 'support', 'transport', 'spy', 'settle'];
  for (let i = 0; i < moves; i++) {
    const from = mine[(rnd() * mine.length) | 0], to = others[(rnd() * others.length) | 0];
    const dur = 600000 + rnd() * 3000000;                       // 10–60 min, nic nie dojdzie w czasie testu
    const start = now - rnd() * dur * .8;
    let t = types[(rnd() * types.length) | 0], owner = 'player', f = from, d = to;
    if (rnd() < .12) { t = 'attack'; owner = 'ai1'; f = to; d = from; }   // ataki wroga na gracza
    s.movements.push({ id: 'bm' + i, type: t, owner, from: f.id, to: d.id, start, arrive: start + dur, units: { axe: 10 }, merchants: 1, x: d.x, y: d.y });
  }
  s.created = Date.now();
  MP.Map.reset(); MP.UI.invalidate(); MP.UI.show('map');
  return Object.keys(s.villages).length + ' wiosek, ' + s.movements.length + ' marszów';
}
"""

MEASURE = """
async ([kind, ms]) => {
  const frames = [], longs = [];
  const po = new PerformanceObserver(l => l.getEntries().forEach(e => longs.push(e.duration)));
  try { po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
  const M = MP.Map, v = M.view;
  const t0 = performance.now(); let last = t0, i = 0, dir = 1;
  await new Promise(done => {
    function f(t) {
      frames.push(t - last); last = t; i++;
      if (kind === 'pan') { v.x += Math.sin(i / 25) * 14; v.y += Math.cos(i / 31) * 10; M.clamp(); M.apply(); }
      if (kind === 'zoom') { M.zoomBy(dir > 0 ? 1.03 : 1 / 1.03); if (v.s > 2.4) dir = -1; if (v.s < 0.5) dir = 1; }
      if (t - t0 < ms) requestAnimationFrame(f); else done();
    }
    requestAnimationFrame(f);
  });
  po.disconnect();
  frames.shift();
  const sorted = frames.slice().sort((a, b) => a - b), q = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { frames: frames.length, avg: frames.reduce((a, b) => a + b, 0) / frames.length, p50: q(.5), p95: q(.95), p99: q(.99), max: sorted[sorted.length - 1],
    slow33: frames.filter(x => x > 33.4).length, longtasks: longs.length, longMax: Math.max(0, ...longs) };
}
"""

CONQUER = """
() => {
  const s = MP.Game.state, E = MP.Engine;
  const ai = Object.values(s.villages).find(v => v.owner && v.owner !== 'player');
  const t0 = performance.now();
  ai.owner = 'player';
  MP.UI.invalidate(); MP.UI.render();
  return performance.now() - t0;
}
"""

TICK = """
() => {
  const G = MP.Game, n = 20, t0 = performance.now();
  for (let i = 0; i < n; i++) G.tick(false);
  return (performance.now() - t0) / n;
}
"""


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--moves', type=int, default=500)
    ap.add_argument('--world', default='huge')
    ap.add_argument('--label', default='')
    ap.add_argument('--ms', type=int, default=4000)
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    port = free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    out = {}
    try:
        with sync_playwright() as p:
            try:
                br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
            except Exception:
                br = p.chromium.launch(args=['--no-sandbox'])
            ctx = br.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
            pg = ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(f'http://127.0.0.1:{port}/index.html')
            pg.wait_for_function('window.MP && MP.Game && MP.Game.state && !document.body.classList.contains("loading")', timeout=30000)
            out['setup'] = pg.evaluate(SETUP, [a.moves, a.world])
            pg.wait_for_timeout(1500)
            out['tick_ms'] = round(pg.evaluate(TICK), 2)
            for kind in ('idle', 'pan', 'zoom'):
                out[kind] = {k: round(v, 2) for k, v in pg.evaluate(MEASURE, [kind, a.ms]).items()}
            out['conquer_render_ms'] = round(pg.evaluate(CONQUER), 1)
            out['errors'] = errs
            br.close()
    finally:
        srv.terminate()
    if a.json:
        print(json.dumps(out))
        return
    print(f"== {a.label or 'bench'}: {out['setup']} (świat {a.world}) ==")
    print(f"tick gry (advance+render): {out['tick_ms']} ms,  przejęcie wioski → render: {out['conquer_render_ms']} ms")
    print(f"{'scenariusz':10} {'klatek':>6} {'śr ms':>7} {'p50':>6} {'p95':>6} {'p99':>6} {'max':>7} {'>33ms':>6} {'longtask':>8}")
    for k in ('idle', 'pan', 'zoom'):
        r = out[k]
        print(f"{k:10} {r['frames']:6.0f} {r['avg']:7.1f} {r['p50']:6.1f} {r['p95']:6.1f} {r['p99']:6.1f} {r['max']:7.1f} {r['slow33']:6.0f} {r['longtasks']:8.0f}")
    if out['errors']:
        print('BŁĘDY STRONY:', out['errors'])


main()
