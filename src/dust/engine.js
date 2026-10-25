// @ts-nocheck — plain JavaScript, typed by engine.d.ts.
/* dust.js — a small engine for « dust » motion design.
 *
 * The idea: a scene never animates grains directly. Each frame, it says where every grain *wants* to be (emit), and
 * the engine gives the grains a body: a damped spring towards that place, a mass of their own, a slow current while
 * they move, one of three depths, light that adds up at night (ink that darkens on paper) and a streak when fast.
 * A grain the scene stops asking for keeps its momentum and fades. That separation is what makes the motion feel
 * physical, interruptible and consistent across every moment of an app.
 *
 * Vera's copy of the dust-motion engine (the « dust-motion » skill's dust.js), as an ES module.
 *
 *   const dust = Dust.create(canvas, {renderer: 'webgl', mode: 'night', width: 960, height: 600});
 *   function frame(dt, t) {
 *     drawYourScene(t);                         // background, UI, pictures
 *     for (const g of grains) dust.emit(g.id, x(t), y(t), size, r, g, b, alpha);
 *     dust.step(dt, t); dust.draw();
 *   }
 */

/* ——— Time and shape helpers ——— */
const span = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const mix = (a, b, k) => a + (b - a) * k;
const ease = {
  /** In-out, for things that move from one rest to another. */
  inOut: t => t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  /** Fast out, slow in: for what arrives. */
  out: t => t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3),
  /** Slow out, fast in: for what leaves. */
  in: t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * t,
  /** A spring that overshoots once and settles (x from 0 to ~1). */
  spring: (t, k = 5, w = 8) => t <= 0 ? 0 : 1 - Math.exp(-k * t) * Math.cos(w * t),
};
/** A point on a quadratic curve from a to b bending through c (one axis). */
const curve = (a, b, c, k) => (1 - k) * (1 - k) * a + 2 * (1 - k) * k * c + k * k * b;

/** The four tempos of a product. Nothing in between: that is what makes it feel like one thing. */
const TEMPO = {micro: .25, transition: .6, moment: 3, breath: 10 /* seconds per breath: 6 a minute, a calm breathing */};

/** A seeded random generator, so that a scene is the same every time it plays (or every day, with daySeed). */
function rng(seed = 7) {let s = Math.max(1, Math.floor(seed)) % 2147483647; return () => (s = (s * 16807) % 2147483647) / 2147483647;}
/** A seed that changes once a day: a little different every day, always the same within a day. */
function daySeed(base = 7) {const now = new Date(); const day = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5); return base + day * 101 + now.getFullYear();}

/* ——— Sampling: what the dust is made of, and what it becomes ——— */

/** n grains of a picture: their place on it (u, v from 0 to 1) and their colour. img: an <img> (decoded), canvas or ImageBitmap. */
function sampleImage(img, n, random = rng(), res = 128) {
  const w = res, h = Math.max(1, Math.round(res * (img.naturalHeight || img.height) / (img.naturalWidth || img.width)));
  const c = makeCanvas(w, h), o = c.getContext('2d', {willReadFrequently: true});
  o.drawImage(img, 0, 0, w, h);
  const px = o.getImageData(0, 0, w, h).data;
  const g = {n, u: new Float32Array(n), v: new Float32Array(n), r: new Uint8Array(n), g: new Uint8Array(n), b: new Uint8Array(n), a: new Uint8Array(n), s: new Float32Array(n)};
  for (let i = 0; i < n; i++) {
    let x, y, k, tries = 0;
    do {x = Math.floor(random() * w); y = Math.floor(random() * h); k = (y * w + x) * 4;} while (px[k + 3] < 30 && ++tries < 8);
    g.u[i] = x / w; g.v[i] = y / h; g.r[i] = px[k]; g.g[i] = px[k + 1]; g.b[i] = px[k + 2]; g.a[i] = px[k + 3]; g.s[i] = random();
  }
  return g;
}

/** n points inside anything you can paint on a canvas (a Path2D, text, an image's alpha), in stage coordinates. */
function sampleShape(paint, width, height, n, random = rng()) {
  const c = makeCanvas(width, height), o = c.getContext('2d', {willReadFrequently: true});
  o.fillStyle = '#000'; paint(o);
  const data = o.getImageData(0, 0, width, height).data, pts = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 120) pts.push(x, y);
  const out = new Float32Array(n * 2), m = pts.length / 2;
  if (!m) return out;
  for (let i = 0; i < n; i++) {const j = Math.floor(random() * m); out[i * 2] = pts[j * 2] + random() - .5; out[i * 2 + 1] = pts[j * 2 + 1] + random() - .5;}
  return out;
}

