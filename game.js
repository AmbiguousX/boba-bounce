import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// ================================================================ ANIMATIONS (same code as boba-bounce.animations.js)
// Boba Bounce — animation driver.
// 133 boba bouncers hopping around inside one big cup. update(o, t) with t = room clock (seconds).
// Each bouncer wanders inside its own cell of a hex grid, so no two can ever overlap.
// Rotations are always written as a full (x, y, z) so a GLB round trip can't flip anything.

const TAU = Math.PI * 2;
const wrap = (a, m) => ((a % m) + m) % m;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ================================================================ LAYOUT (shared with the world builder)
const MAP = { groundR: 34, edgeR: 30 };
const CUP = { r: 16.5, h: 7, floor: 0.15, door: 0, doorH: 0 };   // sealed: you start in the pit and stay in it
const COUNT = 133;
const CELL = 2.4;                                                      // hex spacing
const CELLS = (() => {
  const out = [], rowH = CELL * Math.sqrt(3) / 2;
  for (let j = -9; j <= 9; j++) for (let i = -9; i <= 9; i++) {
    const x = (i + (j % 2 ? 0.5 : 0)) * CELL, z = j * rowH;
    if (Math.hypot(x, z) < CUP.r - 1.5) out.push([x, z]);
  }
  out.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || Math.atan2(a[0], a[1]) - Math.atan2(b[0], b[1]));
  // the centre cell is left empty: that's where the player starts
  return out.filter(([x, z]) => Math.hypot(x, z) > 1.0).slice(0, COUNT);
})();
const BOUNCERS = CELLS.map((c, i) => ({
  c,
  r: 0.34 + hash(i) * 0.12,                    // body radius
  hop: 0.7 + hash(i + 50) * 0.45,              // seconds per hop
  H: 0.45 + hash(i + 90) * 0.6,                // hop height
  wander: 0.28 + hash(i + 130) * 0.22,         // loop radius inside the cell
  dir: hash(i + 170) < 0.5 ? -1 : 1,
  shape: hash(i + 210) * TAU,
  ph: hash(i + 250),
  tOff: hash(i + 290) * 3,
  step: 0.05 + hash(i + 330) * 0.05,           // loop fraction per hop
  spin: 5 + Math.floor(hash(i + 370) * 6),     // spin hop every N hops
  big: 4 + Math.floor(hash(i + 410) * 5),      // big hop every N hops
}));
const bouncerLoop = (b, p) => {
  const a = p * TAU * b.dir;
  return [b.c[0] + b.wander * (0.72 * Math.sin(a) + 0.28 * Math.sin(-2 * a + b.shape)), b.c[1] + b.wander * (0.72 * Math.cos(a) + 0.28 * Math.cos(-2 * a + b.shape))];
};

// ================================================================ MOTION
// squash and stretch with constant volume: sideways scale = 1 / sqrt(vertical scale)
function bouncer(i) {
  const b = BOUNCERS[i], CONTACT = 0.22;
  return {
    update(o, t) {
      const tt = t + b.tOff, n = Math.floor(tt / b.hop), u = tt / b.hop - n;
      const air = u < CONTACT ? 0 : (u - CONTACT) / (1 - CONTACT);
      const prog = b.ph + (n + air) * b.step;
      const [x, z] = bouncerLoop(b, prog), [x2, z2] = bouncerLoop(b, prog + 0.004);
      let sy;
      if (u < CONTACT) sy = 1 - 0.3 * Math.sin((Math.PI * u) / CONTACT);
      else sy = 1 + 0.16 * Math.abs(Math.cos(Math.PI * air)) * (1 - 0.6 * Math.sin(Math.PI * air));
      const sxz = 1 / Math.sqrt(sy);
      const y = CUP.floor + b.H * Math.sin(Math.PI * air) * ((n % b.big) === 2 ? 1.6 : 1);
      let yaw = Math.atan2(x2 - x, z2 - z) + 0.35 * Math.sin(tt * 1.7 + i);
      if (n % b.spin === 3) yaw += TAU * smooth(air);
      const tilt = 0.18 * Math.sin(tt * 2.3 + i * 1.3) * (u < CONTACT ? 0.3 : 1);
      o.position.set(x, y, z);
      o.rotation.set(0.12 * Math.sin(Math.PI * air) * (n % 2 ? 1 : -1), wrap(yaw, TAU), tilt);
      o.scale.set(sxz, sy, sxz);
    },
  };
}

// ================================================================ DRIVER
const ANIMATIONS = BOUNCERS.map((_, i) => ({ name: `dynamic_boba_bouncer_${i}`, ...bouncer(i) }));

const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);

// ================================================================ WORLD
// Boba Bounce — scene builder. Uses the layout block from boba-bounce.animations.js (same scope).
// Every mesh is plain BufferGeometry so GLB export keeps baked transforms.

