// Boba Bounce — look and effects: sky, image-based light, shaders, particles and bloom.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// one clock and one fever amount shared by every shader
export const U = { uTime: { value: 0 }, uFever: { value: 0 } };
export const LOW = matchMedia('(pointer: coarse)').matches;           // phones and tablets get lighter settings
export const SUN_DIR = new THREE.Vector3(25, 45, 30).normalize();

const lin = (hex) => new THREE.Color(hex);                             // hex is sRGB; THREE.Color stores it linear

// ---------------------------------------------------------------- GLSL helpers
const NOISE = /* glsl */ `
float bbHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float bbNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bbHash(i), bbHash(i + vec2(1, 0)), u.x), mix(bbHash(i + vec2(0, 1)), bbHash(i + vec2(1, 1)), u.x), u.y); }
float bbFbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * bbNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
`;

function patch(mat, key, fn) {
  mat.onBeforeCompile = (s) => { Object.assign(s.uniforms, U); fn(s); };
  mat.customProgramCacheKey = () => key;
  return mat;
}
// world position varying, added to any built-in material
function addWorldPos(s) {
  s.vertexShader = 'varying vec3 vBbWorld;\n' + s.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
    #ifdef USE_INSTANCING
      vBbWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
    #else
      vBbWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
    #endif`);
  s.fragmentShader = 'varying vec3 vBbWorld;\nuniform float uTime;\nuniform float uFever;\n' + NOISE + s.fragmentShader;
}

// ---------------------------------------------------------------- sky dome: gradient, drifting clouds, soft sun
export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uTop: { value: lin('#3d9be9') }, uMid: { value: lin('#9fd8ff') }, uHorizon: { value: lin('#ffe3ec') },
      uFeverTop: { value: lin('#7b5cff') }, uFeverHorizon: { value: lin('#ffc2dc') }, uSun: { value: SUN_DIR } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHorizon, uFeverTop, uFeverHorizon, uSun; uniform float uTime, uFever; varying vec3 vDir;
      ${NOISE}
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 top = mix(uTop, uFeverTop, uFever * 0.6), hor = mix(uHorizon, uFeverHorizon, uFever);
        vec3 col = mix(hor, uMid, smoothstep(0.0, 0.25, h));
        col = mix(col, top, smoothstep(0.25, 0.9, h));
        if (h < 0.0) col = hor;
        // clouds: fbm on a plane above the world
        if (h > 0.02) {
          vec2 uv = d.xz / (h + 0.18) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
          float n = bbFbm(uv);
          float c = smoothstep(0.52, 0.78, n) * smoothstep(0.02, 0.22, h);
          float shade = smoothstep(0.5, 0.9, bbFbm(uv + 0.25));
          col = mix(col, mix(vec3(1.0, 0.98, 0.97), vec3(0.86, 0.88, 0.97), shade * 0.6), c * 0.9);
        }
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.85, 0.6) * (pow(s, 8.0) * 0.25 + pow(s, 300.0) * 6.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), mat);
  sky.name = 'sky'; sky.renderOrder = -10; sky.frustumCulled = false;
  return sky;
}
export const FOG_COLOR = lin('#ffe3ec');

// ---------------------------------------------------------------- image-based light baked from our own sky + grass
export function makeEnvironment(renderer) {
  // a plain vertex-coloured dome: sky above, a warm pink horizon, grass green below, plus a modest sun
  const envScene = new THREE.Scene();
  const dome = new THREE.SphereGeometry(50, 48, 24), P = dome.attributes.position, col = new Float32Array(P.count * 3), c = new THREE.Color();
  const top = lin('#3d9be9'), mid = lin('#9fd8ff'), hor = lin('#ffe3ec'), grass = lin('#5aa63c');
  for (let i = 0; i < P.count; i++) {
    const h = P.getY(i) / 50;
    if (h >= 0) c.copy(hor).lerp(mid, THREE.MathUtils.smoothstep(h, 0, 0.25)).lerp(top, THREE.MathUtils.smoothstep(h, 0.25, 0.9));
    else c.copy(hor).lerp(grass, THREE.MathUtils.smoothstep(-h, 0, 0.15)).multiplyScalar(0.8);
    col.set([c.r, c.g, c.b], i * 3);
  }
  dome.setAttribute('color', new THREE.BufferAttribute(col, 3));
  envScene.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));
  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.75).multiplyScalar(6), fog: false }));
  sunBall.position.copy(SUN_DIR).multiplyScalar(40); envScene.add(sunBall);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(envScene, 0.02, 0.1, 200);
  pm.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------- tapioca pearls: deep glossy brown with a warm amber rim (light through the gel)