/** n points inside some text. lines: array of strings; font: a CSS font (load it first: document.fonts.load). */
function sampleText(lines, font, x, y, lineHeight, width, height, n, random = rng(), align = 'left') {
  return sampleShape(o => {o.font = font; o.textAlign = align; [].concat(lines).forEach((l, i) => o.fillText(l, x, y + i * lineHeight));}, width, height, n, random);
}

/** The colour of a grain on its way: from its own colour to a warm light mid-way, then towards the destination's. */
function travelColour(rgb, p, {warm = [255, 214, 160], end = null, endAt = .75, amount = .5} = {}) {
  const k = Math.sin(p * Math.PI) * amount, e = end ? span(p, endAt, 1) * .6 : 0, d = end ?? rgb;
  return [mix(mix(rgb[0], warm[0], k), d[0], e), mix(mix(rgb[1], warm[1], k), d[1], e), mix(mix(rgb[2], warm[2], k), d[2], e)];
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

/* ——— The engine ——— */

const hash = n => {const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v);};
const current = (x, y, t) => Math.sin(x * .011 + t * .35) + Math.sin(y * .013 - t * .27) + Math.sin((x + y) * .007 + t * .18);

/**
 * canvas: for '2d', the canvas your scene draws on (grains are drawn on top, in stage coordinates);
 *         for 'webgl', a transparent canvas laid exactly over your scene (it gets mix-blend-mode set for you).
 * options: width/height (the stage, in CSS pixels or your own units), renderer ('2d' | 'webgl' | 'auto'),
 *          mode ('night': light adds up | 'paper': ink darkens), max grains, stiffness, damping, current, light.
 */
function create(canvas, options = {}) {
  const o = Object.assign({renderer: 'auto', mode: 'night', width: canvas.clientWidth || canvas.width, height: canvas.clientHeight || canvas.height,
    max: 60000, stiffness: 150, damping: .62, current: 1, light: .46, depth: true, streaks: true}, options);
  const M = o.max;
  const G = {x: new Float32Array(M), y: new Float32Array(M), vx: new Float32Array(M), vy: new Float32Array(M), tx: new Float32Array(M), ty: new Float32Array(M),
    s: new Float32Array(M), r: new Float32Array(M), g: new Float32Array(M), b: new Float32Array(M), a: new Float32Array(M), z: new Float32Array(M),
    seen: new Uint32Array(M), alive: new Uint8Array(M), fade: new Float32Array(M)};
  const MASS = new Float32Array(M), LAYER = new Uint8Array(M);
  for (let i = 0; i < M; i++) {MASS[i] = .55 + hash(i) * 1.3; const h = hash(i * 3.7 + 1); LAYER[i] = h < .16 ? 2 : h < .78 ? 1 : 0;}
  let list = [], frame = 1;

  let renderer = o.renderer;
  if (renderer === 'auto') renderer = webglAvailable() ? 'webgl' : '2d';
  const paint = renderer === 'webgl' ? webgl(canvas, o) : canvas2d(canvas, o);

  const api = {
    renderer, options: o,
    get mode() {return o.mode;}, set mode(m) {o.mode = m; paint.mode?.(m);},
    get count() {return list.length;},

    /** Where grain `id` wants to be this frame. z: how loosely it follows (damping ratio); lower bounces more. */
    emit(id, x, y, size, r, g, b, a, z = o.damping) {
      if (id < 0 || id >= M) return;
      if (!G.alive[id]) {G.alive[id] = 1; G.x[id] = x; G.y[id] = y; G.vx[id] = 0; G.vy[id] = 0; list.push(id);}
      G.tx[id] = x; G.ty[id] = y; G.s[id] = size; G.r[id] = r; G.g[id] = g; G.b[id] = b; G.a[id] = a; G.z[id] = z; G.seen[id] = frame; G.fade[id] = 1;
    },

    /** Moves every grain by dt seconds (scene time: multiply by your playback speed). */
    step(dt, t = 0) {
      if (dt <= 0) {frame++; return;}
      dt = Math.min(dt, 1 / 20);
      const keep = [];
      for (const id of list) {
        const asked = G.seen[id] === frame;
        if (!asked) {G.fade[id] *= Math.exp(-dt * 7); if (G.fade[id] < .03) {G.alive[id] = 0; continue;}}
        const layer = o.depth ? LAYER[id] : 1, m = MASS[id] * (layer === 0 ? 1.5 : layer === 2 ? .8 : 1);
        const k = o.stiffness / m, c = 2 * G.z[id] * Math.sqrt(k);
        const fast = Math.abs(G.vx[id]) + Math.abs(G.vy[id]) > 40, sub = fast ? 2 : 1, h = dt / sub;
        for (let n = 0; n < sub; n++) {
          let ax = 0, ay = 0;
          if (asked) {ax = k * (G.tx[id] - G.x[id]) - c * G.vx[id]; ay = k * (G.ty[id] - G.y[id]) - c * G.vy[id];}
          // The current: felt by moving grains; still ones only breathe (cheaper, and calmer).
          const speed = Math.hypot(G.vx[id], G.vy[id]), x = G.x[id], y = G.y[id];
          if (o.current > 0 && speed > 14) {
            const e = 3, flow = (22 + Math.min(1, speed / 220) * 260) * 6 * o.current;
            ax += (current(x, y + e, t) - current(x, y - e, t)) / (2 * e) * flow;
            ay -= (current(x + e, y, t) - current(x - e, y, t)) / (2 * e) * flow;
          } else if (o.current > 0) {ax += Math.sin(id + t * 1.1) * 14 * o.current; ay += Math.cos(id * 1.3 + t * .9) * 14 * o.current;}
          if (!asked) {ax -= G.vx[id] * 1.2; ay -= G.vy[id] * 1.2;}
          G.vx[id] += ax * h; G.vy[id] += ay * h; G.x[id] += G.vx[id] * h; G.y[id] += G.vy[id] * h;
        }
        keep.push(id);
      }
      list = keep; frame++;
    },

    /** Draws the grains (2d: on top of what is on the canvas; webgl: clears its own canvas first). */
    draw() {paint.draw(G, list, LAYER, o);},

    /** Forgets every grain (when a scene starts over). */
    reset() {for (const id of list) G.alive[id] = 0; list = []; paint.clear?.();},

    /** Call when the stage changes size (CSS pixels) or the device pixel ratio changes. */
    resize(width, height) {o.width = width; o.height = height; paint.resize?.(width, height);},

    /** Read access to a grain, for scenes that react to where the dust really is (e.g. a glow where it lands). */
    position: id => G.alive[id] ? [G.x[id], G.y[id]] : null,
  };
  paint.resize?.(o.width, o.height);
  return api;
}

