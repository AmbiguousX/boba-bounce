// export_flappy_jack.mjs: Flappy Jack for Boba Bounce, from the rig in the test1 repo (film/rigs/flappy-jack).
//   TEST1_REPO=/path/to/test1 node tools/export_flappy_jack.mjs [out.glb, default game/assets/flappy-jack.glb]     (needs Playwright + Chromium)
// A copy of test1's export_glb.mjs with three changes: no arms, the eyes exported from their rivets on the skin
// (the rig moved them off the pancake bones, which broke the original exporter), and only the clips the game uses.
// It opens the rig page headless and bakes clips by running the real simulation at 30 fps.
// simulation (springs, arms, face) and sampling it at 30 fps, then saves the GLB with three's GLTFExporter.
//
// What's in the file:
//   Stack     one skinned mesh, 6 pancake bones (Pancake_0 = top), the 10 mouth blend shapes, vertex colours
//   Arm_L/R   skinned tubes on 6-bone chains (ArmL_0 .. ArmL_5) from Root (at the shoulders, so the squash can't skew them), toasted knob spheres, fists
//   Tongue    the flat, grooved strap, skinned to a 13-bone chain (Tongue_0 .. Tongue_12) from Root, starting in the mouth
//   face      eyes, pupils, lids, brows on Pancake_1; glaze and butter on Pancake_0
//   Root      a bone carrying the body's motion (hops, leans, root motion when walking)
//   clips     Idle, Talk, Scheme, Cackle, UhOh, Scream, Tantrum, Raspberry, LickLips, Eat, Bliss, CrutchWalk, SwingJump, Boing
// Not in it: the pancake lace and bumps (they're a triplanar shader, and the stack has no UVs), the syrup runs, Jill's look.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');   // (require honours NODE_PATH, where a global Playwright lives)
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(process.env.TEST1_REPO || path.join(here, '../../test1'));   // the test1 checkout that holds film/rigs/flappy-jack
const out = path.resolve(process.argv[2] || path.join(here, '../game/assets/flappy-jack.glb'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  const f = path.join(repo, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(repo) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ proxy, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`http://127.0.0.1:${port}/film/rigs/flappy-jack/flappy-jack.html?ui=0&follow=0`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__rig);

const b64 = await page.evaluate(async () => {
  const THREE = await import('three');
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const R = window.__rig, J = R.J, I = R.info, FPS = 30, STEPS = 120 / FPS;
  R.setPause(true);
  const V = () => new THREE.Vector3(), lerp = (a, b, t) => a + (b - a) * t;

  // ---------------------------------------------------------------- the export rig, in its bind pose
  const top = new THREE.Group(); top.name = 'FlappyJack';
  const rootB = new THREE.Bone(); rootB.name = 'Root'; top.add(rootB);
  const pancakes = J.bones.map((b, k) => { const n = new THREE.Bone(); n.name = 'Pancake_' + k; n.position.set(0, I.ycOf(k), 0); rootB.add(n); return n; });
  // the stack: same geometry (positions, normals, colours, skin weights, blend shapes), plain vertex-coloured materials
  const geo = R.geo.clone(); for (const k of ['tooth', 'lip']) geo.deleteAttribute(k);
  delete geo.morphAttributes.normal;   // boba bounce: smaller file; the mouth shapes keep the base normals
  { const si = geo.attributes.skinIndex; for (let i = 0; i < si.array.length; i++) si.array[i] += 1; si.needsUpdate = true; }   // joint 0 is Root (see the bind below)
  const skin = new THREE.MeshStandardMaterial({ name: 'Batter', vertexColors: true, roughness: 1, metalness: 0 });
  const inner = new THREE.MeshStandardMaterial({ name: 'Mouth', vertexColors: true, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  const stack = new THREE.SkinnedMesh(geo, [skin, inner]); stack.name = 'Stack'; stack.updateMorphTargets(); top.add(stack);
  // Root is the stack skin's first joint (no vertices on it): a glTF skin's skeleton root must be an ancestor of all its
  // joints, and the six pancake bones are siblings. Without it, Babylon (and others) apply the body's motion twice.
  top.updateMatrixWorld(true); stack.bind(new THREE.Skeleton([rootB, ...pancakes]));
  // face + toppings: copies of what rides each live bone (visible things only), with names the clips can address
  const plain = (m) => (m.isMeshLambertMaterial ? new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.9, side: m.side }) : m);
  J.eyes.forEach((e, i) => {
    const s = i ? 'R' : 'L';   // sx -1 is the character's right, which sits on screen left from the front: name by screen side
    e.g.name = 'Eye_' + s; e.pu.name = 'Pupil_' + s; e.lids.name = 'Lids_' + s; e.up.name = 'LidUpper_' + s; e.dn.name = 'LidLower_' + s; e.bg.name = 'BrowPivot_' + s; e.br.name = 'Brow_' + s;
  });
  J.bones.forEach((b, k) => {
    for (const c of b.children) {
      if (!c.visible) continue;
      const cl = c.clone(true);
      cl.traverse((o) => { o.children = o.children.filter((q) => q.visible); if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(plain) : plain(o.material); });
      pancakes[k].add(cl);
    }
  });
  // eyes: riveted to the stack's skin (children of the live mesh, i.e. the body's space), so they ride Root here
  J.eyes.forEach((e) => {
    const cl = e.g.clone(true);
    cl.traverse((o) => { o.children = o.children.filter((q) => q.visible); if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(plain) : plain(o.material); });
    rootB.add(cl);
  });
  // arms: tubes skinned to 6-bone chains, sticking straight out sideways in the bind pose
  const ARM = { n: 5, L0: 0.15, r0: 0.05, r1: 0.042, rings: 50, rad: 14 }, armBones = [];
  for (const sd of []) {   // boba bounce: no arms
    const sname = sd < 0 ? 'R' : 'L', chain = [];
    for (let j = 0; j <= ARM.n; j++) {
      const b = new THREE.Bone(); b.name = `Arm${sname}_${j}`;
      if (j === 0) { b.position.set(sd * (I.lumpR(I.SH_K, sd * Math.PI / 2) - 0.035) + I.PK[I.SH_K].sx, I.SHY, I.PK[I.SH_K].sz); rootB.add(b); }   // off Root, not a squashing pancake (no skew)
      else { b.position.set(sd * ARM.L0, 0, 0); chain[j - 1].add(b); }
      chain.push(b);
    }
    const pos = [], nor = [], col = [], si = [], sw = [], idx = [], base = new THREE.Color(0xfcedcc), dark = new THREE.Color(0xb9783a), c = new THREE.Color();
    const L = ARM.n * ARM.L0, x0 = chain[0].position.x;
    for (let i = 0; i <= ARM.rings; i++) {
      const u = i / ARM.rings, r = lerp(ARM.r0, ARM.r1, Math.pow(u, 0.8)), f = u * ARM.n, b0 = Math.min(ARM.n - 1, Math.floor(f)), t = f - b0;
      let dk = 0; for (let j = 1; j < ARM.n; j++) dk = Math.max(dk, Math.exp(-Math.pow((u - j / ARM.n) / 0.035, 2)));
      c.copy(base).lerp(dark, dk * 0.55);
      for (let j = 0; j <= ARM.rad; j++) {
        const th = j / ARM.rad * Math.PI * 2, cy = Math.cos(th), cz = Math.sin(th);
        pos.push(x0 + sd * u * L, I.SHY + cy * r, chain[0].position.z + cz * r); nor.push(0, cy, cz); col.push(c.r, c.g, c.b);
        si.push(b0, b0 + 1, 0, 0); sw.push(1 - t, t, 0, 0);
      }
    }
    for (let i = 0; i < ARM.rings; i++) for (let j = 0; j < ARM.rad; j++) { const a = i * (ARM.rad + 1) + j, b = a + 1, cc = a + ARM.rad + 1, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4)); g.setIndex(idx);
    const arm = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({ name: 'Arm', vertexColors: true, roughness: 1 })); arm.name = 'Arm_' + sname; top.add(arm);
    const knobM = new THREE.MeshStandardMaterial({ name: 'Knob', color: 0xbd7834, roughness: 0.95 }), fistM = new THREE.MeshStandardMaterial({ name: 'Fist', color: 0xf7ead2, roughness: 0.7 });
    for (let j = 1; j < ARM.n; j++) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.054, 20, 14), knobM); k.name = `Knob${sname}_${j}`; chain[j].add(k); }
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.072, 24, 16), fistM); fist.name = 'Fist_' + sname; chain[ARM.n].add(fist);
    top.updateMatrixWorld(true); arm.bind(new THREE.Skeleton(chain.slice()));
    armBones.push({ sd, chain, live: J.arms[sd < 0 ? 0 : 1] });
  }
  // the tongue: the live one's flat, grooved strap with a rounded tip, skinned to a chain lying straight out along +z
  const TG = { n: J.tongue.n, L0: J.tongue.L0, r0: J.tongue.r0, r1: J.tongue.r1, rings: 72, rad: 16 }, tongue = [];
  {
    for (let j = 0; j <= TG.n; j++) {
      const b = new THREE.Bone(); b.name = 'Tongue_' + j;
      if (j === 0) { b.position.set(I.MX, I.Y_C - 0.02, I.ZF - 0.19); rootB.add(b); }   // off Root, not a squashing pancake (no skew)
      else { b.position.set(0, 0, TG.L0); tongue[j - 1].add(b); }
      tongue.push(b);
    }
    const pos = [], nor = [], col = [], si = [], sw = [], idx = [], base = new THREE.Color(0xf07a96), dark = new THREE.Color(0xc24466), c = new THREE.Color();
    const L = TG.n * TG.L0, z0 = I.ZF - 0.19, y0 = I.Y_C - 0.02, cu = Math.min(0.35, 0.06 / L);
    for (let i = 0; i <= TG.rings; i++) {
      const u = i / TG.rings, f = u * TG.n, b0 = Math.min(TG.n - 1, Math.floor(f)), t = f - b0;
      let r = lerp(TG.r0, TG.r1, Math.pow(u, 0.8)), tilt = 0; const c0 = 1 - cu;
      if (u > c0) { const x = (u - c0) / cu; r *= Math.sqrt(Math.max(0, 1 - x * x)); tilt = Math.min(4, x / Math.sqrt(Math.max(1e-3, 1 - x * x))); }
      const rN = Math.max(r, lerp(TG.r0, TG.r1, u) * 0.5);
      for (let j = 0; j <= TG.rad; j++) {
        const th = j / TG.rad * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
        const rw = r * 1.55, rh = r * 0.55 * (1 - 0.4 * Math.exp(-Math.pow(th - Math.PI / 2, 2) / 0.12));
        pos.push(I.MX + rw * cs, y0 + rh * sn, z0 + u * L);
        const n = new THREE.Vector3(cs / (rN * 1.55), sn / (rN * 0.55), 0).normalize(); n.z += tilt; n.normalize(); nor.push(n.x, n.y, n.z);
        c.copy(base).lerp(dark, 0.5 * Math.max(0, -sn) + 0.35 * Math.exp(-Math.pow(th - Math.PI / 2, 2) / 0.05)); col.push(c.r, c.g, c.b);
        si.push(b0, b0 + 1, 0, 0); sw.push(1 - t, t, 0, 0);
      }
    }
    for (let i = 0; i < TG.rings; i++) for (let j = 0; j < TG.rad; j++) { const a = i * (TG.rad + 1) + j, b = a + 1, cc = a + TG.rad + 1, d = cc + 1; idx.push(a, b, cc, b, d, cc); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4)); g.setIndex(idx);
    const tm = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({ name: 'Tongue', vertexColors: true, roughness: 0.85 })); tm.name = 'Tongue'; top.add(tm);
    top.updateMatrixWorld(true); tm.bind(new THREE.Skeleton(tongue.slice()));
  }

  // ---------------------------------------------------------------- baking clips from the live simulation
  const faceNames = J.eyes.flatMap((e) => [e.g, e.pu, e.lids, e.up, e.dn, e.bg, e.br]).map((o) => o.name);
  const exp = {}; top.traverse((o) => { if (o.name) exp[o.name] = o; });
  const liveFace = {}; J.eyes.forEach((e) => [e.g, e.pu, e.lids, e.up, e.dn, e.bg, e.br].forEach((o) => { liveFace[o.name] = o; }));
  const morphCount = stack.morphTargetInfluences.length;
  const _m = new THREE.Matrix4(), _m0 = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = V(), _q = new THREE.Quaternion(), _s = V(), _d = V(), _x = new THREE.Vector3(1, 0, 0);
  const _z = new THREE.Vector3(0, 0, 1), _bx = V(), _by = V(), _bz = V(), _up = V(), _bm = new THREE.Matrix4();
  const clipOf = (name, dance, secs, hook) => {
    R.setDance(0); for (let i = 0; i < 60; i++) R.simStep(1 / 120);
    if (dance) R.setDance(dance);
    for (let i = 0; i < 60; i++) R.simStep(1 / 120);   // let the blend into the move finish
    J.root.updateMatrixWorld(true); _m0.copy(J.root.matrixWorld).invert();   // the clip starts at the origin, facing +z
    const N = Math.round(secs * FPS) + 1, times = [], tr = {};
    const T = (key, n) => (tr[key] ||= { n, v: [] });
    for (let f = 0; f < N; f++) {
      if (hook) hook(f / FPS);
      if (f) for (let i = 0; i < STEPS; i++) R.simStep(1 / 120);
      J.visuals(); J.root.updateMatrixWorld(true);
      times.push(f / FPS);
      // Root: the body (hop, lean, walk) relative to where the clip started
      _m.multiplyMatrices(_m0, J.body.matrixWorld); _m.decompose(_p, _q, _s);
      rootB.position.copy(_p); rootB.quaternion.copy(_q);
      T('Root.position', 3).v.push(..._p.toArray()); T('Root.quaternion', 4).v.push(..._q.toArray());
      // pancakes: the spring spine, straight off the live bones
      J.bones.forEach((b, k) => {
        pancakes[k].position.copy(b.position); pancakes[k].quaternion.copy(b.quaternion); pancakes[k].scale.copy(b.scale);
        T(`Pancake_${k}.position`, 3).v.push(...b.position.toArray()); T(`Pancake_${k}.quaternion`, 4).v.push(...b.quaternion.toArray()); T(`Pancake_${k}.scale`, 3).v.push(...b.scale.toArray());
      });
      T('Stack.morphTargetInfluences', morphCount).v.push(...J.mesh.morphTargetInfluences);
      for (const n of faceNames) { const o = liveFace[n]; T(n + '.position', 3).v.push(...o.position.toArray()); T(n + '.quaternion', 4).v.push(...o.quaternion.toArray()); }
      for (const e of J.eyes) T(e.g.name + '.scale', 3).v.push(...e.g.scale.toArray());   // eyeballs resist the squash
      // arms: aim each chain bone at the next simulated point (bone x axis points down the arm)
      top.updateMatrixWorld(true);
      for (const A of armBones) {
        const pts = A.live.p.map((p) => p.clone().applyMatrix4(_m0));   // world -> clip space (export top sits at the origin)
        for (let j = 0; j <= ARM.n; j++) {
          const b = A.chain[j], parent = b.parent; parent.updateMatrixWorld(true); _inv.copy(parent.matrixWorld).invert();
          const lp = pts[j].clone().applyMatrix4(_inv);
          const aim = j < ARM.n ? pts[j + 1].clone().sub(pts[j]) : pts[j].clone().sub(pts[j - 1]);
          const wq = new THREE.Quaternion().setFromUnitVectors(_x.clone().multiplyScalar(A.sd), aim.normalize());
          const pq = new THREE.Quaternion(); parent.getWorldQuaternion(pq);
          const lq = pq.invert().multiply(wq);
          b.position.copy(lp); b.quaternion.copy(lq); b.updateMatrixWorld(true);
          T(b.name + '.position', 3).v.push(...lp.toArray()); T(b.name + '.quaternion', 4).v.push(...lq.toArray());
        }
      }
      // tongue: each bone at its simulated point, z down the strap, y the strap's "up" (the mouth's up, as the live one builds it)
      { const pts = J.tongue.p.map((p) => p.clone().applyMatrix4(_m0)); _up.copy(J._uw).transformDirection(_m0);
        for (let j = 0; j <= TG.n; j++) {
          const b = tongue[j], parent = b.parent; parent.updateMatrixWorld(true); _inv.copy(parent.matrixWorld).invert();
          const lp = pts[j].clone().applyMatrix4(_inv);
          _bz.copy(j < TG.n ? pts[j + 1] : pts[j]).sub(j < TG.n ? pts[j] : pts[j - 1]); if (_bz.lengthSq() < 1e-12) _bz.copy(_z); _bz.normalize();
          _bx.crossVectors(_up, _bz); if (_bx.lengthSq() < 1e-8) _bx.set(1, 0, 0); _bx.normalize(); _by.crossVectors(_bz, _bx).normalize();
          const wq = new THREE.Quaternion().setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz)), pq = new THREE.Quaternion(); parent.getWorldQuaternion(pq);
          const lq = pq.invert().multiply(wq);
          b.position.copy(lp); b.quaternion.copy(lq); b.updateMatrixWorld(true);
          T(b.name + '.position', 3).v.push(...lp.toArray()); T(b.name + '.quaternion', 4).v.push(...lq.toArray());
        }
      }
    }
    const tracks = Object.entries(tr).map(([key, { n, v }]) => {
      if (key.endsWith('morphTargetInfluences')) return new THREE.NumberKeyframeTrack(key, times, v);
      return key.endsWith('quaternion') ? new THREE.QuaternionKeyframeTrack(key, times, v) : new THREE.VectorKeyframeTrack(key, times, v);
    });
    return new THREE.AnimationClip(name, -1, tracks);
  };
  const D = (fn) => I.DANCES.findIndex((d) => d && d.name === fn);
  const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const scream = (t) => { R.manual.gape = sst(0.2, 0.6, t) * (1 - sst(3.2, 3.6, t)); };   // Uh oh, then the mouth flaps all the way open and holds
  const clips = [clipOf('Idle', 0, 4), clipOf('Scheme', D('Scheme'), 4), clipOf('Cackle', D('Cackle'), 4), clipOf('UhOh', D('Uh oh'), 3),
    clipOf('Scream', D('Uh oh'), 4, scream), clipOf('Raspberry', D('Raspberry'), 4), clipOf('LickLips', D('Lick lips'), 4.5),
    clipOf('Bliss', D('Syrup shower'), 5), clipOf('Boing', D('Boing'), 2)];
  R.manual.gape = 0;
  // back to the bind pose before writing (the exporter writes the current node transforms as the rest pose)
  rootB.position.set(0, 0, 0); rootB.quaternion.identity();
  pancakes.forEach((p, k) => { p.position.set(0, I.ycOf(k), 0); p.quaternion.identity(); p.scale.set(1, 1, 1); });
  for (const A of armBones) A.chain.forEach((b, j) => { if (j) b.position.set(A.sd * ARM.L0, 0, 0); b.quaternion.identity(); });
  tongue.forEach((b, j) => { if (j) b.position.set(0, 0, TG.L0); else b.position.set(I.MX, I.Y_C - 0.02, I.ZF - 0.19); b.quaternion.identity(); });
  armBones.forEach((A) => { A.chain[0].position.set(A.sd * (I.lumpR(I.SH_K, A.sd * Math.PI / 2) - 0.035) + I.PK[I.SH_K].sx, I.SHY, I.PK[I.SH_K].sz); });
  exp.Eye_L.scale.set(1, 1, 1); exp.Eye_R.scale.set(1, 1, 1);
  stack.morphTargetInfluences.fill(0);
  const buf = await new GLTFExporter().parseAsync(top, { binary: true, animations: clips, onlyVisible: true });
  let s = ''; const u8 = new Uint8Array(buf); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
});
fs.writeFileSync(out, Buffer.from(b64, 'base64'));
console.log('wrote', out, (fs.statSync(out).size / 1e6).toFixed(2), 'MB');
await browser.close(); server.close();