function buildWorld() {
  const root = new THREE.Group();
  root.name = 'boba_bounce';
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const M = {
    matte: std({ roughness: 0.85, name: 'matte' }),
    soft: std({ roughness: 0.55, name: 'soft' }),
    gloss: std({ roughness: 0.22, name: 'gloss' }),
    glass: std({ roughness: 0.08, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false, name: 'glass' }),
    straw: std({ roughness: 0.2, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, name: 'straw' }),
    invisible: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, name: 'invisible' }),
  };
  const C = { grass: '#7ccf4f', grass2: '#5fb63f', grass3: '#94dc62', path: '#f2dcae', trunk: '#8c5a3a', leaf: '#4ea83a', leaf2: '#76cf52', leaf3: '#a4e06a',
    pearl: '#3a2118', white: '#ffffff', glass: '#ffe9f1', pink: '#ff9fbf', pink2: '#ff6f9c', shell: '#d93a52', lychee: '#fbf4ea', tea: '#f3dccb', tea2: '#ecd0bd', cream: '#fff2d9' };

  const _c = new THREE.Color(), tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion();
  function xf(p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
    tmpE.set(r[0], r[1], r[2], 'YXZ'); tmpQ.setFromEuler(tmpE);
    return new THREE.Matrix4().compose(new THREE.Vector3(...p), tmpQ.clone(), new THREE.Vector3(...(Array.isArray(s) ? s : [s, s, s])));
  }
  function G(geo, color, m) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.color) {
      _c.set(color || '#ffffff');
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
      g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
    }
    const out = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'color']) out.setAttribute(k, g.attributes[k]);
    return out;
  }
  function paint(g, fn) {
    const P = g.attributes.position, Cc = g.attributes.color, v = new THREE.Vector3();
    for (let i = 0; i < P.count; i += 3) {
      v.set(0, 0, 0);
      for (let j = 0; j < 3; j++) v.x += P.getX(i + j) / 3, v.y += P.getY(i + j) / 3, v.z += P.getZ(i + j) / 3;
      _c.set(fn(v));
      for (let j = 0; j < 3; j++) Cc.setXYZ(i + j, _c.r, _c.g, _c.b);
    }
    return g;
  }
  const names = new Set();
  function mesh(name, geos, mat, opts = {}) {
    if (names.has(name)) throw new Error('duplicate name ' + name);
    names.add(name);
    let geo = BufferGeometryUtils.mergeGeometries(geos, false);
    geo = BufferGeometryUtils.mergeVertices(geo, 1e-4);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    const noShadow = name.includes('noShadow') || mat === M.invisible;
    m.castShadow = opts.cast ?? !noShadow;
    m.receiveShadow = opts.receive ?? mat !== M.invisible;
    if (opts.p) m.position.set(...opts.p);
    root.add(m);
    return m;
  }
  const polar = (a, r, y = 0) => [Math.sin(a) * r, y, Math.cos(a) * r];
  function wall(pts, y0, h) {
    const pos = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const A = [x0, y0, z0], B = [x1, y0, z1], Cc = [x1, y0 + h, z1], D = [x0, y0 + h, z0];
      pos.push(...A, ...B, ...Cc, ...A, ...Cc, ...D, ...A, ...Cc, ...B, ...A, ...D, ...Cc);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return G(g);
  }
  const arcPts = (r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [Math.sin(a) * r, Math.cos(a) * r]; });
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function sign(name, text, sub, w, h, p, yaw) {
    const cv = document.createElement('canvas'), W = 1024, Hh = Math.round((1024 * h) / w);
    cv.width = W; cv.height = Hh;
    const x = cv.getContext('2d');
    x.fillStyle = '#fff6ea'; x.fillRect(0, 0, W, Hh);
    x.strokeStyle = '#d93a52'; x.lineWidth = 10; x.strokeRect(14, 14, W - 28, Hh - 28);
    x.fillStyle = '#d93a52'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `900 ${Hh * 0.38}px "Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif`; x.fillText(text, W / 2, Hh * 0.42, W - 70);
    x.font = `700 ${Hh * 0.16}px "Trebuchet MS", Arial, sans-serif`; x.fillText(sub, W / 2, Hh * 0.76, W - 80);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const g = new THREE.Group(); g.name = name; g.position.set(...p); g.rotation.y = yaw;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, name: name + '_face' }));
    face.name = name + '_face'; face.position.z = 0.2;
    const board = new THREE.Mesh(G(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.16), C.pink2), M.soft);
    board.name = name + '_board'; board.castShadow = true;
    g.add(face, board); root.add(g);
  }

  // ---------------------------------------------------------------- ground + path + edge
  const ground = G(new THREE.RingGeometry(0.01, MAP.groundR, 96, 28), C.grass, xf([0, 0, 0], [-Math.PI / 2, 0, 0]));
  paint(ground, (v) => { const n = Math.sin(v.x * 0.11 + 1.3) * Math.cos(v.z * 0.09) + 0.4 * Math.sin((v.x - v.z) * 0.07); return n > 0.8 ? C.grass3 : n < -0.8 ? C.grass2 : C.grass; });
  mesh('static_ground', [ground], M.matte, { cast: false });
  mesh('static_path_noShadow', [G(new THREE.BoxGeometry(3.6, 0.06, MAP.edgeR - CUP.r - 0.2), C.path, xf([0, 0.07, (MAP.edgeR + CUP.r) / 2 + 0.1]))], M.matte, { cast: false });
  mesh('static_edge_collider_invisible_noShadow', [wall(arcPts(MAP.edgeR, 0, TAU, 120), 0, 4)], M.invisible);

  // ---------------------------------------------------------------- the cup
  // sealed cup: one continuous glass wall, no doorway
  mesh('static_cup_wall_noShadow', [G(new THREE.CylinderGeometry(CUP.r + 1.2, CUP.r, CUP.h, 96, 1, true), C.glass, xf([0, CUP.h / 2, 0]))], M.glass, { cast: false });
  mesh('static_cup_rim', [G(new THREE.TorusGeometry(CUP.r + 1.2, 0.2, 8, 128), C.white, xf([0, CUP.h, 0], [Math.PI / 2, 0, 0]))], M.gloss);
  const floor = G(new THREE.CylinderGeometry(CUP.r - 0.02, CUP.r - 0.02, CUP.floor, 96, 1), C.tea, xf([0, CUP.floor / 2, 0]));
  paint(floor, (v) => (Math.floor(Math.hypot(v.x, v.z) / 1.8) % 2 ? C.tea : C.tea2));
  mesh('static_cup_floor', [floor], M.soft, { cast: false });
  // a little lychee start pad in the middle of the pit
  mesh('static_start_pad_noShadow', [G(new THREE.CylinderGeometry(0.75, 0.75, 0.02, 40), C.white, xf([0, CUP.floor + 0.012, 0])), G(new THREE.TorusGeometry(0.75, 0.04, 8, 48), C.pink, xf([0, CUP.floor + 0.02, 0], [Math.PI / 2, 0, 0]))], M.soft, { cast: false });
  const prints = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU + 0.13;
    if (Math.abs(wrap(a + Math.PI, TAU) - Math.PI) < CUP.door + 0.12) continue;
    const y = 4.6 + (i % 2) * 1.0, r = CUP.r + (1.2 * y) / CUP.h + 0.05;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.sin(a), 0, Math.cos(a)));
    prints.push(G(new THREE.CircleGeometry(0.6, 20), i % 2 ? C.shell : C.lychee, new THREE.Matrix4().compose(new THREE.Vector3(...polar(a, r, y)), q, new THREE.Vector3(1, 1, 1))));
  }
  mesh('static_cup_print_noShadow', prints, M.soft, { cast: false });
  // big striped straw leaning against the back rim
  {
    const a = Math.PI + 0.35, base = polar(a, CUP.r - 1.2, CUP.floor), top = vadd(polar(a, CUP.r + 4, 0), [0, CUP.h + 9, 0]);
    const d = vsub(top, base), L = vlen(d);
    const g = G(new THREE.CylinderGeometry(0.9, 0.9, L, 24, 30, true), C.pink, new THREE.Matrix4().compose(new THREE.Vector3(...vadd(base, vmul(d, 0.5))), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...d).normalize()), new THREE.Vector3(1, 1, 1)));
    paint(g, (v) => (wrap(Math.atan2(v.x - base[0], v.z - base[2]) / TAU * 3 + v.y * 0.35, 1) < 0.5 ? C.pink : C.white));
    mesh('static_straw_noShadow', [g], M.straw, { cast: false });
  }
  // entrance sign on posts in front of the door
  {
    const z = CUP.r + 3;
    mesh('static_sign_posts', [G(new THREE.CylinderGeometry(0.2, 0.2, 5.2, 12), C.pink, xf([-4.1, 2.6, z])), G(new THREE.CylinderGeometry(0.2, 0.2, 5.2, 12), C.pink, xf([4.1, 2.6, z])),
      G(new THREE.IcosahedronGeometry(0.42, 2), C.pearl, xf([-4.1, 5.5, z])), G(new THREE.IcosahedronGeometry(0.42, 2), C.pearl, xf([4.1, 5.5, z]))], M.gloss);
    sign('static_sign_entrance', 'BOBA BOUNCE', 'from Chonkverse', 7.4, 1.8, [0, 4.0, z], 0);
  }
  // a ring of Nintendo-green trees outside
  {
    const trunks = [], crowns = [], pr = rng(77);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + pr() * 0.15, r = 23 + pr() * 5;
      if (Math.abs(wrap(a + Math.PI, TAU) - Math.PI) < 0.35) continue;      // keep the path clear
      const x = Math.sin(a) * r, z = Math.cos(a) * r, s = 0.8 + pr() * 0.5, h = 3.2 * s;
      trunks.push(G(new THREE.CylinderGeometry(0.32 * s, 0.46 * s, h, 8), C.trunk, xf([x, h / 2, z])));
      [[0, h + 1.5 * s, 0, 2.2 * s], [1.1 * s, h + 0.8 * s, 0.4 * s, 1.6 * s], [-1.0 * s, h + 0.9 * s, -0.4 * s, 1.7 * s]].forEach(([bx, by, bz, br], j) =>
        crowns.push(G(new THREE.IcosahedronGeometry(br, 1), [C.leaf, C.leaf2, C.leaf3][(i + j) % 3], xf([x + bx, by, z + bz], [0, pr() * TAU, 0]))));
    }
    mesh('static_trees', trunks, M.matte);
    mesh('static_tree_canopy', crowns, M.soft);
  }

  // ---------------------------------------------------------------- the bouncers (origin at the bottom so squash keeps them on the floor)
  const vnormL = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  BOUNCERS.forEach((b, i) => {
    const r = b.r;
    const body = G(new THREE.SphereGeometry(r, 20, 14), C.pearl, xf([0, r * 0.96, 0], [0, 0, 0], [1, 0.96, 1]));
    const eyes = [-1, 1].map((sx) => {
      const d = vnormL([sx * 0.4, 0.22, 0.89]);
      return G(new THREE.SphereGeometry(r * 0.22, 10, 8), C.white, xf([d[0] * r * 0.97, r * 0.96 + d[1] * r * 0.94, d[2] * r * 0.97], [0, 0, 0], [1, 1.25, 0.6]));
    });
    const [x, z] = bouncerLoop(b, b.ph);
    mesh(`dynamic_boba_bouncer_${i}`, [body, ...eyes], M.gloss, { p: [x, CUP.floor, z] });
  });
  return root;
}


// ================================================================ CHIBI PLAYER
// ---------------------------------------------------------------- CHIBI PLAYER (preview only — not part of the map export)
// Built from plain shapes in a small group hierarchy: no skeleton, no skinned mesh.
// Each limb is a pivot group, so animating = rotating groups. The capsule (radius 0.2, length 0.4)
// stays the physics body; the chibi is just what you see.

const CHIBI = { capR: 0.2, capLen: 0.4, legH: 0.177, bodyH: 0.24, headR: 0.215 };

