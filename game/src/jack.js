// Flappy Jack as the player: the armless export of his rig (assets/flappy-jack.glb), driven by the game.
// Same interface as the old chibi: { root, animate(dt, state), emote(name), emotes }.
// The baked clips give him his face, mouth, tongue and spring spine; on top of that the game adds
// hops when he moves, squash and stretch in the air, a springy wobble on landing and a few mouth shapes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SCALE = 0.95;                      // his stack is 1.2 wide in the file; this makes him about boba sized
export const EMOTES = ['Cackle', 'Raspberry', 'Scheme', 'UhOh', 'Scream', 'LickLips', 'Bliss', 'Boing'];

export function makeJack({ onReady, onFail } = {}) {
  const root = new THREE.Group(); root.name = 'flappy_jack';
  const yawG = new THREE.Group(), squashG = new THREE.Group();   // yaw turns him, squash stretches him from the feet
  root.add(yawG); yawG.add(squashG);
  let mixer = null, idle = null, current = null, clips = {}, morphMeshes = [], ready = false;
  const st = { hop: 0, s: 1, sv: 0, yaw: 0, still: 0, air: 0, heading: 0 };

  new GLTFLoader().load('./assets/flappy-jack.glb', (g) => {
    const m = g.scene;
    m.scale.setScalar(SCALE);
    m.traverse((o) => {
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; }
      if (o.morphTargetDictionary) morphMeshes.push(o);
    });
    squashG.add(m);
    mixer = new THREE.AnimationMixer(m);
    for (const clip of g.animations) {
      // the game moves him: drop the body's baked travel (hops, walk) and keep everything else
      clip.tracks = clip.tracks.filter((t) => t.name !== 'Root.position');
      clips[clip.name] = clip;
    }
    idle = mixer.clipAction(clips.Idle); idle.play();
    mixer.addEventListener('finished', (e) => { if (e.action === current) back(); });
    ready = true; onReady?.();
  }, undefined, (err) => { console.warn('Flappy Jack did not load', err); onFail?.(err); });

  function back() { if (!current) return; current.fadeOut(0.3); idle.reset().fadeIn(0.3).play(); current = null; }
  function emote(name) {
    if (!ready || !clips[name]) return;
    const a = mixer.clipAction(clips[name]);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false;
    if (current && current !== a) current.fadeOut(0.2);
    if (!current) idle.fadeOut(0.2);
    a.fadeIn(0.2).play(); current = a;
  }
  const mouth = (name, w) => { for (const o of morphMeshes) { const i = o.morphTargetDictionary[name]; if (i !== undefined) o.morphTargetInfluences[i] = Math.min(1, o.morphTargetInfluences[i] + w); } };

  // state: { speed, grounded, vy, landed, heading (radians, direction of travel) }
  function animate(dt, s) {
    const k = (r) => 1 - Math.exp(-r * dt);
    // face where he's going; after standing still a moment, turn round to face the camera
    st.still = s.speed > 0.3 || !s.grounded ? 0 : st.still + dt;
    const want = st.still > 0.35 || (current && s.speed < 0.3) ? 0 : s.heading;
    const dy = ((want - st.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    st.yaw += dy * k(st.still > 0.35 ? 5 : 12);
    yawG.rotation.y = st.yaw;
    // little hops while he moves on the floor (no legs, no arms: he boings everywhere)
    let lift = 0, hopSquash = 0;
    if (s.grounded && s.speed > 0.3) {
      st.hop += dt * (5 + s.speed * 2.2);
      const u = st.hop % 1;
      lift = Math.sin(u * Math.PI) * 0.14 * Math.min(1, s.speed / 1.5);
      hopSquash = u < 0.12 ? -0.16 * Math.sin((u / 0.12) * Math.PI) : 0.06 * Math.sin(((u - 0.12) / 0.88) * Math.PI);
    } else st.hop = 0;
    // springy squash: a landing rings it, the air stretches him with his speed
    if (s.landed) st.sv -= 3.2 + Math.min(4, Math.abs(st.air) * 0.3);
    const target = s.grounded ? 1 + hopSquash : 1 + THREE.MathUtils.clamp(Math.abs(s.vy) * 0.022, 0, 0.22);
    st.sv += (-(st.s - target) * 260 - st.sv * 13) * dt;
    st.s = THREE.MathUtils.clamp(st.s + st.sv * dt, 0.55, 1.4);
    st.air = s.grounded ? 0 : s.vy;
    squashG.scale.set(1 / Math.sqrt(st.s), st.s, 1 / Math.sqrt(st.s));
    squashG.position.y = lift;
    if (mixer) {
      mixer.update(dt);
      // on top of the clip: "oh" on the way up, a gape when falling fast
      if (!s.grounded && !current) { if (s.vy > 0) mouth('oh', Math.min(0.7, s.vy * 0.08)); else mouth('gape', Math.min(0.8, -s.vy * 0.05)); }
    }
  }
  return { root, animate, emote, emotes: EMOTES, get ready() { return ready; }, get playing() { return current?.getClip().name ?? null; } };
}
