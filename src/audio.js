// Boba Bounce — all sound is made on the fly with Web Audio: no files to load.
let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('bobaBounceMuted') === '1'; } catch (e) {}

function ensure() {
  if (ctx) { if (ctx.state === 'suspended' && !document.hidden) ctx.resume(); return ctx; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.55; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.suspend(); else ctx.resume(); });
  } catch (e) { ctx = null; }
  return ctx;
}

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
function tone(bus, { type = 'sine', f, f2, t, dur, vol, attack = 0.005 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur * 0.6);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.02);
}
function noise(bus, { t, dur, vol, hp = 6000 }) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = hp;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(bus); s.start(t); s.stop(t + dur + 0.02);
}

// ---------------------------------------------------------------- sound effects
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];   // major pentatonic, climbs with the combo
export function sfx(kind, combo = 1) {
  if (!ensure()) return;
  const t = ctx.currentTime;
  switch (kind) {
    case 'boing': {
      const n = 64 + SCALE[Math.min(combo - 1, SCALE.length - 1)];
      tone(sfxBus, { type: 'sine', f: mtof(n - 12), f2: mtof(n), t, dur: 0.22, vol: 0.2 });
      tone(sfxBus, { type: 'triangle', f: mtof(n + 12), t: t + 0.03, dur: 0.12, vol: 0.05 });
      noise(sfxBus, { t, dur: 0.05, vol: 0.05, hp: 3000 });
      break;
    }
    case 'gold':
      [0, 4, 7, 12, 16].forEach((s, i) => tone(sfxBus, { type: 'triangle', f: mtof(76 + s), t: t + i * 0.045, dur: 0.35, vol: 0.09 }));
      break;
    case 'break':
      tone(sfxBus, { type: 'triangle', f: mtof(67), f2: mtof(55), t, dur: 0.25, vol: 0.06 });
      break;
    case 'tick': tone(sfxBus, { type: 'triangle', f: 880, t, dur: 0.09, vol: 0.12 }); break;
    case 'go': tone(sfxBus, { type: 'triangle', f: 660, t, dur: 0.1, vol: 0.14 }); tone(sfxBus, { type: 'triangle', f: 990, t: t + 0.1, dur: 0.3, vol: 0.16 }); break;
    case 'fever':
      tone(sfxBus, { type: 'sawtooth', f: 220, f2: 1320, t, dur: 0.6, vol: 0.05, attack: 0.05 });
      [0, 4, 7, 12].forEach((s, i) => tone(sfxBus, { type: 'square', f: mtof(72 + s), t: t + 0.25 + i * 0.07, dur: 0.18, vol: 0.04 }));
      break;
    case 'end': tone(sfxBus, { type: 'triangle', f: 660, f2: 220, t, dur: 0.65, vol: 0.16 }); break;
  }
}

// ---------------------------------------------------------------- music: a bouncy loop, faster and brighter in fever
const CHORDS = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];     // C, Am, F, G
const MEL = [12, -1, 16, -1, 19, 16, -1, 21, 19, -1, 16, -1, 14, -1, 12, -1];  // offsets from the chord root, -1 = rest
let timer = null, step = 0, nextT = 0, fever = false, playing = false;
function schedule() {
  const bpm = fever ? 138 : 116, s16 = 60 / bpm / 4;
  while (nextT < ctx.currentTime + 0.12) {
    const bar = Math.floor(step / 16) % 4, i = step % 16, ch = CHORDS[bar], root = ch[0];
    if (i % 4 === 0) tone(musicBus, { type: 'sine', f: 110, f2: 45, t: nextT, dur: 0.18, vol: 0.32 });            // soft kick
    if (i % 4 === 2) noise(musicBus, { t: nextT, dur: 0.04, vol: fever ? 0.07 : 0.045 });                        // hat
    if (i === 4 || i === 12) noise(musicBus, { t: nextT, dur: 0.12, vol: 0.06, hp: 1500 });                       // clap
    if (i % 2 === 0) tone(musicBus, { type: 'triangle', f: mtof(root - 12 + (i % 8 === 6 ? 7 : 0)), t: nextT, dur: s16 * 1.8, vol: 0.16 });
    const m = MEL[(i + bar * 3) % 16];
    if (m >= 0 && (bar % 2 === 0 || i < 8)) tone(musicBus, { type: 'square', f: mtof(root + m + 12), t: nextT, dur: s16 * 1.4, vol: 0.025 });
    if (i % 8 === 0) for (const n of ch) tone(musicBus, { type: 'sine', f: mtof(n + 12), t: nextT, dur: s16 * 7, vol: 0.03, attack: 0.03 });
    if (fever) tone(musicBus, { type: 'triangle', f: mtof(ch[i % 3] + 24), t: nextT, dur: s16 * 0.9, vol: 0.03 });
    nextT += s16; step++;
  }
}
export function startMusic() {
  if (!ensure() || playing) return;
  playing = true; step = 0; nextT = ctx.currentTime + 0.05;
  timer = setInterval(schedule, 25);
}
export function stopMusic() { playing = false; clearInterval(timer); timer = null; }
export function setFever(on) { fever = on; }
export const isMuted = () => muted;
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('bobaBounceMuted', muted ? '1' : '0'); } catch (e) {}
  if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
  return muted;
}