function makeChibi(colors = {}, base = 'male') {
  const col = { body: '#ff9fbf', skin: '#fff3e6', ear: '#ffd6e0', eye: '#2b1a14', ...colors };
  const mats = {};
  const mat = (c, rough = 0.55) => (mats[c + rough] ??= new THREE.MeshStandardMaterial({ color: c, roughness: rough }));
  const part = (geo, c, p = [0, 0, 0], s = [1, 1, 1], rough) => {
    const m = new THREE.Mesh(geo, mat(c, rough));
    m.position.set(...p); m.scale.set(...s); m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  const pivot = (name, p) => { const g = new THREE.Group(); g.name = name; g.position.set(...p); return g; };

  const root = pivot('chibi', [0, 0, 0]);            // sits at the capsule's feet, turned to face travel
  const FLIP_Y = 0.3;
  const flip = pivot('chibi_flip', [0, FLIP_Y, 0]);         // spins and flips turn around the belly
  const squash = pivot('chibi_squash', [0, -FLIP_Y, 0]);    // squash and stretch happen around the feet
  const hips = pivot('chibi_hips', [0, CHIBI.legH, 0]);
  root.add(flip); flip.add(squash); squash.add(hips);

  // body: a soft rounded bean
  const body = part(new THREE.CapsuleGeometry(0.115, 0.07, 6, 16), col.body, [0, 0.11, 0], [1.32, 1, 1.0]);   // wider body, more room between the legs
  hips.add(body);

  // legs: stubby capsules hinged at the hips
  // bare feet are always there; shoes go on as slightly bigger shells and just hide them
  const FOOT = [0, -0.152, 0.018];   // legs ~20% longer: room for high-top cuffs below the body
  const feet = [];
  const legs = [-1, 1].map((s) => {
    const g = pivot(s < 0 ? 'chibi_leg_l' : 'chibi_leg_r', [s * 0.078, 0.02, 0]);
    g.add(part(new THREE.CapsuleGeometry(0.042, 0.087, 4, 10), col.body, [0, -0.073, 0]));
    const foot = part(new THREE.SphereGeometry(0.05, 14, 10), col.skin, FOOT, [1, 0.7, 1.35]);
    for (const t of [-1, 0, 1]) foot.add(part(new THREE.SphereGeometry(0.011, 8, 6), col.skin, [t * 0.022, 0.012, 0.043]));   // little toes
    g.add(foot);
    feet.push(foot);
    hips.add(g);
    return g;
  });

  // arms: shoulder hinge -> upper arm -> elbow hinge -> forearm + hand (20% longer than before)
  const ARM = { upper: 0.085, fore: 0.089 };
  const elbows = [];
  const arms = [-1, 1].map((s) => {
    const g = pivot(s < 0 ? 'chibi_arm_l' : 'chibi_arm_r', [s * 0.148, 0.17, 0]);
    g.rotation.z = s * 0.42;
    g.add(part(new THREE.CapsuleGeometry(0.034, 0.024, 4, 10), col.body, [0, -0.042, 0]));
    const el = pivot(s < 0 ? 'chibi_elbow_l' : 'chibi_elbow_r', [0, -ARM.upper, 0]);
    el.add(part(new THREE.SphereGeometry(0.033, 10, 8), col.body));                        // hides the seam when bent
    el.add(part(new THREE.CapsuleGeometry(0.031, 0.022, 4, 10), col.body, [0, -0.036, 0]));
    el.add(part(new THREE.SphereGeometry(0.039, 10, 8), col.skin, [0, -ARM.fore, 0]));
    g.add(el);
    elbows.push(el);
    hips.add(g);
    return g;
  });

  // head: big and round, on a neck pivot so it can lag, tilt and look around
  const neck = pivot('chibi_neck', [0, 0.235, 0]);
  hips.add(neck);
  const headR = CHIBI.headR;
  neck.add(part(new THREE.SphereGeometry(headR, 32, 24), col.skin, [0, headR * 0.92, 0], [1.06, 0.95, 1]));
  // round ears sticking out from the sides of the head: flat discs facing forward,
  // thin front-to-back, so they read as ears and keep the crown clear for hats
  for (const s of [-1, 1]) {
    const ear = pivot(s < 0 ? 'chibi_ear_l' : 'chibi_ear_r', [s * headR * 1.06, headR * 1.12, -0.01]);
    ear.rotation.set(0, -s * 0.35, s * -0.25);
    ear.add(part(new THREE.SphereGeometry(0.075, 20, 14), col.body, [s * 0.02, 0, 0], [1, 1, 0.32]));
    ear.add(part(new THREE.SphereGeometry(0.048, 16, 10), col.ear, [s * 0.02, 0, 0.018], [1, 1, 0.2]));
    neck.add(ear);
  }
  // face: dot eyes (blinkable), tiny mouth
  const eyes = [-1, 1].map((s) => {
    const e = part(new THREE.SphereGeometry(0.026, 12, 10), col.eye, [s * 0.075, headR * 0.98, headR * 0.93], [1, 1.25, 0.5], 0.3);
    e.add(part(new THREE.SphereGeometry(0.008, 6, 6), '#ffffff', [0.008, 0.011, 0.02], [1, 1, 1], 0.3));
    neck.add(e);
    return e;
  });
  const mouth = part(new THREE.TorusGeometry(0.016, 0.005, 6, 12, Math.PI), col.eye, [0, headR * 0.72, headR * 0.99]);
  mouth.rotation.z = Math.PI;
  neck.add(mouth);

  // anchors for wearables (match your categories)
  const anchors = {
    head: pivot('anchor_head', [0, headR * 1.78, 0]),
    face: pivot('anchor_face', [0, headR * 0.98, headR * 0.98]),
    back: pivot('anchor_back', [0, 0.17, -0.1]),
    neck: pivot('anchor_neck', [0, 0.235, 0]),
    hand_r: pivot('anchor_hand_r', [0, 0, 0]),
    foot_l: pivot('anchor_foot_l', FOOT),
    foot_r: pivot('anchor_foot_r', FOOT),
  };
  neck.add(anchors.head, anchors.face);
  hips.add(anchors.back, anchors.neck);
  // held items: the grip sits at the hand, on the forearm; the item inside it is kept mostly upright
  // (like you'd really carry a drink) and only leans a little with the arm
  const grip = pivot('chibi_grip_r', [0, -0.089, 0.012]);
  elbows[1].add(grip);
  grip.add(anchors.hand_r);
  anchors.hand_r.position.set(0, -0.012, 0.04);   // item sits just in front of the fist, hand wraps its side
  legs[0].add(anchors.foot_l);
  legs[1].add(anchors.foot_r);

  const _gq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _tq = new THREE.Quaternion(), _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _t = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
  // ---------------------------------------------------------------- procedural animation
  // Every frame builds a pose (a handful of joint angles), from movement first and then from an
  // emote if one is playing, blended in and out. Nothing here is keyframed or skinned.
  const st = { phase: 0, walk: 0, air: 0, land: 0, blink: 0, nextBlink: 2, lookT: 0, look: 0, t: 0, tilt: 0, emote: null, eT: 0, eW: 0 };
  const lerp = (a, b, k) => a + (b - a) * k;
  const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const pulse = (x, a, b) => sm((x - a) / 0.12) * (1 - sm((x - b) / 0.12));   // on between a and b, with soft edges

  // emotes: each returns joint targets for its local time e (seconds) and its length L
  const EMOTES = {
    wave: { L: 2.2, f: (e) => ({ armRz: 1.45, armRx: -0.25, elbowRx: 0.15, elbowRz: 1.25 + 0.4 * Math.sin(e * 12), armLz: -0.42, neckZ: 0.22, neckX: -0.08, mouthOpen: 1 }) },
    cheer: { L: 2.0, f: (e) => { const h = Math.abs(Math.sin(e * Math.PI * 2)); return { armLz: -1.9, armRz: 1.9, armLx: -0.3, armRx: -0.3, elbowLz: -0.5 - 0.5 * Math.abs(Math.sin(e * 9)), elbowRz: 0.5 + 0.5 * Math.abs(Math.sin(e * 9)), lift: h * 0.28, legLx: -0.4 * h, legRx: -0.4 * h, sy: 1 + 0.12 * h - 0.18 * (1 - h) * (1 - h), neckX: -0.25, mouthOpen: 1 }; } },
    dance: { L: 4.0, f: (e) => { const b = e * Math.PI * 3.2; return {
      hipZ: 0.22 * Math.sin(b), hipY: 0.03 * Math.abs(Math.sin(b)), armLz: -1.0 - 0.95 * Math.max(0, Math.sin(b)), armRz: 1.0 + 0.95 * Math.max(0, -Math.sin(b)),
      armLx: -0.5 * Math.cos(b), armRx: 0.5 * Math.cos(b), elbowLx: 1.2 + 0.4 * Math.sin(b), elbowRx: 1.2 - 0.4 * Math.sin(b), legLx: 0.45 * Math.max(0, Math.sin(b)), legRx: 0.45 * Math.max(0, -Math.sin(b)),
      neckZ: -0.25 * Math.sin(b), neckX: 0.12 * Math.sin(b * 2), sy: 1 - 0.06 * Math.abs(Math.cos(b)), mouthOpen: 1 }; } },
    spin: { L: 1.4, f: (e, L) => { const k = sm(e / L); return { spin: k * TAU * 2, armLz: -1.5, armRz: 1.5, lift: Math.sin(Math.PI * k) * 0.12, legLx: 0.3, legRx: -0.3, neckX: -0.15 }; } },
    flip: { L: 1.15, f: (e, L) => { const k = e / L, air = clamp((k - 0.18) / 0.62, 0, 1);
      const crouch = pulse(k, -0.2, 0.2) + pulse(k, 0.8, 1.2);
      return { flipX: -TAU * sm(air), lift: Math.sin(Math.PI * air) * 0.85, sy: 1 - 0.25 * crouch + 0.12 * Math.sin(Math.PI * air) * (1 - Math.sin(Math.PI * air)),
        armLz: -0.3 - 1.8 * Math.sin(Math.PI * air), armRz: 0.3 + 1.8 * Math.sin(Math.PI * air), legLx: -1.3 * Math.sin(Math.PI * air), legRx: -1.3 * Math.sin(Math.PI * air), neckX: 0.3 * Math.sin(Math.PI * air) }; } },
    sit: { L: Infinity, f: (e) => ({ hipY: -0.132, hipX: -0.12, legLx: -1.45, legRx: -1.45, legLz: 0.18, legRz: -0.18, armLx: -0.9, armRx: -0.9, armLz: -0.15, armRz: 0.15,
      neckX: -0.12 + 0.05 * Math.sin(e * 1.3), neckZ: 0.12 * Math.sin(e * 0.7) }) },
    bow: { L: 1.8, f: (e, L) => { const k = pulse(e / L, 0.12, 0.78); return { hipX: 0.75 * k, neckX: 0.35 * k, armLx: 0.25 * k, armRx: 0.25 * k, armLz: -0.15, armRz: 0.15 }; } },
    shrug: { L: 1.6, f: (e, L) => { const k = pulse(e / L, 0.1, 0.8); return { armLz: -0.55 * k - 0.42, armRz: 0.55 * k + 0.42, armLx: -0.2 * k, armRx: -0.2 * k, elbowLx: 1.5 * k, elbowRx: 1.5 * k, elbowLz: -0.7 * k, elbowRz: 0.7 * k, neckZ: 0.32 * k, lift: 0, sy: 1 - 0.05 * k, hipZ: 0.05 * k }; } },
    // new with elbows
    sip: { L: 2.6, f: (e, L) => { const k = pulse(e / L, 0.08, 0.85), gulp = Math.max(0, Math.sin(e * 9)) * k;
      return { armRx: -0.8 * k, armRz: 0.12 * k, elbowRx: 0.25 + 2.05 * k, neckX: -0.22 * k + 0.04 * gulp, hipX: -0.06 * k, sy: 1 + 0.015 * gulp, armLz: -0.42 }; } },
    proud: { L: 2.4, f: (e, L) => { const k = pulse(e / L, 0.1, 0.85);
      return { armLz: -0.75 * k - 0.42, armRz: 0.75 * k + 0.42, elbowLz: 1.6 * k, elbowRz: -1.6 * k, elbowLx: 0.3 * k, elbowRx: 0.3 * k, hipX: -0.12 * k, neckX: -0.22 * k, sy: 1 + 0.05 * k }; } },
    think: { L: 3.0, f: (e, L) => { const k = pulse(e / L, 0.08, 0.88);
      return { armRx: -0.5 * k, armRz: 0.1, elbowRx: 0.25 + 1.95 * k, elbowRz: -0.25 * k, armLx: -0.45 * k, armLz: 0.2 * k - 0.42 * (1 - k), elbowLx: 1.55 * k, elbowLz: 0.55 * k,
        neckZ: 0.25 * k, neckX: -0.1 * k + 0.05 * Math.sin(e * 2) * k, neckY: 0.2 * k }; } },
  };

  function emote(name) { if (!EMOTES[name]) return; st.emote = name; st.eT = 0; }

  function animate(dt, s) {
    // s: { speed, grounded, vy, landed }
    st.t += dt;
    const k = (rate) => 1 - Math.exp(-rate * dt);
    st.walk += (clamp(s.speed / 2.4, 0, 1) - st.walk) * k(10);
    st.air += ((s.grounded ? 0 : 1) - st.air) * k(14);
    st.phase += s.speed * dt * 7.5;
    if (s.landed) st.land = 1;
    st.land = Math.max(0, st.land - dt * 5);

    // ---- base pose from movement
    const w = st.walk * (1 - st.air), sw = Math.sin(st.phase), idle = 1 - st.walk;
    const stride = st.dress ? 0.5 : 0.75;   // little steps in the dress so the feet stay under the hem
    st.lookT -= dt;
    if (st.lookT <= 0) { st.look = (Math.random() - 0.5) * 1.1; st.tilt = (Math.random() - 0.5) * 0.4; st.lookT = 1.5 + Math.random() * 2.5; }
    const P = {
      elbowLx: 0.25 + 0.35 * w * Math.max(0, sw) + 0.5 * st.air, elbowRx: 0.25 + 0.35 * w * Math.max(0, -sw) + 0.5 * st.air, elbowLz: 0, elbowRz: 0,
      legLx: sw * stride * w - st.air * 0.5, legRx: -sw * stride * w - st.air * 0.2, legLz: 0, legRz: 0,
      armLx: -sw * 0.7 * w, armRx: sw * 0.7 * w, armLz: -0.42 - st.air * 1.45, armRz: 0.42 + st.air * 1.45,   // resting a little out from the body so sleeves clear the shirt
      hipY: Math.abs(Math.sin(st.phase)) * 0.028 * w, hipX: 0.12 * w + 0.15 * clamp(-s.vy / 8, -1, 1) * st.air, hipZ: Math.sin(st.phase) * 0.06 * w,
      neckX: -0.08 * w + Math.sin(st.phase * 2) * 0.03 * w, neckY: st.look * idle, neckZ: st.tilt * idle - Math.sin(st.phase) * 0.05 * w,
      lift: 0, spin: 0, flipX: 0, mouthOpen: 0,
      sy: 1 + 0.018 * Math.sin(st.t * 2.4) * idle * (1 - st.air) + st.air * clamp(Math.abs(s.vy) / 9, 0, 1) * 0.16 - Math.sin(st.land * Math.PI) * 0.26,
    };

    // ---- emote layer: moving or jumping cancels it (except mid-flip)
    if (st.emote) {
      const E = EMOTES[st.emote];
      st.eT += dt;
      const busy = st.emote === 'flip' && st.eT < E.L;
      if (!busy && (s.speed > 0.35 || !s.grounded)) st.emote = null;
      else if (st.eT >= E.L) st.emote = null;
    }
    st.eW += ((st.emote ? 1 : 0) - st.eW) * k(st.emote === 'flip' ? 40 : 9);
    if (st.eW > 0.001 && (st.emote || st.lastEmote)) {
      const name = st.emote || st.lastEmote, E = EMOTES[name];
      const T = E.f(Math.min(st.eT, isFinite(E.L) ? E.L : st.eT), E.L);
      // whole turns are the same as no turn, so blend spins/flips from their nearest equivalent angle
      for (const key of ['spin', 'flipX']) if (key in T) T[key] = wrap(T[key] + Math.PI, TAU) - Math.PI;
      for (const key in T) P[key] = lerp(P[key] ?? 0, T[key], st.eW);
      if (st.emote) st.lastEmote = st.emote;
    }

    // ---- apply
    legs[0].rotation.set(P.legLx, 0, P.legLz);
    legs[1].rotation.set(P.legRx, 0, P.legRz);
    arms[0].rotation.set(P.armLx, 0, P.armLz);
    arms[1].rotation.set(P.armRx, 0, P.armRz);
    elbows[0].rotation.set(-P.elbowLx, 0, P.elbowLz);   // elbowX = bend forward, elbowZ = swing in the arm's side plane
    elbows[1].rotation.set(-P.elbowRx, 0, P.elbowRz);
    hips.position.y = CHIBI.legH + P.hipY;
    hips.rotation.set(P.hipX, 0, P.hipZ);
    neck.rotation.x = P.neckX;
    neck.rotation.y += (P.neckY - neck.rotation.y) * k(st.emote ? 12 : 4);
    neck.rotation.z += (P.neckZ - neck.rotation.z) * k(st.emote ? 12 : 6);
    flip.position.y = FLIP_Y + P.lift;
    flip.rotation.set(P.flipX, P.spin, 0);
    mouth.scale.set(1 + 0.4 * P.mouthOpen, 1 + 1.4 * P.mouthOpen, 1);
    // blink
    st.nextBlink -= dt;
    if (st.nextBlink <= 0) { st.blink = 0.14; st.nextBlink = 2 + Math.random() * 3.5; }
    st.blink = Math.max(0, st.blink - dt);
    const happy = st.emote === 'cheer' || st.emote === 'dance' || st.emote === 'sip' || st.emote === 'proud' ? 0.45 : 1;   // squinty happy eyes
    for (const e of eyes) e.scale.y = (st.blink > 0 ? 0.15 : 1.25) * happy;
    // squash and stretch (constant volume)
    const sxz = 1 / Math.sqrt(P.sy);
    squash.scale.set(sxz, P.sy, sxz);
    // keep the held item upright-ish: blend world-up with the forearm's up, plus a small tilt
    // forward when carrying, tipping toward the face while sipping
    root.updateMatrixWorld(true);
    grip.getWorldQuaternion(_gq); root.getWorldQuaternion(_rq);
    _up.set(0, 1, 0).applyQuaternion(_gq);
    _fw.set(0, 0, 1).applyQuaternion(_rq);
    const sipping = st.emote === 'sip' ? st.eW : 0;
    _t.set(0, 1, 0).lerp(_up, 0.25).addScaledVector(_fw, 0.18 - 0.55 * sipping).normalize();
    _tq.setFromUnitVectors(_Y, _t).multiply(_rq);
    anchors.hand_r.quaternion.copy(_gq.invert().multiply(_tq));
  }
  // put on / take off a pair of shoes ({ l, r } groups) — null = barefoot
  // clothes: a garment is a list of [attach point, piece]; each piece rides the hinge it sits on
  const attach = { hips, neck, arm_upper_l: arms[0], arm_upper_r: arms[1], arm_lower_l: elbows[0], arm_lower_r: elbows[1], leg_l: legs[0], leg_r: legs[1] };
  // never naked. Male base = plain tee + shorts. Female base = the dress, worn as one full outfit:
  // put on any top or any bottom and the dress comes off, with the plain tee / shorts filling the other slot.
  const BW = chibiWearables();
  const DRESS = { top: BW.dress, bottom: { name: 'none', pieces: [] } }, PLAIN = { top: BW.baseTee, bottom: BW.baseShorts };   // the dress fills both slots
  const shown = { top: null, bottom: null }, chosen = { top: null, bottom: null };
  function put(slot, g) {
    if (shown[slot] === g) return;
    if (shown[slot]) for (const [at, obj] of shown[slot].pieces) attach[at].remove(obj);
    shown[slot] = g;
    for (const [at, obj] of g.pieces) attach[at].add(obj);
  }
  function refresh() {
    const dressOn = base === 'female' && !chosen.top && !chosen.bottom;
    st.dress = dressOn;
    for (const slot of ['top', 'bottom']) put(slot, dressOn ? DRESS[slot] : chosen[slot] || PLAIN[slot]);
  }
  function wear(slot, garment) { chosen[slot] = garment; refresh(); }   // null = back to the base outfit
  function setBase(b) { base = b; refresh(); }
  setBase(base);
  let shoes = null;
  function wearShoes(pair) {
    if (shoes) { anchors.foot_l.remove(shoes.l); anchors.foot_r.remove(shoes.r); }
    shoes = pair;
    if (shoes) { anchors.foot_l.add(shoes.l); anchors.foot_r.add(shoes.r); }
    for (const f of feet) f.visible = !shoes;
  }
  return { root, anchors, animate, emote, wearShoes, wear, setBase, get base() { return base; }, emotes: Object.keys(EMOTES), get playing() { return st.emote; }, colors: col, recolor(c) { for (const m of Object.values(mats)) if (m.color.getHexString() === new THREE.Color(col.body).getHexString()) m.color.set(c); col.body = c; } };
}

// ---------------------------------------------------------------- a few boba wearables sized for the chibi
const FIT = { SHORTS_END: -0.06, CUFF_TOP: -0.075, PANTS_END: -0.12, cuffR: 0.056 };

function chibiWearables() {
  const lerpN = (a, b, k) => a + (b - a) * k;
  const m = (c, r = 0.45) => new THREE.MeshStandardMaterial({ color: c, roughness: r, side: THREE.DoubleSide });
  const g = (name, parts) => { const o = new THREE.Group(); o.name = name; for (const p of parts) { p.castShadow = true; o.add(p); } return o; };
  const mesh = (geo, mt, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0]) => { const x = new THREE.Mesh(geo, mt); x.position.set(...p); x.scale.set(...s); x.rotation.set(...r); return x; };
  const pearl = m('#3a2118', 0.2), pink = m('#ff6f9c', 0.3), cup = m('#d9b38c'), white = m('#ffffff', 0.3), red = m('#d93a52'), leaf = m('#4ea83a');
  // a shoe is a shell a bit bigger than the bare foot (origin = foot centre), sole flush with the ground
  const shoe = (side, high) => {
    const upper = high ? red : m('#8fd0ff', 0.4), sole = white;
    const parts = [
      mesh(new THREE.SphereGeometry(0.058, 18, 12), upper, [0, 0.004, 0.004], [1.05, 0.74, 1.4]),
      mesh(new THREE.CylinderGeometry(0.056, 0.058, 0.02, 20), sole, [0, -0.027, 0.006], [1.06, 1, 1.42]),
      mesh(new THREE.SphereGeometry(0.035, 12, 8, 0, TAU, 0, Math.PI / 2), sole, [0, -0.012, 0.05], [1.2, 0.9, 0.9], [-0.25, 0, 0]),
      ...[0, 1].map((k) => mesh(new THREE.BoxGeometry(0.04, 0.007, 0.008), white, [0, 0.038 - k * 0.002, 0.02 - k * 0.018], [1, 1, 1], [-0.5, 0, 0])),
      mesh(new THREE.SphereGeometry(0.012, 8, 6), pearl, [side * 0.06, 0.008, -0.01]),   // little pearl on the outside of each shoe
    ];
    if (high) {
      // cuff wrapping the lower leg, a touch wider than the leg so the leg just fills it
      // centred on the leg axis (the foot anchor sits 0.018 forward), top kept below the shorts zone
      const zc = -0.018;
      parts.push(mesh(new THREE.CylinderGeometry(FIT.cuffR, FIT.cuffR + 0.002, 0.05, 18, 1, true), red, [0, 0.039, zc]));
      parts.push(mesh(new THREE.TorusGeometry(FIT.cuffR, 0.007, 6, 18), white, [0, 0.066, zc], [1, 1, 1], [Math.PI / 2, 0, 0]));
      parts.push(mesh(new THREE.CylinderGeometry(FIT.cuffR + 0.001, FIT.cuffR + 0.001, 0.01, 18, 1, true), white, [0, 0.03, zc]));
    }
    return parts;
  };
  // ---- FIT RULES for every leg wearable (leg-local y, leg radius 0.042), so new items never clip:
  //   pants / shorts tube radius 0.049-0.051, hem ring outer radius <= 0.057
  //   shorts must end at or above SHORTS_END; boots / high-top cuffs must top out at or below CUFF_TOP
  //   boot cuffs are open tubes of radius >= CUFF_R, centred on the leg axis, so long pants tuck inside them
  //   long pants end at PANTS_END: over a sneaker, inside a cuff
  // torso layering by padding over the body bean: pants 0.006 < base tee 0.014 = tee 0.014 < dress 0.012* < hoodie 0.022
  // (*the dress replaces both slots, so it never layers with anything)
  // ---- clothes: shells a touch bigger than the body part under them
  // body reference (hips-local): bean of radius 0.115, straight from y 0.075 to 0.145, widened 1.32x in x
  const BODY = { r: 0.115, y0: 0.075, y1: 0.145, sx: 1.32 };
  const torsoShell = (pad, yHem, mt, neckR = 0.055) => {
    const pts = [], r = BODY.r + pad;
    // hem -> lower curve -> straight -> shoulders -> neck opening
    for (let i = 0; i <= 6; i++) { const y = yHem + ((BODY.y0 - yHem) * i) / 6, dy = BODY.y0 - y; pts.push(new THREE.Vector2(Math.sqrt(Math.max(0, r * r - dy * dy)), y)); }
    pts.push(new THREE.Vector2(r, BODY.y1));
    for (let i = 1; i <= 10; i++) { const a = (i / 10) * Math.PI / 2, x = Math.cos(a) * r, y = BODY.y1 + Math.sin(a) * r; if (x < neckR) { pts.push(new THREE.Vector2(neckR, BODY.y1 + Math.sqrt(r * r - neckR * neckR))); break; } pts.push(new THREE.Vector2(x, y)); }
    const lathe = mesh(new THREE.LatheGeometry(pts, 32), mt);
    lathe.scale.set(BODY.sx, 1, 1);
    return lathe;
  };
  // radius of the bean (plus padding) at height y, so hems sit exactly on the shell
  const radAt = (y, pad) => { const r = BODY.r + pad; if (y < BODY.y0) return Math.sqrt(Math.max(0, r * r - (BODY.y0 - y) ** 2)); if (y > BODY.y1) return Math.sqrt(Math.max(0, r * r - (y - BODY.y1) ** 2)); return r; };
  const ring = (R0, tube, y, mt, sx = 1) => mesh(new THREE.TorusGeometry(R0, tube, 6, 32), mt, [0, y, 0], [sx, 1, 1], [Math.PI / 2, 0, 0]);
  const tube = (r0, r1, yTop, yBot, mt) => mesh(new THREE.CylinderGeometry(r0, r1, yTop - yBot, 18, 1, true), mt, [0, (yTop + yBot) / 2, 0]);
  const garment = (name, pieces) => ({ name, pieces: pieces.map(([at, objs]) => [at, g(`${name}_${at}`, objs)]) });
  function teeParts(plain = false) {
    const tee = m(plain ? '#f3f0ea' : '#ffffff', 0.6), trim = m(plain ? '#b9b2a8' : '#ff6f9c', 0.4);
    const torso = [torsoShell(0.014, 0.012, tee), ring(radAt(0.012, 0.014), 0.006, 0.012, trim, BODY.sx), ring(0.055, 0.008, BODY.y1 + Math.sqrt((BODY.r + 0.014) ** 2 - 0.055 ** 2), trim),
      ...(plain ? [] : [
      // boba print on the chest: a cup with pearls
      mesh(new THREE.CylinderGeometry(0.03, 0.024, 0.055, 16), m('#d9b38c', 0.5), [0, 0.12, 0.128], [1, 1, 0.25]),
      mesh(new THREE.SphereGeometry(0.031, 14, 6, 0, TAU, 0, Math.PI / 2), m('#ffffff', 0.4), [0, 0.148, 0.127], [1, 1, 0.25]),
      ...[-1, 0, 1].map((k) => mesh(new THREE.SphereGeometry(0.008, 8, 6), pearl, [k * 0.012, 0.102, 0.136 - Math.abs(k) * 0.001]))])];
    const sleeve = () => [tube(0.043, 0.047, 0.016, -0.055, tee), mesh(new THREE.SphereGeometry(0.043, 14, 8, 0, TAU, 0, Math.PI / 2), tee, [0, 0.016, 0]), ring(0.047, 0.006, -0.055, trim)];
    return [['hips', torso], ['arm_upper_l', sleeve()], ['arm_upper_r', sleeve()]];
  }
  function hoodieParts() {
    const fab = m('#c9a6e4', 0.75), dark = m('#9f7fc4', 0.75), cord = m('#ffffff', 0.5);
    const torso = [torsoShell(0.022, 0.0, fab, 0.06), ring(radAt(0.0, 0.022), 0.011, 0.0, dark, BODY.sx),
      // kangaroo pocket + hood bunched behind the neck + drawstrings
      mesh(new THREE.BoxGeometry(0.14, 0.055, 0.02), dark, [0, 0.06, 0.13], [1, 1, 1], [0.12, 0, 0]),
      mesh(new THREE.TorusGeometry(0.075, 0.034, 10, 24), fab, [0, 0.255, -0.02], [1.25, 1, 1], [Math.PI / 2 + 0.35, 0, 0]),
      mesh(new THREE.SphereGeometry(0.07, 16, 10), fab, [0, 0.27, -0.085], [1.4, 0.8, 0.6]),
      ...[-1, 1].map((sx) => mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 6), cord, [sx * 0.03, 0.2, 0.128])),
      ...[-1, 1].map((sx) => mesh(new THREE.SphereGeometry(0.007, 6, 6), cord, [sx * 0.03, 0.168, 0.129]))];
    const upper = () => [tube(0.045, 0.045, 0.016, -0.085, fab), mesh(new THREE.SphereGeometry(0.045, 14, 8, 0, TAU, 0, Math.PI / 2), fab, [0, 0.016, 0])];
    const lower = () => [mesh(new THREE.SphereGeometry(0.044, 14, 10), fab), tube(0.042, 0.043, 0, -0.068, fab), ring(0.043, 0.01, -0.068, dark)];
    return [['hips', torso], ['arm_upper_l', upper()], ['arm_upper_r', upper()], ['arm_lower_l', lower()], ['arm_lower_r', lower()]];
  }
  function pantsParts(long, plain = false) {
    const fab = plain ? m('#7d9cc9', 0.8) : long ? m('#5b78ad', 0.8) : m('#ffc2a8', 0.7), seam = plain ? m('#6585b3', 0.8) : long ? m('#e8b35a', 0.6) : m('#ff6f9c', 0.5);
    // seat: wraps the bottom of the bean so legs never show a gap at the top
    const seatPts = [];
    const r = BODY.r + 0.006;
    for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i / 10) * (Math.PI / 2), x = Math.cos(a) * r, y = BODY.y0 + Math.sin(a) * r; seatPts.push(new THREE.Vector2(Math.max(x, 0.001), y)); }
    seatPts.push(new THREE.Vector2(r, 0.095));
    const seat = mesh(new THREE.LatheGeometry(seatPts, 32), fab); seat.scale.set(BODY.sx, 1, 1);
    const hips = [seat, ring(r, 0.007, 0.095, seam, BODY.sx), ...(plain ? [] : [mesh(new THREE.BoxGeometry(0.018, 0.012, 0.01), seam, [0, 0.085, r + 0.004])])];
    const bottom = long ? FIT.PANTS_END : FIT.SHORTS_END;
    const leg = () => long ? [tube(0.05, 0.049, 0.025, bottom, fab), ring(0.049, 0.005, bottom, seam)] : [tube(0.05, 0.051, 0.025, bottom, fab), ring(0.051, 0.006, bottom, seam)];
    return [['hips', hips], ['leg_l', leg()], ['leg_r', leg()]];
  }
  // base dress: ONE shell from neckline to a flared hem — a long, flared-out t-shirt — plus puff sleeves
  function dressParts() {
    const fab = m('#ffb3cf', 0.7), trim = m('#ffffff', 0.5), dot = m('#ff6f9c', 0.5);
    const pad = 0.012, r = BODY.r + pad, HEM = { y: -0.085, r: 0.205 }, WAIST = 0.075;   // wide bell so the feet stay inside
    const flareR = (y) => r + (HEM.r - r) * Math.pow((WAIST - y) / (WAIST - HEM.y), 1.5);   // waist -> hem
    const pts = [];
    for (let i = 0; i <= 10; i++) { const y = HEM.y + ((WAIST - HEM.y) * i) / 10; pts.push(new THREE.Vector2(flareR(y), y)); }
    pts.push(new THREE.Vector2(r, BODY.y1));
    const neckR = 0.055;
    for (let i = 1; i <= 10; i++) { const a = (i / 10) * Math.PI / 2, x = Math.cos(a) * r, y = BODY.y1 + Math.sin(a) * r; if (x < neckR) { pts.push(new THREE.Vector2(neckR, BODY.y1 + Math.sqrt(r * r - neckR * neckR))); break; } pts.push(new THREE.Vector2(x, y)); }
    const shell = mesh(new THREE.LatheGeometry(pts, 40), fab);
    shell.scale.set(BODY.sx, 1, 1);
    const collarY = BODY.y1 + Math.sqrt(r * r - neckR * neckR);
    const parts = [shell, ring(neckR, 0.009, collarY, trim), ring(HEM.r, 0.008, HEM.y, trim, BODY.sx),
      mesh(new THREE.TorusGeometry(0.012, 0.006, 6, 12), trim, [-0.013, 0.215, 0.1], [1, 1, 1], [0, 0.3, 0.7]),
      mesh(new THREE.TorusGeometry(0.012, 0.006, 6, 12), trim, [0.013, 0.215, 0.1], [1, 1, 1], [0, -0.3, -0.7]),
      mesh(new THREE.SphereGeometry(0.008, 8, 6), trim, [0, 0.215, 0.106])];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU, y = -0.04, rr = flareR(y) + 0.002;
      parts.push(mesh(new THREE.SphereGeometry(0.009, 8, 6), dot, [Math.sin(a) * rr * BODY.sx, y, Math.cos(a) * rr], [1, 1, 0.4], [0, a, 0]));
    }
    const sleeve = () => [mesh(new THREE.SphereGeometry(0.047, 14, 8, 0, TAU, 0, Math.PI / 2), fab, [0, 0.012, 0], [1, 0.9, 1]), tube(0.047, 0.05, 0.012, -0.03, fab), ring(0.05, 0.006, -0.03, trim)];
    return [['hips', parts], ['arm_upper_l', sleeve()], ['arm_upper_r', sleeve()]];
  }
  const shoePair = (name, high) => ({ name, l: g(name + '_l', shoe(-1, high)), r: g(name + '_r', shoe(1, high)) });
  return {
    hat: g('wearable_hat_boba_cup_hat', [
      mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.15, 24), cup, [0, 0.06, 0]),
      mesh(new THREE.SphereGeometry(0.112, 24, 8, 0, TAU, 0, Math.PI / 2), white, [0, 0.135, 0]),
      mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 10), pink, [0.03, 0.24, 0], [1, 1, 1], [0, 0, -0.3]),
      ...[0, 1, 2, 3].map((k) => mesh(new THREE.SphereGeometry(0.022, 10, 8), pearl, [Math.sin(k * 1.6) * 0.06, 0.0, Math.cos(k * 1.6) * 0.06])),
    ]),
    cap: g('wearable_hat_lychee_shell_cap', [
      mesh(new THREE.SphereGeometry(0.2, 24, 10, 0, TAU, 0, Math.PI / 2), red, [0, -0.05, 0], [1.1, 0.8, 1.1]),
      mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.06, 6), m('#8c5a3a'), [0, 0.13, 0]),
      mesh(new THREE.SphereGeometry(0.04, 10, 6), leaf, [0.035, 0.155, 0], [1.6, 0.25, 0.8], [0, 0, -0.5]),
    ]),
    shades: g('wearable_glasses_boba_pearl_shades', [
      mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 20), pearl, [-0.072, 0, 0.012], [1, 1, 1], [Math.PI / 2, 0, 0]),
      mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 20), pearl, [0.072, 0, 0.012], [1, 1, 1], [Math.PI / 2, 0, 0]),
      mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), pink, [0, 0.015, 0.012]),
    ]),
    baseTee: garment('base_shirt_plain_tee', teeParts(true)),
    baseShorts: garment('base_pants_plain_shorts', pantsParts(false, true)),
    dress: garment('base_dress', dressParts()),
    tee: garment('wearable_shirt_boba_tee', teeParts()),
    hoodie: garment('wearable_shirt_taro_hoodie', hoodieParts()),
    jeans: garment('wearable_pants_milk_tea_jeans', pantsParts(true)),
    shorts: garment('wearable_pants_lychee_shorts', pantsParts(false)),
    sneakers: shoePair('wearable_shoes_boba_sneakers', false),
    hightops: shoePair('wearable_shoes_lychee_high_tops', true),
    tea: g('wearable_held_lychee_boba_tea', [
      mesh(new THREE.CylinderGeometry(0.045, 0.036, 0.12, 16), m('#ffd6e0'), [0, 0.0, 0.0]),
      mesh(new THREE.SphereGeometry(0.046, 16, 6, 0, TAU, 0, Math.PI / 2), white, [0, 0.06, 0]),
      mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6), pink, [0.01, 0.11, 0], [1, 1, 1], [0, 0, -0.25]),
      ...[0, 1, 2].map((k) => mesh(new THREE.SphereGeometry(0.014, 8, 6), pearl, [Math.sin(k * 2.1) * 0.022, -0.045, Math.cos(k * 2.1) * 0.022])),
    ]),
  };
}