export function makeBobaMaterial(gold = false) {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: gold ? 0.25 : 0.32, metalness: gold ? 0.7 : 0, clearcoat: gold ? 0.5 : 1, clearcoatRoughness: 0.08,
    envMapIntensity: gold ? 0.8 : 0.7,
    name: gold ? 'boba_gold' : 'boba',
  });
  return patch(m, gold ? 'boba-gold' : 'boba', (s) => {
    s.fragmentShader = 'uniform float uTime;\n' + s.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float bbPearl = step(vColor.r + vColor.g + vColor.b, 1.5);   // 1 on the pearl body, 0 on the eyes
        ${gold ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.32, 0.02), bbPearl);' : ''}`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor *= bbPearl;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float bbFr = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);
        ${gold
          ? 'totalEmissiveRadiance += bbPearl * (vec3(0.8, 0.22, 0.0) * (0.3 + 0.15 * sin(uTime * 6.0)) + vec3(1.0, 0.5, 0.08) * bbFr * 1.4);'
          : 'totalEmissiveRadiance += bbPearl * vec3(0.55, 0.2, 0.06) * bbFr * 0.9;'}`);
  });
}

// ---------------------------------------------------------------- milk-tea floor: slow marbled swirl with caustic shimmer
export function makeTeaMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.38, envMapIntensity: 0.6, name: 'tea' });
  return patch(m, 'tea', (s) => {
    addWorldPos(s);
    s.fragmentShader = s.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = vBbWorld.xz * 0.16; float t = uTime * 0.04;
        vec2 w = vec2(bbFbm(p * 1.3 + t), bbFbm(p * 1.3 - t + 5.2));
        float n = bbFbm(p + w * 1.7);
        vec3 cream = mix(vec3(0.84, 0.62, 0.46), vec3(0.92, 0.55, 0.68), uFever * 0.7);
        vec3 caramel = mix(vec3(0.46, 0.22, 0.10), vec3(0.62, 0.18, 0.38), uFever * 0.7);
        vec3 tea = mix(cream, caramel, smoothstep(0.42, 0.72, n) * 0.75);
        float r = length(vBbWorld.xz);
        tea *= mix(1.0, 0.78, smoothstep(11.0, 16.5, r));
        diffuseColor.rgb = tea;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 q = vBbWorld.xz * 0.9;
        float ca = bbNoise(q + vec2(uTime * 0.35, uTime * 0.2)) + bbNoise(q * 1.7 - vec2(uTime * 0.25, -uTime * 0.3));
        ca = pow(1.0 - abs(ca - 1.0), 10.0);
        totalEmissiveRadiance += vec3(1.0, 0.9, 0.75) * ca * 0.10;`);
  });
}

// ---------------------------------------------------------------- grass: painterly mottling in world space
export function makeGrassGroundMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, envMapIntensity: 0.5, name: 'grass_ground' });
  return patch(m, 'grass-ground', (s) => {
    addWorldPos(s);
    s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float g1 = bbFbm(vBbWorld.xz * 0.35), g2 = bbNoise(vBbWorld.xz * 3.0);
      diffuseColor.rgb *= 0.82 + 0.3 * g1 + 0.08 * g2;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.05, 0.8), smoothstep(0.55, 0.75, g1));`);
  });
}

// ---------------------------------------------------------------- wind: sways vertices above a height, phase from world position
export function addWind(mat, { from = 0, amount = 0.08, key }) {
  return patch(mat, key, (s) => {
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        #ifdef USE_INSTANCING
          vec3 bbOrg = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float bbH = max(position.y - ${from.toFixed(3)}, 0.0);
        #else
          vec3 bbOrg = (modelMatrix * vec4(position, 1.0)).xyz; float bbH = max(position.y - ${from.toFixed(3)}, 0.0);
        #endif
        float ph = dot(bbOrg.xz, vec2(0.13, 0.11));
        float sway = sin(uTime * 1.6 + ph) * 0.7 + sin(uTime * 2.7 + ph * 1.7) * 0.3;
        transformed.x += sway * bbH * bbH * ${amount.toFixed(4)};
        transformed.z += cos(uTime * 1.3 + ph) * bbH * bbH * ${(amount * 0.5).toFixed(4)};
      }`);
  });
}