function webglAvailable() {
  try {const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl'));} catch {return false;}
}

/* ——— Canvas 2D: simple, enough for ~15 000 grains, and draws over your own scene ——— */
function canvas2d(canvas, o) {
  const ctx = canvas.getContext('2d');
  return {
    draw(G, list, LAYER, o) {
      ctx.save();
      ctx.globalCompositeOperation = o.mode === 'paper' ? 'multiply' : 'lighter';
      const light = o.mode === 'paper' ? 1 : o.light;
      for (const id of list) {
        const layer = o.depth ? LAYER[id] : 1, size = G.s[id] * (layer === 2 ? 1.75 : layer === 0 ? .7 : 1);
        const alpha = G.a[id] * G.fade[id] * light * (layer === 1 ? 1 : .71);
        if (alpha <= .01) continue;
        const vx = G.vx[id], vy = G.vy[id], sp = Math.hypot(vx, vy);
        const col = `rgba(${G.r[id] | 0},${G.g[id] | 0},${G.b[id] | 0},${alpha})`;
        if (o.streaks && sp > 160) {
          // Motion blur: a fast grain is a short streak along its way.
          const len = Math.min(22, sp * .018);
          ctx.strokeStyle = col; ctx.lineWidth = size; ctx.beginPath(); ctx.moveTo(G.x[id] - vx / sp * len, G.y[id] - vy / sp * len); ctx.lineTo(G.x[id], G.y[id]); ctx.stroke();
        } else {ctx.fillStyle = col; ctx.fillRect(G.x[id] - size / 2, G.y[id] - size / 2, size, size);}
      }
      ctx.restore();
    },
  };
}

/* ——— WebGL: tens of thousands of soft grains at the screen's rate, on a transparent canvas over the scene ——— */
function webgl(canvas, o) {
  const gl = canvas.getContext('webgl', {premultipliedAlpha: true, alpha: true, antialias: false});
  if (!gl) return canvas2d(canvas, o);
  const vs = `attribute vec2 p; attribute float s; attribute vec4 c; uniform vec2 res; uniform float dpr; varying vec4 vc;
    void main() { gl_Position = vec4(p / res * 2.0 - 1.0, 0.0, 1.0); gl_Position.y = -gl_Position.y; gl_PointSize = max(1.0, s * dpr * 1.6); vc = c; }`;
  const fs = `precision mediump float; varying vec4 vc;
    void main() { float d = length(gl_PointCoord - 0.5); float a = vc.a * smoothstep(0.5, 0.18, d); gl_FragColor = vec4(vc.rgb * a, a); }`;
  const sh = (type, src) => {const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s;};
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const STRIDE = 7, FB = 4;
  const at = name => gl.getAttribLocation(prog, name);
  gl.enableVertexAttribArray(at('p')); gl.vertexAttribPointer(at('p'), 2, gl.FLOAT, false, STRIDE * FB, 0);
  gl.enableVertexAttribArray(at('s')); gl.vertexAttribPointer(at('s'), 1, gl.FLOAT, false, STRIDE * FB, 2 * FB);
  gl.enableVertexAttribArray(at('c')); gl.vertexAttribPointer(at('c'), 4, gl.FLOAT, false, STRIDE * FB, 3 * FB);
  const uRes = gl.getUniformLocation(prog, 'res'), uDpr = gl.getUniformLocation(prog, 'dpr');
  let data = new Float32Array(o.max * 3 * STRIDE), dpr = 1;
  gl.enable(gl.BLEND);
  // Grains add up among themselves; the canvas blends with the page below by CSS (light at night, ink on paper).
  const setMode = m => {canvas.style.mixBlendMode = m === 'paper' ? 'multiply' : 'plus-lighter'; gl.blendFunc(gl.ONE, m === 'paper' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);};
  setMode(o.mode);
  canvas.style.pointerEvents = 'none';
  return {
    mode: setMode,
    resize(w, h) {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    clear() {gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);},
    draw(G, list, LAYER, o) {
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      const light = o.mode === 'paper' ? 1 : o.light * 1.6;
      let n = 0;
      const put = (x, y, s, r, g, b, a) => {const k = n++ * STRIDE; data[k] = x; data[k + 1] = y; data[k + 2] = s; data[k + 3] = r / 255; data[k + 4] = g / 255; data[k + 5] = b / 255; data[k + 6] = a;};
      for (const id of list) {
        const layer = o.depth ? LAYER[id] : 1, size = G.s[id] * (layer === 2 ? 1.75 : layer === 0 ? .7 : 1);
        const alpha = Math.min(1, G.a[id] * G.fade[id] * light * (layer === 1 ? 1 : .71));
        if (alpha <= .01) continue;
        put(G.x[id], G.y[id], size, G.r[id], G.g[id], G.b[id], alpha);
        const vx = G.vx[id], vy = G.vy[id], sp = Math.hypot(vx, vy);
        if (o.streaks && sp > 160 && n < o.max * 3 - 2) {
          // Motion blur with points: two fainter grains behind a fast one.
          const len = Math.min(22, sp * .018) / sp;
          put(G.x[id] - vx * len * .5, G.y[id] - vy * len * .5, size * .9, G.r[id], G.g[id], G.b[id], alpha * .55);
          put(G.x[id] - vx * len, G.y[id] - vy * len, size * .8, G.r[id], G.g[id], G.b[id], alpha * .28);
        }
      }
      gl.uniform2f(uRes, o.width, o.height); gl.uniform1f(uDpr, dpr);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * STRIDE), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, n);
    },
  };
}