// ---------------------------------------------------------------- player controller (stand-in for your engine's capsule movement)
function makePlayer(scene, getBouncers) {
  const chibi = makeChibi();
  scene.add(chibi.root);
  // the physics capsule (hidden) — this is what your engine already moves and syncs
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(CHIBI.capR, CHIBI.capLen, 4, 8), new THREE.MeshBasicMaterial({ color: '#6366f1', wireframe: true }));
  capsule.visible = false;
  scene.add(capsule);

  const P = { x: 0, y: 0.1, z: CUP.r + 10.5, vx: 0, vz: 0, vy: 0, yaw: Math.PI, grounded: true, wasGrounded: true };
  const keys = new Set();
  const input = { x: 0, z: 0, jump: false };
  addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') { if (!e.repeat) input.jump = true; e.preventDefault(); } });
  addEventListener('keyup', (e) => keys.delete(e.code));

  const floorAt = (x, z) => {
    const d = Math.hypot(x, z);
    if (d < CUP.r) return CUP.floor;
    if (Math.abs(x) < 1.8 && z > CUP.r && z < MAP.edgeR) return 0.1;
    return 0;
  };
  const cupInner = (y) => CUP.r + (1.2 * clamp(y, 0, CUP.h)) / CUP.h;

  let enabled = true;   // false = ignore input (menus); he still stands, breathes and blinks
  function step(dt, camYaw, joy) {
    // input relative to the camera
    let ix = enabled ? (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joy.x : 0;
    let iz = enabled ? (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) + joy.z : 0;
    if (!enabled) { input.jump = false; joy.jump = false; }
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    const c = Math.cos(camYaw), s = Math.sin(camYaw);
    const wx = ix * c + iz * s, wz = -ix * s + iz * c;
    const speed = 2.4, accel = P.grounded ? 14 : 5;
    P.vx += (wx * speed - P.vx) * (1 - Math.exp(-accel * dt));
    P.vz += (wz * speed - P.vz) * (1 - Math.exp(-accel * dt));
    if ((input.jump || joy.jump) && P.grounded) { P.vy = 10; P.grounded = false; }   // peak ~2.7–3.0 (low–high fps): always clears the highest any boba ever hops (2.47)
    input.jump = false; joy.jump = false;
    // Mario-style jump: hold for the full height, let go early for a short hop, and fall faster than you rise
    const held = enabled && (keys.has('Space') || joy.held);
    const grav = P.vy < 0 ? 16 * 1.75 : held ? 16 : 16 * 3.4;
    P.vy = Math.max(-18, P.vy - grav * dt);

    const px = P.x, pz = P.z, prevD = Math.hypot(px, pz);
    P.x += P.vx * dt; P.z += P.vz * dt; P.y += P.vy * dt;

    // cup wall (glass) with a doorway at the front
    let d = Math.hypot(P.x, P.z);
    const a = Math.atan2(P.x, P.z), inDoor = Math.abs(a) < CUP.door - CHIBI.capR / CUP.r && P.y < CUP.doorH - 0.8;
    const rW = cupInner(P.y);
    if (!inDoor && P.y < CUP.h + 0.1) {
      if (prevD < rW && d > rW - CHIBI.capR) { P.x *= (rW - CHIBI.capR) / d; P.z *= (rW - CHIBI.capR) / d; }
      else if (prevD >= rW && d < rW + CHIBI.capR) { P.x *= (rW + CHIBI.capR) / d; P.z *= (rW + CHIBI.capR) / d; }
    }
    d = Math.hypot(P.x, P.z);
    if (d > MAP.edgeR - CHIBI.capR) { P.x *= (MAP.edgeR - CHIBI.capR) / d; P.z *= (MAP.edgeR - CHIBI.capR) / d; }

    // floor
    const f = floorAt(P.x, P.z);
    P.wasGrounded = P.grounded;
    if (P.y <= f) { P.y = f; P.vy = 0; P.grounded = true; } else if (P.y > f + 0.02) P.grounded = false;

    // bouncers: bump off their sides, and get launched if you land on top of one
    let launched = false;
    P.bounced = -1;
    let bi = -1;
    for (const b of getBouncers()) {
      bi++;
      const o = b.o, r = b.r * o.scale.x, top = o.position.y + 2 * b.r * 0.96 * o.scale.y;
      const dx = P.x - o.position.x, dz = P.z - o.position.z, dh = Math.hypot(dx, dz);
      if (dh > r + CHIBI.capR) continue;
      if (P.vy <= 0 && P.y > top - 0.3 && P.y < top + 0.15 && dh < r * 0.95) {
        P.y = top; P.vy = 8.6; P.grounded = false; launched = true; P.bounced = b.id ?? bi;
      } else if (P.y < top - 0.3) {
        const push = (r + CHIBI.capR - dh) / (dh || 1);
        P.x += dx * push; P.z += dz * push;
      }
    }

    // face the direction of travel, swinging round smoothly
    const hs = Math.hypot(P.vx, P.vz);
    if (hs > 0.15) {
      const target = Math.atan2(P.vx, P.vz);
      let dy = wrap(target - P.yaw + Math.PI, TAU) - Math.PI;
      P.yaw += dy * (1 - Math.exp(-12 * dt));
    }
    capsule.position.set(P.x, P.y + CHIBI.capR + CHIBI.capLen / 2, P.z);
    chibi.root.position.set(P.x, P.y, P.z);
    chibi.root.rotation.set(0, P.yaw, 0);
    chibi.animate(dt, { speed: hs, grounded: P.grounded, vy: P.vy, landed: (P.grounded && !P.wasGrounded) || launched });
    return P;
  }
  function reset(x, z, yaw) {
    Object.assign(P, { x, y: 0.1, z, vx: 0, vz: 0, vy: 0, yaw, grounded: true, wasGrounded: true, bounced: -1 });
    keys.clear();
  }
  return { chibi, capsule, P, step, reset, set enabled(v) { enabled = v; if (!v) keys.clear(); }, get enabled() { return enabled; } };
}