// ---------------------------------------------------------------- grass tufts around the cup, one instanced draw
export function makeGrassTufts({ inner, outer, pathHalf, count }) {
  const blade = new THREE.ConeGeometry(0.07, 0.55, 3, 1).translate(0, 0.275, 0);
  const parts = [];
  for (let k = 0; k < 3; k++) parts.push(blade.clone().rotateZ((k - 1) * 0.35).rotateY((k * Math.PI * 2) / 3));
  const g = mergeSimple(parts);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3), base = lin('#3f8f2c'), tip = lin('#b7ec7a'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { c.copy(base).lerp(tip, THREE.MathUtils.clamp(pos.getY(i) / 0.55, 0, 1)); col.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = addWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.4 }), { from: 0, amount: 0.9, key: 'tuft' });
  const mesh = new THREE.InstancedMesh(g, mat, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  let seed = 9, n = 0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (n < count) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(inner * inner + rnd() * (outer * outer - inner * inner));
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (Math.abs(x) < pathHalf && z > 0) continue;
    const s = 0.6 + rnd() * 0.9;
    m4.compose(v.set(x, 0, z), q.setFromEuler(e.set(0, rnd() * 6.28, 0)), sc.set(s, s * (0.7 + rnd() * 0.6), s));
    mesh.setMatrixAt(n++, m4);
  }
  mesh.receiveShadow = true; mesh.name = 'grass_tufts';
  return mesh;
}
function mergeSimple(geos) {
  const all = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const n = all.reduce((s, g) => s + g.attributes.position.count, 0);
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  let o = 0;
  for (const g of all) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return out;
}

// ---------------------------------------------------------------- glass cup: clear in the middle, bright at grazing angles
export function makeGlassMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: '#fff0f6', roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    envMapIntensity: 1.6, transparent: true, side: THREE.DoubleSide, depthWrite: false, iridescence: 0.5, iridescenceIOR: 1.3, name: 'glass' });
  return patch(m, 'glass', (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float bbFr = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
      diffuseColor.a = mix(0.07, 0.55, bbFr);
      totalEmissiveRadiance += vec3(1.0, 0.85, 0.92) * bbFr * 0.25;`);
  });
}

// ---------------------------------------------------------------- particles: splash droplets and sparkles, one pool
export function makeParticles(max = 900) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: /* glsl */ `attribute float size; attribute float alpha; attribute vec3 color; uniform float uScale; varying vec3 vC; varying float vA;
      void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `varying vec3 vC; varying float vA;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = smoothstep(0.5, 0.15, r) * vA; gl_FragColor = vec4(vC, a); }`,
    transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = 5;
  const P = Array.from({ length: max }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, s: 0, r: 0, gc: 0, b: 0 }));
  let head = 0;
  function emit(o) { const p = P[head]; head = (head + 1) % max; Object.assign(p, o); p.max = o.life; }
  function burst(x, y, z, { gold = false, combo = 1 } = {}) {
    const drops = gold ? 34 : 18 + Math.min(combo, 10) * 2;
    for (let i = 0; i < drops; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3.2, up = 2.5 + Math.random() * 3.5;
      const c = gold ? [2.4, 1.5, 0.35] : Math.random() < 0.55 ? [0.95, 0.82, 0.68] : [0.36, 0.18, 0.1];
      emit({ life: 0.55 + Math.random() * 0.45, x, y, z, vx: Math.cos(a) * sp, vy: up, vz: Math.sin(a) * sp, g: 14, s: 0.09 + Math.random() * 0.1, r: c[0], gc: c[1], b: c[2] });
    }
    const sparks = gold ? 26 : 6 + Math.min(combo, 12);
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 2;
      const c = gold ? [3.5, 2.6, 1.0] : [2.6, 1.6, 2.0];
      emit({ life: 0.6 + Math.random() * 0.6, x, y: y + 0.2, z, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 2.5, vz: Math.sin(a) * sp, g: -0.5, s: 0.07 + Math.random() * 0.06, r: c[0], gc: c[1], b: c[2] });
    }
  }
  function update(dt) {
    for (let i = 0; i < max; i++) {
      const p = P[i];
      if (p.life > 0) {
        p.life -= dt; p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vx *= 1 - 1.5 * dt; p.vz *= 1 - 1.5 * dt;
        if (p.y < 0.17 && p.vy < 0) { p.y = 0.17; p.vy *= -0.25; p.vx *= 0.5; p.vz *= 0.5; }
      }
      const k = Math.max(0, p.life / p.max);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r; col[i * 3 + 1] = p.gc; col[i * 3 + 2] = p.b;
      size[i] = p.s * (0.4 + 0.6 * k); alpha[i] = Math.min(1, k * 2.5);
    }
    for (const k of ['position', 'color', 'size', 'alpha']) geo.attributes[k].needsUpdate = true;
  }
  return { points, burst, update, mat };
}

