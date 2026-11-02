/* ==========================================================================
   The Curse of Knowledge — presentation engine
   1. Sky:    persistent canvas world (stars, nebula, procedural planet).
              Each slide sets a camera target, so slide changes feel like
              one continuous camera move.
   2. Field:  "the pattern" — dots that drift as noise, then lock into a
              sunflower spiral when it "clicks" (slides 5–7).
   3. Deck:   slides, progressive fragments, navigation, HUD.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeIO = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let REDUCED = false; // toggled with M (see body.reduced in styles.css)
  const isPortrait = () => innerHeight > innerWidth;

  function rng(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------------
     Planet: equirectangular noise texture, projected onto a lit sphere.
     ------------------------------------------------------------------------ */
  const Planet = (() => {
    const TW = 768, TH = 384, S = 640;
    const tex = new Uint8ClampedArray(TW * TH * 3);
    const hash = (i, j, s) => { const v = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
    function vnoise(x, y, per, s) {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const x0 = ((xi % per) + per) % per, x1 = (x0 + 1) % per;
      return lerp(lerp(hash(x0, yi, s), hash(x1, yi, s), u), lerp(hash(x0, yi + 1, s), hash(x1, yi + 1, s), u), v);
    }
    function fbm(u, v, s) {
      let a = .5, f = 1, sum = 0, norm = 0;
      for (let o = 0; o < 5; o++) {
        const per = 6 * f;
        sum += a * vnoise(u * per, v * per * .5, per, s + o * 13);
        norm += a; a *= .5; f *= 2;
      }
      return sum / norm;
    }
    for (let y = 0; y < TH; y++) {
      const v = y / TH, pole = Math.abs(v - .5) * 2;
      for (let x = 0; x < TW; x++) {
        const u = x / TW, e = fbm(u, v, 1), c = fbm(u, v, 40);
        let r, g, b;
        if (e > .54) { const k = clamp((e - .54) * 5, 0, 1); r = lerp(104, 196, k); g = lerp(112, 186, k); b = lerp(92, 160, k); }
        else { const k = clamp(e / .54, 0, 1); r = lerp(4, 24, k); g = lerp(18, 62, k); b = lerp(46, 116, k); }
        if (pole > .8) { const k = clamp((pole - .8) * 7, 0, 1); r = lerp(r, 232, k); g = lerp(g, 238, k); b = lerp(b, 244, k); }
        const cl = clamp((c - .5) * 3, 0, .82);
        r = lerp(r, 236, cl); g = lerp(g, 240, cl); b = lerp(b, 246, cl);
        const i = (y * TW + x) * 3; tex[i] = r; tex[i + 1] = g; tex[i + 2] = b;
      }
    }

    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S);
    const N = S * S, tu = new Float32Array(N), tv = new Float32Array(N), sh = new Float32Array(N), al = new Uint8Array(N);
    const L = (() => { const l = [-.55, -.42, .72], m = Math.hypot(...l); return l.map(x => x / m); })();
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const i = py * S + px, nx = (px + .5) / S * 2 - 1, ny = (py + .5) / S * 2 - 1, d = nx * nx + ny * ny;
        if (d >= 1) continue;
        const nz = Math.sqrt(1 - d);
        tu[i] = (Math.atan2(nx, nz) / (2 * Math.PI) + .5) * TW;
        tv[i] = clamp((Math.asin(ny) / Math.PI + .5) * TH, 0, TH - 1.001);
        sh[i] = .035 + 1.08 * smooth(-.12, .65, nx * L[0] + ny * L[1] + nz * L[2]);
        al[i] = Math.round(clamp((1 - Math.sqrt(d)) * S * .5, 0, 1) * 255);
      }
    }
    // Bilinear texture lookup. Rotation is slow, so the sphere is only
    // re-projected when it has turned by a quarter texel.
    let lastOff = -1;
    function render(rot) {
      const off = (rot % 1) * TW;
      if (Math.abs(off - lastOff) < .25) return cv;
      lastOff = off;
      const data = img.data;
      for (let i = 0; i < N; i++) {
        const o = i * 4;
        if (!al[i]) { data[o + 3] = 0; continue; }
        const u = tu[i] + off, x0f = Math.floor(u), fx = u - x0f, y0 = tv[i] | 0, fy = tv[i] - y0;
        const x0 = x0f % TW, x1 = (x0 + 1) % TW, r0 = y0 * TW, r1 = (y0 + 1) * TW;
        const a = (r0 + x0) * 3, b = (r0 + x1) * 3, c = (r1 + x0) * 3, d = (r1 + x1) * 3, s = sh[i];
        for (let ch = 0; ch < 3; ch++) {
          data[o + ch] = s * ((tex[a + ch] * (1 - fx) + tex[b + ch] * fx) * (1 - fy) + (tex[c + ch] * (1 - fx) + tex[d + ch] * fx) * fy);
        }
        data[o + 3] = al[i];
      }
      ctx.putImageData(img, 0, 0);
      return cv;
    }
    return { render };
  })();

  /* ------------------------------------------------------------------------
     Sky: the persistent world behind every slide.
     Camera keys: px/py planet centre (viewport fractions), pr radius
     (fraction of min side), neb nebula, tint red heat, dim darkness.
     ------------------------------------------------------------------------ */
  const CAMS = {
    earth:      { px: .5,  py: .5,  pr: .34 },
    hook:       { px: .72, py: .52, pr: .34, m: { px: .62, py: .8, pr: .3 } },
    glitch:     { px: .5,  py: 1.62, pr: 1.2, dim: .45 },
    curse:      { px: .5,  py: .5,  pr: .16, dim: .45, neb: .2 },
    mechanism:  { px: .1,  py: -.55, pr: .9, dim: .2 },
    clueless:   { px: -.6, py: .5,  pr: .5, dim: .25 },
    click:      { px: -.6, py: .5,  pr: .5, dim: .2, neb: .12 },
    gap:        { px: .5,  py: -1.18, pr: 1.25, dim: .3 },
    irritation: { px: .5,  py: 2.2, pr: 1.2, tint: .85, dim: .3 },
    projection: { px: .5,  py: 2.35, pr: 1.5, dim: .25, warm: .7 },
    paradox:    { px: 1.6, py: .5,  pr: .4, neb: .8, dim: .3 },
    ending: [
      { px: .5, py: .5, pr: .3, dim: .5 },
      { px: .5, py: .5, pr: .012, dim: .1 },
      { px: .5, py: .5, pr: .003, dim: .2 }
    ]
  };
  const CAM_DEFAULT = { px: .5, py: .5, pr: .3, neb: 0, tint: 0, dim: 0, warm: 0 };

  const Sky = (() => {
    const cv = $('#sky'), cx = cv.getContext('2d');
    let W = 0, H = 0, DPR = 1, drift = 0;
    const cam = { ...CAM_DEFAULT, px: 1.5, py: .5, pr: .34 };
    let target = { ...cam };
    const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
    let stars = [];
    const rand = rng(11);

    // nebula, pre-rendered once
    const neb = document.createElement('canvas'); neb.width = 960; neb.height = 600;
    (() => {
      const n = neb.getContext('2d'), r = rng(5);
      n.globalCompositeOperation = 'lighter';
      const cols = ['91,42,134', '255,107,61', '30,111,217', '194,24,91', '255,179,71', '64,196,255'];
      for (let i = 0; i < 46; i++) {
        const x = 480 + (r() - .5) * 760, y = 300 + (r() - .5) * 420, rad = 60 + r() * 220;
        const g = n.createRadialGradient(x, y, 0, x, y, rad);
        const c = cols[(r() * cols.length) | 0];
        g.addColorStop(0, `rgba(${c},${.1 + r() * .16})`); g.addColorStop(1, `rgba(${c},0)`);
        n.fillStyle = g; n.fillRect(0, 0, 960, 600);
      }
      for (let i = 0; i < 900; i++) {
        const x = 480 + (r() - .5) * 900 * r(), y = 300 + (r() - .5) * 560 * r();
        n.fillStyle = `rgba(255,255,255,${.3 + r() * .7})`; n.fillRect(x, y, r() < .1 ? 2 : 1, r() < .1 ? 2 : 1);
      }
    })();

    function resize() {
      DPR = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      cx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const n = Math.round(W * H / 2400);
      stars = Array.from({ length: n }, () => {
        const z = rand();
        return { x: rand(), y: rand(), z, r: .35 + z * z * 1.5, tw: rand() * 6.28, ts: .4 + rand() * 1.8, b: rand() < .15 };
      });
    }

    function set(scene, step) {
      let c = CAMS[scene] || {};
      if (Array.isArray(c)) c = c[Math.min(step, c.length - 1)];
      target = { ...CAM_DEFAULT, ...c, ...(isPortrait() && c.m ? c.m : {}) };
      delete target.m;
    }

    function draw(dt, t) {
      const k = REDUCED ? 1 : 1 - Math.exp(-dt * 1.5);
      for (const key in CAM_DEFAULT) cam[key] += (target[key] - cam[key]) * k;
      mouse.sx += (mouse.x - mouse.sx) * (1 - Math.exp(-dt * 3));
      mouse.sy += (mouse.y - mouse.sy) * (1 - Math.exp(-dt * 3));
      drift += dt * 6;

      cx.fillStyle = '#04060c'; cx.fillRect(0, 0, W, H);

      if (cam.neb > .01) {
        const s = Math.max(W / 960, H / 600) * (1.12 + Math.sin(t * .05) * .04);
        cx.save(); cx.globalAlpha = cam.neb; cx.translate(W / 2 - mouse.sx * 24, H / 2 - mouse.sy * 16); cx.rotate(t * .006);
        cx.drawImage(neb, -480 * s, -300 * s, 960 * s, 600 * s); cx.restore();
      }

      for (const s of stars) {
        let x = (s.x * W + drift * s.z * 1.2 - mouse.sx * s.z * 26) % W; if (x < 0) x += W;
        let y = (s.y * H - mouse.sy * s.z * 18) % H; if (y < 0) y += H;
        const a = (.25 + .75 * s.z) * (.7 + .3 * Math.sin(t * s.ts + s.tw));
        cx.fillStyle = s.b ? `rgba(190,225,255,${a})` : `rgba(255,252,245,${a})`;
        cx.fillRect(x, y, s.r, s.r);
      }

      const M = Math.min(W, H), R = cam.pr * M;
      const X = cam.px * W - mouse.sx * 12, Y = cam.py * H - mouse.sy * 10;
      if (R > .5 && X + R * 1.4 > 0 && X - R * 1.4 < W && Y + R * 1.4 > 0 && Y - R * 1.4 < H) {
        const halo = cx.createRadialGradient(X, Y, R * .92, X, Y, R * 1.4 + 6);
        halo.addColorStop(0, 'rgba(110,185,255,.38)'); halo.addColorStop(1, 'rgba(110,185,255,0)');
        cx.fillStyle = halo; cx.beginPath(); cx.arc(X, Y, R * 1.4 + 6, 0, 6.2832); cx.fill();
        if (R > 4) {
          cx.drawImage(Planet.render(t * .004), X - R, Y - R, R * 2, R * 2);
          const rim = cx.createRadialGradient(X - R * .2, Y - R * .15, R * .7, X, Y, R);
          rim.addColorStop(0, 'rgba(150,210,255,0)'); rim.addColorStop(.86, 'rgba(150,210,255,0)'); rim.addColorStop(1, 'rgba(170,220,255,.5)');
          cx.save(); cx.globalCompositeOperation = 'lighter'; cx.fillStyle = rim;
          cx.beginPath(); cx.arc(X, Y, R, 0, 6.2832); cx.fill(); cx.restore();
        } else {
          cx.fillStyle = 'rgba(200,230,255,.95)'; cx.beginPath(); cx.arc(X, Y, Math.max(R, 1.2), 0, 6.2832); cx.fill();
        }
      }

      if (cam.warm > .01) {
        const g = cx.createRadialGradient(W / 2, H * 1.05, 0, W / 2, H * 1.05, H * .9);
        g.addColorStop(0, `rgba(255,170,80,${.38 * cam.warm})`); g.addColorStop(1, 'rgba(255,170,80,0)');
        cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      }
      if (cam.tint > .01) {
        const g = cx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * .7);
        g.addColorStop(0, `rgba(255,40,40,${.22 * cam.tint})`); g.addColorStop(1, `rgba(120,0,0,${.35 * cam.tint})`);
        cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      }
      if (cam.dim > .01) { cx.fillStyle = `rgba(0,0,0,${cam.dim})`; cx.fillRect(0, 0, W, H); }
    }

    addEventListener('pointermove', e => { mouse.x = e.clientX / innerWidth - .5; mouse.y = e.clientY / innerHeight - .5; });
    resize();
    addEventListener('resize', resize);
    return { draw, set };
  })();

  /* ------------------------------------------------------------------------
     Field: scattered dots ("not seeing the pattern") that converge onto a
     golden-angle spiral ("it clicked").
     ------------------------------------------------------------------------ */
  const FIELD_OPTS = {
    chaos:    { cx: .73, cy: .5, r: .38, mix: 0, n: 233, m: { cx: .5, cy: .76, r: .2 } },
    click:    { cx: .73, cy: .5, r: .38, mix: 0, n: 233, m: { cx: .5, cy: .76, r: .2 } },
    solved:   { cx: .5, cy: .5, r: .4, mix: 1, n: 144 },
    unsolved: { cx: .5, cy: .5, r: .4, mix: 0, n: 144 }
  };
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  class Field {
    constructor(cv) {
      this.cv = cv; this.ctx = cv.getContext('2d');
      this.base = FIELD_OPTS[cv.dataset.field];
      this.mix = this.goal = this.base.mix; this.flash = 0;
      const r = rng(cv.dataset.field.length * 97);
      this.pts = Array.from({ length: this.base.n }, (_, i) => {
        const rad = Math.sqrt((i + .5) / this.base.n), a = i * GOLDEN;
        return {
          tx: Math.cos(a) * rad, ty: Math.sin(a) * rad,
          bx: (r() * 2 - 1) * 1.5, by: (r() * 2 - 1) * 1.05,
          f1: .2 + r() * .5, f2: .2 + r() * .5, p1: r() * 6.28, p2: r() * 6.28, s: r()
        };
      });
    }
    setGoal(g) {
      if (g >= 1 && this.goal < 1) this.flash = 1;
      this.goal = g;
    }
    reset() { this.mix = this.goal = this.base.mix; this.flash = 0; }
    tick(dt, t) {
      const { cv, ctx } = this;
      const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const o = { ...this.base, ...(isPortrait() && this.base.m ? this.base.m : {}) };
      const speed = this.goal > this.mix ? (this.goal >= 1 ? 3.2 : 1.1) : 3;
      this.mix += (this.goal - this.mix) * (REDUCED ? 1 : 1 - Math.exp(-dt * speed));
      const m = easeIO(clamp(this.mix, 0, 1));
      const X = o.cx * w, Y = o.cy * h, R = o.r * Math.min(w, h), spin = t * .025;
      const cs = Math.cos(spin), sn = Math.sin(spin);

      const P = this.pts.map(p => {
        const ax = p.bx + Math.sin(t * p.f1 + p.p1) * .14, ay = p.by + Math.cos(t * p.f2 + p.p2) * .14;
        const tx = p.tx * cs - p.ty * sn, ty = p.tx * sn + p.ty * cs;
        return [X + lerp(ax, tx, m) * R, Y + lerp(ay, ty, m) * R];
      });

      if (m > .02) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(143,216,255,${.4 * Math.pow(m, 3)})`;
        ctx.beginPath();
        for (let i = 0; i < P.length; i++) {
          for (const k of [21, 34]) {
            const j = i + k; if (j >= P.length) continue;
            ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[j][0], P[j][1]);
          }
        }
        ctx.stroke();
      }

      const warm = this.flash;
      for (let i = 0; i < P.length; i++) {
        const p = this.pts[i], s = 1.6 + p.s * 1.8;
        const a = .6 + .25 * m + .15 * Math.sin(t * 2 + p.p1);
        ctx.fillStyle = warm > .02
          ? `rgba(255,${Math.round(lerp(216, 200, warm))},${Math.round(lerp(255, 61, warm))},${a})`
          : (m > .5 ? `rgba(160,222,255,${a})` : `rgba(243,241,234,${a * .8})`);
        ctx.beginPath(); ctx.arc(P[i][0], P[i][1], s, 0, 6.2832); ctx.fill();
      }

      if (this.flash > 0) {
        const f = this.flash, rr = R * (1.02 + (1 - f) * .7);
        ctx.strokeStyle = `rgba(255,200,61,${f * .7})`; ctx.lineWidth = 2 + f * 3;
        ctx.beginPath(); ctx.arc(X, Y, rr, 0, 6.2832); ctx.stroke();
        const g = ctx.createRadialGradient(X, Y, 0, X, Y, R * 1.2);
        g.addColorStop(0, `rgba(255,200,61,${f * .25})`); g.addColorStop(1, 'rgba(255,200,61,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        this.flash = Math.max(0, this.flash - dt * .7);
      }
    }
  }

  /* ------------------------------------------------------------------------
     Slide-specific builders
     ------------------------------------------------------------------------ */
  function buildBrain(svg) {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
    const OUTLINE = 'M78,168 C52,128 70,72 128,58 C158,26 232,18 270,46 C318,44 360,86 356,132 C374,166 352,206 312,208 C302,232 268,246 238,232 C222,244 200,246 186,236 L190,268 C191,282 174,284 170,270 L160,232 C128,240 96,226 92,204 C70,200 62,184 78,168 Z';
    const GYRI = [
      'M110,108 C140,88 170,118 200,93 S262,78 292,104',
      'M98,150 C130,134 160,164 196,140 S256,128 302,150',
      'M134,192 C166,176 198,202 234,182 S282,176 322,178',
      'M204,58 C192,90 216,110 206,140 S216,188 202,224',
      'M150,70 C140,96 160,118 150,150',
      'M268,64 C280,98 258,120 272,156'
    ];
    const outline = el('path', { d: OUTLINE, class: 'outline', pathLength: 1 });
    svg.append(outline);
    GYRI.forEach(d => svg.append(el('path', { d, class: 'gyrus', pathLength: 1 })));

    const r = rng(3), nodes = [];
    const inside = (x, y) => {
      try { const p = svg.createSVGPoint(); p.x = x; p.y = y; return outline.isPointInFill(p); }
      catch { return ((x - 215) / 140) ** 2 + ((y - 135) / 95) ** 2 < 1; }
    };
    for (let tries = 0; nodes.length < 54 && tries < 3000; tries++) {
      const x = 70 + r() * 290, y = 25 + r() * 220;
      if (inside(x, y) && nodes.every(n => (n[0] - x) ** 2 + (n[1] - y) ** 2 > 380)) nodes.push([x, y]);
    }
    const links = el('g', {});
    nodes.forEach((a, i) => {
      nodes.map((b, j) => [j, (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2]).filter(([j]) => j > i)
        .sort((p, q) => p[1] - q[1]).slice(0, 2)
        .forEach(([j]) => links.append(el('line', { x1: a[0], y1: a[1], x2: nodes[j][0], y2: nodes[j][1], class: 'link' })));
    });
    svg.append(links);
    nodes.forEach(([x, y]) => svg.append(el('circle', { cx: x, cy: y, r: 1.6 + r() * 1.8, class: 'node', style: `--d:${(r() * 2.6).toFixed(2)}s` })));
  }

  const GLYPHS = '▚▞▖▗░▒#%&@ΔΣλ§¿※≠∂';
  function decode(el) {
    const txt = el.dataset.text || (el.dataset.text = el.textContent);
    cancelAnimationFrame(el._raf);
    if (REDUCED) { el.textContent = txt; return; }
    const start = performance.now() + 700;
    const frame = now => {
      const k = (now - start) / 32;
      let out = '';
      for (let i = 0; i < txt.length; i++) {
        const c = txt[i];
        out += c === ' ' || i < k ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (k < txt.length) el._raf = requestAnimationFrame(frame);
      else el.textContent = txt;
    };
    el._raf = requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------------
     Deck: slides, fragments, navigation
     ------------------------------------------------------------------------ */
  const slides = $$('.slide');
  const fields = [];
  slides.forEach(s => {
    s._max = Math.max(0, ...$$('[data-f]', s).map(e => +e.dataset.f));
    $$('[data-f]', s).forEach(frag => $$('.w', frag).forEach((w, i) => w.style.setProperty('--i', i)));
    $$('[data-letters]', s).forEach(el => {
      el.innerHTML = [...el.textContent].map((c, i) => `<span class="ch" style="--i:${i}">${c}</span>`).join('');
    });
    $$('canvas.field', s).forEach(cv => { const f = new Field(cv); f.slide = s; fields.push(f); });
    $$('[data-decode]', s).forEach(el => { el.dataset.text = el.textContent; });
  });
  buildBrain($('#brain'));

  const fieldOf = s => fields.find(f => f.slide === s);
  const HOOKS = {
    click: (s, step) => fieldOf(s).setGoal([0, .3, 1, 1][step])
  };

  // chapter starts → progress ticks
  const totalSteps = slides.reduce((n, s) => n + s._max + 1, 0);
  const stepOffset = []; slides.reduce((n, s, i) => (stepOffset[i] = n, n + s._max + 1), 0);
  const progress = $('#progress');
  slides.forEach((s, i) => {
    if (i && s.dataset.chapter !== slides[i - 1].dataset.chapter) {
      const tick = document.createElement('span'); tick.className = 'tick';
      tick.style.left = (stepOffset[i] / totalSteps * 100) + '%'; progress.append(tick);
    }
  });

  let idx = -1, step = 0;
  const cc = $('#chapterCard');
  let ccTimer;

  function showChapter(name) {
    const [num, title] = name.includes(' · ') ? name.split(' · ') : ['', name];
    $('.cc-num', cc).textContent = num; $('.cc-title', cc).textContent = title;
    cc.classList.add('show'); clearTimeout(ccTimer);
    ccTimer = setTimeout(() => cc.classList.remove('show'), 2400);
  }

  function render() {
    const s = slides[idx];
    for (let k = 1; k <= 6; k++) s.classList.toggle('s' + k, step >= k);
    $$('[data-f]', s).forEach(el => {
      const on = +el.dataset.f <= step;
      if (on && !el.classList.contains('on')) {
        el.classList.add('on');
        if (el.matches('[data-decode]')) decode(el);
      } else if (!on && el.classList.contains('on')) el.classList.remove('on');
    });
    HOOKS[s.dataset.scene]?.(s, step);
    Sky.set(s.dataset.scene, step);

    $('#counter').textContent = `${String(idx + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
    $('#hudChapter').textContent = s.dataset.chapter;
    $('#progressFill').style.width = ((stepOffset[idx] + step + 1) / totalSteps * 100) + '%';
    $('[data-action="prev"]').disabled = idx === 0 && step === 0;
    $('[data-action="next"]').disabled = idx === slides.length - 1 && step === s._max;
    try { history.replaceState(null, '', '#' + (idx + 1)); } catch { /* file:// in some browsers */ }
  }

  function go(n, st = 0) {
    document.body.classList.remove('waiting');
    n = clamp(n, 0, slides.length - 1);
    if (n === idx) { step = clamp(st, 0, slides[n]._max); render(); return; }
    const dir = n > idx ? 'fwd' : 'back';
    const old = slides[idx];
    if (old) {
      old.dataset.dir = dir;
      old.classList.remove('is-active', 'entering');
      old.classList.add('is-leaving');
      old.setAttribute('aria-hidden', 'true');
      clearTimeout(old._t);
      old._t = setTimeout(() => {
        old.classList.remove('is-leaving');
        $$('[data-f]', old).forEach(el => el.classList.remove('on'));
        $$('[data-decode]', old).forEach(el => { cancelAnimationFrame(el._raf); el.textContent = el.dataset.text; });
        const f = fieldOf(old); if (f) f.reset();
      }, 1300);
    }
    const prevChapter = old && old.dataset.chapter;
    idx = n; step = clamp(st, 0, slides[n]._max);
    const s = slides[idx];
    clearTimeout(s._t);
    s.classList.remove('is-leaving');
    $$('[data-f]', s).forEach(el => el.classList.remove('on'));
    s.dataset.dir = dir;
    void s.offsetWidth; // commit the start pose before animating in
    s.classList.add('is-active', 'entering');
    s.removeAttribute('aria-hidden');
    clearTimeout(s._e); s._e = setTimeout(() => s.classList.remove('entering'), 1600);
    if (s.dataset.chapter !== prevChapter) showChapter(s.dataset.chapter);
    render();
  }

  function next() {
    if (idx < 0) { go(start, 0); return; }
    hideHint();
    if (step < slides[idx]._max) { step++; render(); }
    else if (idx < slides.length - 1) go(idx + 1, 0);
  }
  function prev() {
    hideHint();
    if (step > 0) { step--; render(); }
    else if (idx > 0) go(idx - 1, slides[idx - 1]._max);
  }
  function restart() { closeNotes(); go(0, 0); }

  /* ---------- fullscreen ---------- */
  function toggleFullscreen() {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else { const req = el.requestFullscreen || el.webkitRequestFullscreen; if (req) Promise.resolve(req.call(el)).catch(() => {}); }
  }

  /* ---------- notes ---------- */
  const notes = $('#notes');
  const openNotes = () => { notes.classList.add('open'); notes.setAttribute('aria-hidden', 'false'); };
  const closeNotes = () => { notes.classList.remove('open'); notes.setAttribute('aria-hidden', 'true'); };
  const toggleNotes = () => (notes.classList.contains('open') ? closeNotes() : openNotes());

  /* ---------- input ---------- */
  const ACTIONS = { next, prev, restart, fullscreen: toggleFullscreen, notes: toggleNotes };
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (btn) { e.stopPropagation(); ACTIONS[btn.dataset.action](); btn.blur(); return; }
    if (e.target.closest('a, .notes, .hud')) return;
    if (swiped) { swiped = false; return; }
    next();
  });

  addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter':
        if (e.key === 'Enter' && e.target.closest('button, a')) return;
        e.preventDefault(); next(); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace':
        e.preventDefault(); prev(); break;
      case 'Home': e.preventDefault(); restart(); break;
      case 'End': e.preventDefault(); go(slides.length - 1, slides[slides.length - 1]._max); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'n': case 'N': toggleNotes(); break;
      case 'm': case 'M': REDUCED = !REDUCED; document.body.classList.toggle('reduced', REDUCED); break;
      case 'Escape': closeNotes(); break;
    }
  });

  let wheelLock = 0;
  addEventListener('wheel', e => {
    if (e.target.closest('.notes')) return;
    const now = performance.now();
    if (now < wheelLock || Math.abs(e.deltaY) < 12) return;
    wheelLock = now + 900;
    (e.deltaY > 0 ? next : prev)();
  }, { passive: true });

  let tx = 0, ty = 0, swiped = false;
  addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchend', e => {
    if (e.target.closest('.notes')) return;
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { swiped = true; (dx < 0 ? next : prev)(); setTimeout(() => (swiped = false), 400); }
  }, { passive: true });

  // auto-hide controls while presenting
  let idleTimer;
  const wake = () => { document.body.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => document.body.classList.add('idle'), 2800); };
  addEventListener('pointermove', wake); addEventListener('keydown', wake); wake();

  const hint = $('#hint');
  let hintTimer = setTimeout(hideHint, 9000);
  function hideHint() { hint.classList.add('gone'); clearTimeout(hintTimer); }

  /* ---------- main loop ---------- */
  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, .05), t = now / 1000; last = now;
    Sky.draw(dt, t);
    for (const f of fields) {
      if (f.slide.classList.contains('is-active') || f.slide.classList.contains('is-leaving')) f.tick(dt, t);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---------- boot: black → letterbox opens → Earth spins alone until the first click ---------- */
  const start = clamp((parseInt(location.hash.slice(1), 10) || 1) - 1, 0, slides.length - 1);
  Sky.set('earth', 0);
  setTimeout(() => document.body.classList.remove('intro'), REDUCED ? 0 : 700);
})();