// ================================================================ DEMO
// ---------------------------------------------------------------- Boba Bounce — the game
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
{
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
  const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#5fb8f5'); gr.addColorStop(0.55, '#a9e0ff'); gr.addColorStop(1, '#fde6ef');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}
scene.add(new THREE.HemisphereLight('#e2f3ff', '#9ccf7a', 1.2));
const sun = new THREE.DirectionalLight('#fff3dc', 2.6);
sun.position.set(25, 45, 30); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 140 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun);
const root = buildWorld();
scene.add(root);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 600);

// bouncers run on the clock; the player can bump into them or bounce off their heads
const bound = [];
for (const e of ANIMATIONS) { const o = root.getObjectByName(e.name); if (o) bound.push({ e, o }); }
const bouncerList = bound.map((b, i) => ({ o: b.o, r: BOUNCERS[i].r, id: i, alive: true, deadAt: 0 }));
// one landing pops a bouncer: it squashes flat and vanishes, then grows back a while later
const POP_TIME = 0.32, RESPAWN = 15, GROW = 0.5;
let gameClock = 0;
const aliveBouncers = () => bouncerList.filter((b) => b.alive);
function popBouncer(b) { b.alive = false; b.deadAt = gameClock; }
function reviveAll() { for (const b of bouncerList) { b.alive = true; b.deadAt = -99; b.o.visible = true; } }
// runs after the driver each frame: layers the pop / regrow on top of the normal hop
function applyLife() {
  for (const b of bouncerList) {
    const since = gameClock - b.deadAt;
    if (!b.alive) {
      if (since < POP_TIME) { const k = since / POP_TIME; b.o.scale.set(b.o.scale.x * (1 + 0.9 * k), b.o.scale.y * (1 - 0.85 * k), b.o.scale.z * (1 + 0.9 * k)); b.o.visible = true; }
      else b.o.visible = false;
      if (since > RESPAWN) b.alive = true;
    } else if (since > RESPAWN && since < RESPAWN + GROW) {
      const k = (since - RESPAWN) / GROW, g = Math.max(0.001, k * k * (3 - 2 * k) * (1 + 0.25 * Math.sin(k * Math.PI)));
      b.o.visible = true; b.o.scale.multiplyScalar(g);
    } else b.o.visible = true;
  }
}