// ---------------------------------------------------------------- ambient motes floating over the cup
export function makeMotes(count, radius, height) {
  const geo = new THREE.BufferGeometry(), p = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
    p.set([Math.sin(a) * r, 0.5 + Math.random() * height, Math.cos(a) * r], i * 3); seed[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3)); geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uScale: { value: 400 } },
    vertexShader: /* glsl */ `attribute float seed; uniform float uTime, uScale, uFever; varying float vA; varying float vF;
      void main(){ vec3 p = position; float t = uTime * (0.3 + seed * 0.4) + seed * 40.0;
        p += vec3(sin(t) * 0.6, sin(t * 0.7) * 0.4 + fract(uTime * 0.02 + seed) * 2.0 - 1.0, cos(t * 0.9) * 0.6);
        vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 3.0 + seed * 30.0)); vF = uFever;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (0.05 + seed * 0.05) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `varying float vA; varying float vF;
      void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; vec3 c = mix(vec3(1.6, 1.4, 1.2), vec3(2.2, 1.0, 1.8), vF);
        gl_FragColor = vec4(c, smoothstep(0.5, 0.0, r) * vA * 0.7); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 4;
  return { points: pts, mat };
}

// ---------------------------------------------------------------- shockwave rings on the tea when a boba pops
export function makeRings(n = 10) {
  const geo = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
  const list = Array.from({ length: n }, () => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 1.1), transparent: true, depthWrite: false, opacity: 0 }));
    m.visible = false; m.renderOrder = 3; m.userData = { t: 0, max: 0.5, s: 1 };
    return m;
  });
  let head = 0;
  return {
    meshes: list,
    spawn(x, y, z, size = 1, gold = false) {
      const m = list[head]; head = (head + 1) % n;
      m.position.set(x, y, z); m.visible = true; m.userData = { t: 0, max: 0.5, s: size };
      m.material.color.setRGB(...(gold ? [2.8, 1.8, 0.5] : [1.6, 1.3, 1.1]));
    },
    update(dt) {
      for (const m of list) {
        if (!m.visible) continue;
        const u = (m.userData.t += dt) / m.userData.max;
        if (u >= 1) { m.visible = false; continue; }
        const e = 1 - (1 - u) ** 3;
        m.scale.setScalar(m.userData.s * (0.3 + 1.6 * e)); m.material.opacity = (1 - u) * 0.8;
      }
    },
  };
}

// ---------------------------------------------------------------- post: bloom for the sparkles, gold and sun glints
export function makeComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.4, 0.5, 1.15);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const resize = () => { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); bloom.setSize(innerWidth / 2, innerHeight / 2); };
  resize();
  return { composer, bloom, resize };
}
