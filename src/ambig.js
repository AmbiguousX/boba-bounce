// Boba Bounce: AmBig as the player. His build is copied from test1's film/cast/ambig.js (makeAmBig, on the shared
// face rig in face-rig.js); the movement and emotes are the game's own, aimed at his joints.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeMouth, makeFaceRig } from './face-rig.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const wrap = (a, m) => ((a % m) + m) % m;
// from face-rig / engine.js: a point on the front of a head and its surface normal; the brow bar
const _Z = new THREE.Vector3(0, 0, 1);
function onHead(x, y, lift, H) {
  const ux = x / (H.r * H.sx), uy = (y - H.cy) / (H.r * H.sy), uz = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
  const n = new THREE.Vector3(ux / H.sx, uy / H.sy, uz).normalize();
  return { p: new THREE.Vector3(x, y, uz * H.r).addScaledVector(n, lift), q: new THREE.Quaternion().setFromUnitVectors(_Z, n) };
}
const BR = { r: 0.055, tube: 82e-4, arc: 0.85 };
let _browGeo = null;
function browGeometry() {
  if (_browGeo) return _browGeo;
  const browArc = new THREE.TorusGeometry(BR.r, BR.tube, 10, 20, BR.arc).rotateZ(Math.PI / 2 - BR.arc / 2).translate(0, -BR.r, 0);
  const caps = [Math.PI / 2 - BR.arc / 2, Math.PI / 2 + BR.arc / 2].map((a) => new THREE.SphereGeometry(BR.tube, 12, 10).translate(BR.r * Math.cos(a), BR.r * Math.sin(a) - BR.r, 0));
  _browGeo = mergeGeometries([browArc.toNonIndexed(), ...caps.map((c) => c.toNonIndexed())]);
  return _browGeo;
}