// the base player: plain tee + shorts, barefoot, nothing else
const player = makePlayer(scene, aliveBouncers);

// ---- blob shadows: a soft dark disc straight under every bouncer and the player, always visible
// from any angle. They shrink and fade as things rise, which also shows how high a jump is.
// The real sun shadows stay on for the cup, trees and sign; the bouncers and player stop casting
// them so nothing gets a double shadow.
const blobTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.32)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
})();
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const blobs = new THREE.InstancedMesh(blobGeo, blobMat, bouncerList.length + 1);
blobs.frustumCulled = false; blobs.renderOrder = 1;
scene.add(blobs);
for (const b of bouncerList) b.o.traverse((m) => { m.castShadow = false; });
player.chibi.root.traverse((m) => { m.castShadow = false; });
const groundAt = (x, z) => (Math.hypot(x, z) < CUP.r ? CUP.floor : Math.abs(x) < 1.8 && z > CUP.r && z < MAP.edgeR ? 0.1 : 0) + 0.012;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function placeBlob(i, x, z, height, size) {
  const k = 1 / (1 + Math.max(0, height) * 1.4);                 // higher = smaller
  const d = size * (0.55 + 0.45 * k);
  _m.compose(_p.set(x, groundAt(x, z), z), _q, _s.set(d, 1, d));
  blobs.setMatrixAt(i, _m);
}