/* ——— A clock for scenes: play, skip (the grains fly to their end instead of cutting), seek (for checking frames) ——— */
/**
 * scene: {end: seconds or Infinity, draw(t, dt)} — draw paints the scene and emits the grains for time t.
 * The clock steps the dust itself after each draw. reducedMotion: shows the last frame only (a still, complete page).
 */
function clock(dust, scene, {speed = 1, onTime = null, reducedMotion = matchMedia?.('(prefers-reduced-motion: reduce)').matches} = {}) {
  let t = 0, last = 0, playing = false, tail = 0, raf = 0;
  const c = {
    get time() {return t;}, get playing() {return playing;}, speed,
    scene,
    play(from = 0) {
      dust.reset(); t = from; tail = 0;
      if (reducedMotion && scene.end !== Infinity) {t = scene.end; scene.draw(t, 0); return;}
      last = performance.now(); if (!playing) {playing = true; raf = requestAnimationFrame(loop);}
    },
    /** Ends the moment now: the scene jumps to its last state and the grains fly there. */
    skip() {if (scene.end !== Infinity) t = scene.end;},
    stop() {playing = false; cancelAnimationFrame(raf);},
    /** Shows time `at` as it would really look: the physics runs from the start, without painting. */
    seek(at, fps = 60) {
      c.stop(); dust.reset();
      for (let k = 0; k < Math.round(at * fps); k++) {t = k / fps; scene.draw(t, 1 / fps, true); dust.step(1 / fps, t);}
      t = at; scene.draw(t, 0); dust.draw();
    },
  };
  function loop(now) {
    if (!playing) return;
    // While the window is hidden, nothing runs.
    if (document.hidden) {last = now; raf = requestAnimationFrame(loop); return;}
    const dt = Math.min(.05, (now - last) / 1000) * c.speed; last = now;
    t = Math.min(scene.end, t + dt);
    scene.draw(t, dt); dust.step(dt, t); dust.draw(); onTime?.(t);
    if (t >= scene.end) {tail += dt; if (tail > 1.4) {playing = false; return;}}
    raf = requestAnimationFrame(loop);
  }
  return c;
}

export const Dust = {create, clock, sampleImage, sampleShape, sampleText, travelColour, rng, daySeed, ease, span, mix, curve, TEMPO};
export default Dust;