// ================================================================ AmBig's build (from film/cast/ambig.js)
var AB = (() => {
  const headR = 0.16, K = headR / 0.2, LIFT = 0.07;
  const HEAD = { r: headR, cy: 0.142, cz: 0, sx: 1.1, sy: 0.95 };
  const LEG = { thigh: 0.16, shin: 0.155, hipX: 0.05, thighR: 0.036, shinR: 0.031, sole: 0.03 };
  return {
    K,
    HEAD,
    EYE: { x: 0.068, y: HEAD.cy - 0.06 * HEAD.r, size: 0.026 },
    BROW: { x: 0.08 * K, y: HEAD.cy + 0.31 * HEAD.r },
    MOUTH: { y: HEAD.cy - 0.41 * HEAD.r, phiHalf: 0.6, thetaHalf: 0.36, lift: 1.006 },
    TORSO: { r: 0.085, len: 0.1 + LIFT, sx: 1.05, sz: 0.9 },
    CHEST_Y: 0.13,
    NECK: { y: 0.2 + LIFT, len: 0.07, r: 0.028 },
    LEG,
    ARM: { upper: 0.15, fore: 0.14, r: 0.026, hand: 0.036, x: 0.102, y: 0.185 + LIFT, z: 0.03 },
    SEAT: 0.04,
    STAND_Y: LEG.thigh + LEG.shin + LEG.sole,
    SCALE: 0.85
  };
})();
// chibi-base's eyes: the glint is fixed to the face, so it stays put however the eye squashes
function abEyeMaterial(color, turn) {
  const GD = new THREE.Vector3(8e-3, 0.011, 0.02).normalize(), GC = new THREE.Vector2(GD.x, GD.y), GR = 0.27;
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
  const R = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(turn));
  const f = (x) => x.toFixed(5);
  m.userData.eyeS = { value: new THREE.Vector3(1, 1.25, 0.5) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uEyeS = m.userData.eyeS;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vEyeP;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvEyeP = position;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vEyeP;
uniform vec3 uEyeS;
const mat3 EYE_TURN = mat3(${R.elements.map(f).join(", ")});
const vec2 GLINT_C = vec2(${f(GC.x)}, ${f(GC.y)});
const float GLINT_R = ${f(GR)};`).replace("#include <color_fragment>", `#include <color_fragment>
  vec3 faceP = EYE_TURN * (uEyeS * normalize(vEyeP));
  vec2 gd = (faceP.xy - GLINT_C * uEyeS.xy) / (GLINT_R * uEyeS.xy);
  float gf = dot(gd, gd), gw = fwidth(gf);
  float glint = (1.0 - smoothstep(1.0 - gw, 1.0 + gw, gf)) * step(0.0, faceP.z);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), glint);`);
  };
  m.customProgramCacheKey = () => "ambig-eye:" + R.elements.map(f).join(",");
  return m;
}
function makeAmBig(opts = {}) {
  const { K, HEAD: H, EYE: E, BROW: B, MOUTH: M, TORSO, CHEST_Y, NECK, LEG, ARM, SEAT: SEATB, STAND_Y, SCALE } = AB;
  const col = {
    body: "#8fc3f4", skin: "#fff3e6", ear: "#ffd6e0", eye: "#111111", brow: "#111111",
    mouthIn: "#6b1f2a", teeth: "#fff8f0", tongue: "#ff7f9e", tee: "#f3f0ea", trim: "#b9b2a8", shorts: "#7d9cc9",
    ...opts.colors || {}
  };
  const mats = {};
  const mat = (c, rough = 0.55) => mats[c + rough] ??= new THREE.MeshStandardMaterial({ color: c, roughness: rough });
  const part = (geo, c, p = [0, 0, 0], s = [1, 1, 1], rough) => {
    const m = new THREE.Mesh(geo, mat(c, rough));
    m.position.set(...p);
    m.scale.set(...s);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const pivot = (name, p = [0, 0, 0]) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(...p);
    return g;
  };
  const root = pivot("ambig"), lab = pivot("ambig_lab"), body = pivot("ambig_body"), size = pivot("ambig_size");
  const hips = pivot("ambig_hips", [0, STAND_Y, 0]), spine = pivot("ambig_spine");
  lab.rotation.y = Math.PI;
  size.scale.setScalar(SCALE);
  root.add(lab);
  lab.add(body);
  body.add(size);
  size.add(hips);
  hips.add(spine);
  const capsule = (r, len, c, p, rough) => part(new THREE.CapsuleGeometry(r, len, 6, 14), c, p, [1, 1, 1], rough);
  const tube = (r0, r1, y0, y1, c) => {
    const m = part(new THREE.CylinderGeometry(r0, r1, y0 - y1, 18, 1, true), c, [0, (y0 + y1) / 2, 0], [1, 1, 1], 0.7);
    m.castShadow = false;
    return m;
  };
  const ring = (r, y, sx = 1, sz = 1, th = 5e-3) => {
    const m = part(new THREE.TorusGeometry(r, th, 6, 32), col.trim, [0, y, 0], [sx, sz, 1], 0.4);
    m.rotation.x = Math.PI / 2;
    return m;
  };
  // torso: waist half on the spine, chest half on the chest joint, a ball between so bending never opens a gap
  const waist = -SEATB + TORSO.r + 0.03, yC0 = -SEATB + TORSO.r, yC1 = yC0 + TORSO.len, V2 = THREE.Vector2;
  const arc = (yc, a0, a1, dy = 0) => Array.from({ length: 11 }, (_, i) => {
    const a = a0 + (a1 - a0) * i / 10;
    return new V2(Math.max(Math.cos(a) * TORSO.r, 1e-4), yc + Math.sin(a) * TORSO.r - dy);
  });
  const torsoS = [TORSO.sx, 1, TORSO.sz];
  spine.add(part(new THREE.LatheGeometry([...arc(yC0, -Math.PI / 2, 0), new V2(TORSO.r, CHEST_Y + 5e-3)], 40), col.tee, [0, 0, 0], torsoS, 0.6));
  spine.add(part(new THREE.SphereGeometry(TORSO.r - 1e-3, 40, 20), col.tee, [0, CHEST_Y, 0], torsoS, 0.6));
  const chest = pivot("ambig_chest", [0, CHEST_Y, 0]);
  spine.add(chest);
  chest.add(part(new THREE.LatheGeometry([new V2(TORSO.r, -5e-3), ...arc(yC1, 0, Math.PI / 2, CHEST_Y)], 40), col.tee, [0, 0, 0], torsoS, 0.6));
  const sR = TORSO.r + 4e-3, cY = -SEATB + TORSO.r, shortsPts = [];
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + i / 12 * (Math.PI / 2);
    shortsPts.push(new V2(Math.max(Math.cos(a) * sR, 1e-4), cY + Math.sin(a) * sR));
  }
  shortsPts.push(new V2(sR, waist));
  spine.add(part(new THREE.LatheGeometry(shortsPts, 48), col.shorts, [0, 0, 0], [TORSO.sx, 1, TORSO.sz], 0.8));
  spine.add(ring(sR, waist, TORSO.sx, TORSO.sz));
  // legs: hip, knee, ankle
  const legs = [], knees = [], ankles = [];
  for (const s of [1, -1]) {
    const g = pivot(s > 0 ? "ambig_leg_l" : "ambig_leg_r", [s * LEG.hipX, 0, 0]);
    g.add(capsule(LEG.thighR, LEG.thigh, col.body, [0, -LEG.thigh / 2, 0]));
    const sl = LEG.thighR + 4e-3, hem = -0.055;
    g.add(part(new THREE.SphereGeometry(sl, 18, 12), col.shorts, [0, 0, 0], [1, 1, 1], 0.8));
    const leg = tube(sl, sl + 1e-3, 0, hem, col.shorts);
    leg.material = leg.material.clone();
    leg.material.side = THREE.DoubleSide;
    g.add(leg, ring(sl + 1e-3, hem, 1, 1, 3.5e-3));
    const knee = pivot(s > 0 ? "ambig_knee_l" : "ambig_knee_r", [0, -LEG.thigh, 0]);
    const shinEnd = -LEG.shin + 0.012, shinLen = -shinEnd - LEG.shinR;
    knee.add(capsule(LEG.shinR, shinLen, col.body, [0, (LEG.shinR + shinEnd) / 2, 0]));
    const ankle = pivot(s > 0 ? "ambig_ankle_l" : "ambig_ankle_r", [0, -LEG.shin, 0]);
    ankle.add(part(new THREE.SphereGeometry(0.042, 14, 10), col.skin, [0, 0, 0.018], [1, LEG.sole / 0.042, 1.4]));
    knee.add(ankle);
    g.add(knee);
    hips.add(g);
    legs.push(g);
    knees.push(knee);
    ankles.push(ankle);
  }
  // arms: shoulder, elbow, hand
  const elbows = [], hands = [];
  const arms = [1, -1].map((s) => {
    const g = pivot(s > 0 ? "ambig_arm_l" : "ambig_arm_r", [s * ARM.x, ARM.y - CHEST_Y, ARM.z]);
    g.add(capsule(ARM.r, ARM.upper, col.body, [0, -ARM.upper / 2, 0]));
    g.add(part(new THREE.SphereGeometry(ARM.r + 8e-3, 14, 10), col.tee, [0, 0, 0], [1, 1, 1], 0.6));
    // the sleeve is an open tube: double sided (like the shorts' legs) so it doesn't vanish from inside when the arm lifts
    const sleeve = tube(ARM.r + 8e-3, ARM.r + 9e-3, 0, -0.045, col.tee);
    sleeve.material = sleeve.material.clone();
    sleeve.material.side = THREE.DoubleSide;
    g.add(sleeve, ring(ARM.r + 9e-3, -0.045));
    const el = pivot(s > 0 ? "ambig_elbow_l" : "ambig_elbow_r", [0, -ARM.upper, 0]);
    el.add(capsule(ARM.r - 2e-3, ARM.fore, col.body, [0, -ARM.fore / 2, 0]));
    const hand = part(new THREE.SphereGeometry(ARM.hand, 12, 10), col.skin, [0, -ARM.fore, 0], [1, 0.95, 0.9]);
    hand.name = s > 0 ? "ambig_hand_l" : "ambig_hand_r";
    el.add(hand);
    hands.push(hand);
    g.add(el);
    elbows.push(el);
    chest.add(g);
    return g;
  });
  // neck, head, ears, eyes, mouth, brows
  const neckBase = pivot("ambig_neck_base", [0, NECK.y - CHEST_Y, 0]);
  chest.add(neckBase);
  neckBase.add(capsule(NECK.r, NECK.len, col.body, [0, NECK.len / 2, 0]));
  const neck = pivot("ambig_neck", [0, NECK.len, 0]);
  neckBase.add(neck);
  const head = part(new THREE.SphereGeometry(H.r, 32, 24), col.skin, [0, H.cy, H.cz], [H.sx, H.sy, 1]);
  head.name = "ambig_head";
  neck.add(head);
  const ears = [1, -1].map((s) => {
    const ear = pivot(s > 0 ? "ambig_ear_l" : "ambig_ear_r", [s * H.r * H.sx, H.cy + 0.2 * H.r, -0.01 * K]);
    ear.rotation.set(0, -s * 0.35, s * -0.25);
    ear.add(part(new THREE.SphereGeometry(0.075 * K, 20, 14), col.body, [s * 0.02 * K, 0, 0], [1, 1, 0.32]));
    ear.add(part(new THREE.SphereGeometry(0.048 * K, 16, 10), col.ear, [s * 0.02 * K, 0, 0.018 * K], [1, 1, 0.2]));
    neck.add(ear);
    return ear;
  });
  const eyeGeo = new THREE.SphereGeometry(E.size, 16, 12);
  const eyeMeshes = [1, -1].map((s) => {
    const { p, q } = onHead(s * E.x, E.y, 0, H);
    const e = new THREE.Mesh(eyeGeo, abEyeMaterial(col.eye, q));
    e.position.set(s * E.x, E.y, p.z - 3e-3);
    e.quaternion.copy(q);
    e.scale.set(1, 1.25, 0.5);
    e.castShadow = true;
    neck.add(e);
    return e;
  });
  const eyes = eyeMeshes.map((e) => ({
    set({ blink, squint, wide }) {
      const w = 1 + 0.22 * wide;
      e.scale.set(w, lerp(1.25 * (1 - 0.64 * squint), 0.15, blink) * w, 0.5);
      e.material.userData.eyeS.value.copy(e.scale);
    }
  }));
  const mouth = makeMouth(col, { head: H, mouth: M });
  head.add(mouth.mesh);
  const brows = [1, -1].map((s) => {
    const { p, q } = onHead(s * B.x, B.y, 4e-3, H);
    const piv = pivot(s > 0 ? "ambig_brow_l" : "ambig_brow_r", [p.x, p.y, p.z]);
    piv.quaternion.copy(q);
    const raise = pivot("raise"), tilt = pivot("tilt");
    const bar = part(browGeometry(), col.brow, [0, 0, 0], [K, K, 0.45 * K], 0.4);
    bar.castShadow = false;
    tilt.add(bar);
    raise.add(tilt);
    piv.add(raise);
    neck.add(piv);
    return { s, raise, tilt, k: K };
  });
  const anchors = { foot_l: pivot("anchor_foot_l", [0, 0, 0.018]), foot_r: pivot("anchor_foot_r", [0, 0, 0.018]) };
  ankles[0].add(anchors.foot_l);
  ankles[1].add(anchors.foot_r);
  const faceRig = makeFaceRig({ seed: opts.seed ?? 11, mouth, eyes, brows });
  return { root, hips, spine, chest, neck, legs, knees, ankles, arms, elbows, faceRig, AB };
}

// ================================================================ AmBig as the player
// Same interface as the old chibi: { root, animate(dt, state), emote(name), emotes, setFace(name, secs), playing }.
// Each frame builds a pose (joint angles in the chibi's convention) from movement, then from an emote if one is
// playing, and applies it to AmBig's joints. His build turns him round inside rig.root; turning rig.root round again
// faces him the way the chibi faced (+z) and gives his joints the chibi's axes. His limb lists start on his left (+x),
// the chibi's on -x, so the chibi's L drives his index 1.
export function makeAmBigPlayer() {
  const rig = makeAmBig({ seed: 11 });
  const { hips, neck, legs, knees, arms, elbows, faceRig } = rig, { STAND_Y, SCALE } = rig.AB;
  const pivot = (name, y = 0) => { const o = new THREE.Group(); o.name = name; o.position.y = y; return o; };
  const FLIP_Y = 0.35;
  const root = pivot('ambig_player'), flip = pivot('ambig_flip', FLIP_Y), squash = pivot('ambig_squash', -FLIP_Y);   // spins turn round his belly, squash from his feet
  root.add(flip); flip.add(squash); squash.add(rig.root);
  rig.root.rotation.y = Math.PI;
  rig.root.traverse((m) => { if (m.isMesh) m.castShadow = false; });   // the game draws a soft blob shadow under him instead

  const st = { phase: 0, walk: 0, air: 0, land: 0, lookT: 0, look: 0, t: 0, tilt: 0, emote: null, eT: 0, eW: 0 };
  const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const pulse = (x, a, b) => sm((x - a) / 0.12) * (1 - sm((x - b) / 0.12));   // on between a and b, with soft edges
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

  const EMOTE_FACE = { wave: 'happy', cheer: 'joy', dance: 'laugh', spin: 'joy', flip: 'surprised', sit: 'content', bow: 'content', shrug: 'unsure', sip: 'sip', proud: 'smug', think: 'thinking' };
  let heldFace = null, heldT = 0;
  function setFace(name, secs = 1.2) { heldFace = name; heldT = secs; }
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
    const w = st.walk * (1 - st.air), sw = Math.sin(st.phase), idle = 1 - st.walk;
    st.lookT -= dt;
    if (st.lookT <= 0) { st.look = (Math.random() - 0.5) * 1.1; st.tilt = (Math.random() - 0.5) * 0.4; st.lookT = 1.5 + Math.random() * 2.5; }
    const P = {
      elbowLx: 0.25 + 0.35 * w * Math.max(0, sw) + 0.5 * st.air, elbowRx: 0.25 + 0.35 * w * Math.max(0, -sw) + 0.5 * st.air, elbowLz: 0, elbowRz: 0,
      legLx: sw * 0.75 * w - st.air * 0.5, legRx: -sw * 0.75 * w - st.air * 0.2, legLz: 0, legRz: 0,
      kneeL: 0.5 * w * Math.max(0, -sw) + st.air * 0.9 + st.land * 0.6, kneeR: 0.5 * w * Math.max(0, sw) + st.air * 0.4 + st.land * 0.6,   // he has knees: tuck in the air, bend on landing
      armLx: -sw * 0.7 * w, armRx: sw * 0.7 * w, armLz: -0.3 - st.air * 1.45, armRz: 0.3 + st.air * 1.45,
      hipY: Math.abs(Math.sin(st.phase)) * 0.028 * w, hipX: 0.12 * w + 0.15 * clamp(-s.vy / 8, -1, 1) * st.air, hipZ: Math.sin(st.phase) * 0.06 * w,
      neckX: -0.08 * w + Math.sin(st.phase * 2) * 0.03 * w, neckY: st.look * idle, neckZ: st.tilt * idle - Math.sin(st.phase) * 0.05 * w,
      lift: 0, spin: 0, flipX: 0,
      sy: 1 + 0.018 * Math.sin(st.t * 2.4) * idle * (1 - st.air) + st.air * clamp(Math.abs(s.vy) / 9, 0, 1) * 0.16 - Math.sin(st.land * Math.PI) * 0.22,
    };
    // emote layer: moving or jumping cancels it (except mid-flip)
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
      for (const key of ['spin', 'flipX']) if (key in T) T[key] = wrap(T[key] + Math.PI, TAU) - Math.PI;
      for (const key in T) P[key] = lerp(P[key] ?? 0, T[key], st.eW);
      if (st.emote) st.lastEmote = st.emote;
    }
    // apply (chibi L = his index 1)
    legs[1].rotation.set(P.legLx, 0, P.legLz); legs[0].rotation.set(P.legRx, 0, P.legRz);
    knees[1].rotation.x = P.kneeL; knees[0].rotation.x = P.kneeR;
    arms[1].rotation.set(P.armLx, 0, P.armLz); arms[0].rotation.set(P.armRx, 0, P.armRz);
    elbows[1].rotation.set(-P.elbowLx, 0, P.elbowLz); elbows[0].rotation.set(-P.elbowRx, 0, P.elbowRz);
    hips.position.y = STAND_Y + P.hipY / SCALE;
    hips.rotation.set(P.hipX, 0, P.hipZ);
    neck.rotation.x = P.neckX;
    neck.rotation.y += (P.neckY - neck.rotation.y) * k(st.emote ? 12 : 4);
    neck.rotation.z += (P.neckZ - neck.rotation.z) * k(st.emote ? 12 : 6);
    flip.position.y = FLIP_Y + P.lift;
    flip.rotation.set(P.flipX, P.spin, 0);
    const sxz = 1 / Math.sqrt(P.sy);
    squash.scale.set(sxz, P.sy, sxz);
    // face: an emote's face first, then one the game is holding, then whatever he's doing
    heldT -= dt; if (heldT <= 0) heldFace = null;
    faceRig.face.expression = (st.emote && EMOTE_FACE[st.emote]) || heldFace
      || (!s.grounded ? (s.vy > 1 ? 'joy' : s.vy < -7 ? 'surprised' : 'happy') : 'happy');
    faceRig.update(dt);
  }
  return { root, animate, emote, setFace, emotes: Object.keys(EMOTES), get playing() { return st.emote; } };
}