// ---------------------------------------------------------------- game state
const ROUND = 120;                         // seconds
const START = { x: 0, z: 0, yaw: Math.PI };   // centre of the pit
let state = 'menu';                        // menu -> countdown -> play -> over
let score = 0, timeLeft = ROUND, countdown = 0, best = 0;
try { best = parseInt(localStorage.getItem('bobaBounceBest') || '0', 10) || 0; } catch (e) {}
const $ = (id) => document.getElementById(id);
const ui = { tip: $('tip'), menu: $('menu'), over: $('over'), hud: $('hud'), time: $('time'), score: $('score'), count: $('count'), final: $('final'), best: $('best'), menuBest: $('menuBest'), pops: $('pops'), newBest: $('newBest') };
const show = (el, on) => el.classList.toggle('hidden', !on);
function refreshMenuBest() { ui.menuBest.textContent = best ? `Best: ${best}` : ''; }
refreshMenuBest();

// ---------------------------------------------------------------- little sounds (made on the fly, no files)
let actx = null;
function sound(kind) {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    if (kind === 'boing') { o.type = 'sine'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(720, t + 0.12); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.start(t); o.stop(t + 0.24); }
    else if (kind === 'tick') { o.type = 'triangle'; o.frequency.setValueAtTime(880, t); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09); o.start(t); o.stop(t + 0.1); }
    else if (kind === 'go') { o.type = 'triangle'; o.frequency.setValueAtTime(660, t); o.frequency.setValueAtTime(990, t + 0.1); g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); o.start(t); o.stop(t + 0.36); }
    else if (kind === 'pop') { o.type = 'square'; o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.06); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07); o.start(t); o.stop(t + 0.08); }
    else if (kind === 'end') { o.type = 'triangle'; o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.6); g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.65); o.start(t); o.stop(t + 0.66); }
  } catch (e) {}
}

// ---------------------------------------------------------------- 2D boba bouncers for the menus
function fillBobas(el, n, seed) {
  for (let i = 0; i < n; i++) {
    const r = (k) => { const x = Math.sin((i + 1) * 12.9898 * (k + seed)) * 43758.5453; return x - Math.floor(x); };
    const s = 30 + r(1) * 26, d = el.clientWidth || 380;
    const bb = document.createElement('div'); bb.className = 'bb blink';
    bb.style.cssText = `--s:${s}px;--x:${((i + 0.5) / n) * 100}%;margin-left:${-s / 2}px;--d:${0.75 + r(2) * 0.5}s;--dl:${-r(3) * 1.2}s;--h:${26 + r(4) * 36}px`;
    bb.innerHTML = '<i></i><b></b><b></b>';
    el.appendChild(bb);
  }
}
{ const fit = Math.max(4, Math.min(7, Math.floor((Math.min(innerWidth, 440) - 60) / 52))); fillBobas($('menuBobas'), fit, 1); fillBobas($('overBobas'), Math.min(5, fit), 7); }
$('controls').textContent = matchMedia('(pointer: coarse)').matches ? 'Joystick to run · JUMP to hop · land on boba to score' : 'WASD to run · Space to jump · land on boba to score';

// ---------------------------------------------------------------- flow
function toMenu() {
  state = 'menu'; player.enabled = false;
  show(ui.menu, true); show(ui.over, false); show(ui.hud, false); document.body.classList.remove('playing');
  refreshMenuBest();
}
function startGame() {
  player.reset(START.x, START.z, START.yaw);
  reviveAll();
  camYaw = 0; camPitch = 0.42; camDistGoal = 3.6;
  score = 0; timeLeft = ROUND; countdown = 3; lastCount = 0; ui.count.textContent = '';
  ui.score.textContent = '0'; ui.time.textContent = fmt(ROUND); ui.time.classList.remove('low');
  show(ui.menu, false); show(ui.over, false); show(ui.hud, true); show(ui.count, true); show(ui.tip, true);
  document.body.classList.add('playing');
  state = 'countdown'; player.enabled = false;
}
function endGame() {
  show(ui.tip, false);
  state = 'over'; player.enabled = false; sound('end');
  const isBest = score > best;
  if (isBest) { best = score; try { localStorage.setItem('bobaBounceBest', String(best)); } catch (e) {} }
  ui.final.textContent = score; ui.best.textContent = `Best: ${best}`; show(ui.newBest, isBest && score > 0);
  show(ui.over, true); show(ui.hud, false); document.body.classList.remove('playing');
}
$('play').onclick = () => startGame();
$('again').onclick = () => startGame();
$('exit').onclick = () => { reviveAll(); toMenu(); };
addEventListener('keydown', (e) => {
  if (e.code !== 'Enter' && e.code !== 'Space') return;
  if (state === 'menu' || state === 'over') { e.preventDefault(); startGame(); }
});
const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let lastCount = 4;

function scorePop(bi) {
  score++; ui.score.textContent = score; sound('boing'); sound('pop');
  popBouncer(bouncerList[bi]);
  ui.score.parentElement.classList.remove('bump'); void ui.score.parentElement.offsetWidth; ui.score.parentElement.classList.add('bump');
  // "+1" floats up from the bouncer you landed on
  const o = bouncerList[bi].o.position, v = new THREE.Vector3(o.x, o.y + 1.1, o.z).project(camera);
  if (v.z > 1) return;
  const el = document.createElement('div'); el.className = 'pop'; el.textContent = '+1';
  el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  ui.pops.appendChild(el); setTimeout(() => el.remove(), 900);
}

// emotes on the number keys while playing
addEventListener('keydown', (e) => {
  if (state !== 'play' || !/^[0-9]$/.test(e.key)) return;
  const n = e.key === '0' ? 10 : parseInt(e.key, 10);
  if (n <= player.chibi.emotes.length) player.chibi.emote(player.chibi.emotes[n - 1]);
});

// ---------------------------------------------------------------- touch controls (touch screens, during play only)
const touch = matchMedia('(pointer: coarse)').matches;
const joy = { x: 0, z: 0, jump: false, held: false };
if (touch) {
  document.body.classList.add('touch');
  const pad = $('pad'), knob = $('knob');
  let id = null, cx = 0, cy = 0;
  const move = (e) => { if (e.pointerId !== id) return; let dx = (e.clientX - cx) / 45, dy = (e.clientY - cy) / 45; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } joy.x = dx; joy.z = dy; knob.style.transform = `translate(${dx * 32}px, ${dy * 32}px)`; };
  pad.addEventListener('pointerdown', (e) => { id = e.pointerId; const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; pad.setPointerCapture(id); move(e); });
  pad.addEventListener('pointermove', move);
  const end = (e) => { if (e.pointerId !== id) return; id = null; joy.x = joy.z = 0; knob.style.transform = ''; };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  const jb = $('jump');
  jb.addEventListener('pointerdown', (e) => { joy.jump = true; joy.held = true; jb.setPointerCapture(e.pointerId); e.preventDefault(); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) jb.addEventListener(ev, () => { joy.held = false; });
}

// ---------------------------------------------------------------- camera: drag to look, wheel / pinch to zoom
let camYaw = 0, camPitch = 0.42, camDist = 3.6, camDistGoal = 3.6, lastX = 0, lastY = 0;
const ZOOM = { min: 1.6, max: 10 };
const touches = new Map();
let pinchStart = 0, pinchDist0 = 0;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastX = e.clientX; lastY = e.clientY;
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinchStart = Math.hypot(a.x - b.x, a.y - b.y); pinchDist0 = camDistGoal; }
});
addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size >= 2) { const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinchStart > 10) camDistGoal = clamp(pinchDist0 * (pinchStart / d), ZOOM.min, ZOOM.max); return; }
  camYaw -= (e.clientX - lastX) * 0.006; camPitch = clamp(camPitch + (e.clientY - lastY) * 0.004, 0.12, 1.2);
  lastX = e.clientX; lastY = e.clientY;
});
const lift = (e) => { if (!touches.delete(e.pointerId)) return; if (touches.size === 1) { const [a] = [...touches.values()]; lastX = a.x; lastY = a.y; } };
addEventListener('pointerup', lift); addEventListener('pointercancel', lift);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); camDistGoal = clamp(camDistGoal * Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), ZOOM.min, ZOOM.max); }, { passive: false });

// ---------------------------------------------------------------- loop
let last = performance.now();
const t0 = performance.now();
const camPos = new THREE.Vector3(0, 3, CUP.r + 13), camLook = new THREE.Vector3();
toMenu();
function frame() {
  const now = performance.now(), realDt = Math.min(0.25, (now - last) / 1000), dt = Math.min(0.05, realDt); last = now;   // clock runs on real time; physics steps stay small
  const t = (now - t0) / 1000;
  gameClock += realDt;
  for (const b of bound) b.e.update(b.o, t);
  applyLife();

  if (state === 'countdown') {
    countdown -= realDt;
    const n = Math.ceil(countdown);
    if (n !== lastCount) { lastCount = n; ui.count.textContent = n > 0 ? n : 'GO!'; ui.count.classList.remove('beat'); void ui.count.offsetWidth; ui.count.classList.add('beat'); sound(n > 0 ? 'tick' : 'go'); }
    if (countdown <= 0) { state = 'play'; player.enabled = true; setTimeout(() => { show(ui.count, false); show(ui.tip, false); }, 900); }
  } else if (state === 'play') {
    timeLeft -= realDt;
    ui.time.textContent = fmt(timeLeft);
    ui.time.classList.toggle('low', timeLeft <= 10);
    if (timeLeft <= 0) endGame();
  }

  const P = player.step(dt, camYaw, joy);
  if (state === 'play' && P.bounced >= 0) scorePop(P.bounced);
  bouncerList.forEach((b, i) => { const o = b.o.position; placeBlob(i, o.x, o.z, o.y - CUP.floor, b.o.visible ? b.r * 2.4 * Math.min(1, b.o.scale.x) : 0); });
  placeBlob(bouncerList.length, P.x, P.z, P.y - groundAt(P.x, P.z) + 0.012, 0.62);
  blobs.instanceMatrix.needsUpdate = true;

  if (state === 'menu') {
    // slow fly-around of the cup behind the menu
    const a = t * 0.08;
    camPos.lerp(new THREE.Vector3(Math.sin(a) * 30, 15, Math.cos(a) * 30), 1 - Math.exp(-2 * dt));
    camLook.lerp(new THREE.Vector3(0, 1.5, 0), 1 - Math.exp(-2 * dt));
  } else {
    camDist += (camDistGoal - camDist) * (1 - Math.exp(-10 * dt));
    const want = new THREE.Vector3(P.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist, P.y + 0.5 + Math.sin(camPitch) * camDist, P.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist);
    camPos.lerp(want, 1 - Math.exp(-(state === 'countdown' ? 4 : 8) * dt));
    camLook.lerp(new THREE.Vector3(P.x, P.y + 0.45, P.z), 1 - Math.exp(-12 * dt));
  }
  camera.position.copy(camPos); camera.lookAt(camLook);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });