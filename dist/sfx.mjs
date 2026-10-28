// Sound effects for the arena, synthesised live with Web Audio: no audio files, no licences.
// One AudioContext; chain: voice -> bus -> master gain -> limiter (DynamicsCompressor) -> destination.
// Muted by default, unlocked only from a user gesture, remembered in localStorage, paused while the page is hidden.
// The context comes from an injected factory so the whole engine can be tested in Node with a fake.
const finite = Number.isFinite;
const db = d => Math.pow(10, d / 20);
const clamp = (v, lo, hi, fallback) => finite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
export const SFX_KEY = 'sm.sfx';
// Major pentatonic steps used by the combo streak; the catch sound uses step n for a combo of n (capped at 8).
export const COMBO_SCALE = Object.freeze([523, 587, 659, 784, 880, 1047, 1175, 1319]);
// Peak level of the loudest layer of each sound in dBFS before the master gain (the master is about -6 dB on top of this).
export const SFX_PEAK_DB = Object.freeze({ catch: -14, miss: -16, bombWarn: -18, bomb: -10, avoid: -20, hit: -10, dodge: -20, swat: -9, bite: -12, roundStart: -16, roundEnd: -16, tick: -20 });
export const MOSQUITO_DB = Object.freeze({ far: -34, near: -22, landed: -24 });
const SEMITONE_7 = Math.pow(2, 7 / 12);

function defaultFactory() {
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctor) throw new Error('AUDIO_UNSUPPORTED');
  return new Ctor();
}

export function createSfx({ ctxFactory = defaultFactory, storage = null, keepAlive = false, maxVoices = 8, dedupeMs = 40 } = {}) {
  let enabled = false, volume = 1, unlocked = false, ctx = null, bus = null, master = null, limiter = null, noise = null;
  const voices = [], lastPlayed = new Map();
  let mosq = null, tickNext = null, lateTicks = 0;

  try {
    const saved = JSON.parse(storage?.getItem(SFX_KEY) ?? 'null');
    if (saved && typeof saved === 'object') { enabled = saved.enabled === true; volume = clamp(saved.volume, 0, 1, 1); }
  } catch { /* storage blocked or corrupt: stay muted with defaults */ }
  const save = () => { try { storage?.setItem(SFX_KEY, JSON.stringify({ enabled, volume })); } catch { /* private window: keep working without memory */ } };
  const masterLevel = () => enabled ? 0.5 * volume * volume : 0;
  const ready = () => enabled && unlocked && ctx && ctx.state !== 'suspended' && ctx.state !== 'closed';
  const setParam = (param, value, tau = 0.02) => { param.setTargetAtTime(value, ctx.currentTime, tau); };

  function build() {
    ctx = ctxFactory();
    bus = ctx.createGain(); master = ctx.createGain(); limiter = ctx.createDynamicsCompressor();
    bus.gain.value = 1; master.gain.value = masterLevel();
    const set = (param, value) => { param.value = value; };
    set(limiter.threshold, -14); set(limiter.knee, 12); set(limiter.ratio, 8); set(limiter.attack, 0.003); set(limiter.release, 0.15);
    bus.connect(master); master.connect(limiter); limiter.connect(ctx.destination);
    const length = Math.max(1, Math.round(ctx.sampleRate * 0.6)), buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    noise = buffer;
  }

  // Must run inside a click handler. Returns true once the context is running.
  async function unlock() {
    if (unlocked) { if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* still locked */ } } return unlocked; }
    try {
      if (!ctx) build();
      if (ctx.state !== 'running') await ctx.resume();
      unlocked = true;
    } catch { unlocked = false; }
    return unlocked;
  }

  function forget(voice) {
    const i = voices.indexOf(voice); if (i >= 0) voices.splice(i, 1);
    for (const node of voice.nodes) { try { node.disconnect(); } catch { /* already disconnected */ } }
  }
  function kill(voice) {
    for (const source of voice.sources) { try { source.stop(0); } catch { /* not started or already stopped */ } }
    forget(voice);
  }
  // A voice is everything one play() call creates; it disconnects itself when its last source ends.
  function openVoice(name) {
    const voice = { name, start: Infinity, end: 0, sources: [], nodes: [], open: 0 };
    const t = ctx.currentTime;
    const add = (source, from, to) => {
      voice.sources.push(source); voice.nodes.push(source); voice.open++;
      voice.start = Math.min(voice.start, from); voice.end = Math.max(voice.end, to);
      source.onended = () => { if (--voice.open <= 0) forget(voice); };
    };
    // One oscillator with a decaying envelope: attack `a` s linear to the peak, then exponential to silence at `dur`.
    const tone = ({ type = 'sine', f0, f1, at = 0, dur, a = 0.002, peak, filter, trem, vibrato }) => {
      const t0 = t + Math.max(0, at), gain = ctx.createGain(), osc = ctx.createOscillator();
      osc.type = type; osc.frequency.setValueAtTime(f0, t0);
      if (finite(f1) && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      const attack = Math.min(a, dur / 2), level = db(peak);
      gain.gain.setValueAtTime(0, t0); gain.gain.linearRampToValueAtTime(level, t0 + attack); gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let node = osc;
      if (filter) { const f = ctx.createBiquadFilter(); f.type = filter.type; f.frequency.setValueAtTime(filter.freq, t0); if (filter.freq1) f.frequency.exponentialRampToValueAtTime(filter.freq1, t0 + dur); if (filter.q) f.Q.value = filter.q; node.connect(f); voice.nodes.push(f); node = f; }
      if (trem) {   // amplitude tremolo: a low-frequency oscillator wobbling a gain stage
        const stage = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
        stage.gain.value = 1 - trem.depth; depth.gain.value = trem.depth; lfo.frequency.value = trem.hz;
        lfo.connect(depth); depth.connect(stage.gain); node.connect(stage); voice.nodes.push(stage, depth); node = stage;
        lfo.start(t0); lfo.stop(t0 + dur + 0.02); add(lfo, t0, t0 + dur);
      }
      node.connect(gain); gain.connect(bus); voice.nodes.push(gain);
      osc.start(t0); osc.stop(t0 + dur + 0.02); add(osc, t0, t0 + dur);
      return { gain, osc };
    };
    const burst = ({ at = 0, dur, a = 0.002, peak, filter, send }) => {
      const t0 = t + Math.max(0, at), gain = ctx.createGain(), src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
      src.buffer = noise; f.type = filter.type; f.frequency.setValueAtTime(filter.freq, t0);
      if (filter.freq1) f.frequency.exponentialRampToValueAtTime(filter.freq1, t0 + dur);
      if (filter.q) f.Q.value = filter.q;
      gain.gain.setValueAtTime(0, t0); gain.gain.linearRampToValueAtTime(db(peak), t0 + Math.min(a, dur / 2)); gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(gain); gain.connect(bus); if (send) gain.connect(send);
      voice.nodes.push(f, gain);
      src.start(t0); src.stop(t0 + dur + 0.02); add(src, t0, t0 + dur);
      return { gain, src };
    };
    // Short single-delay "room" for explosions: 90 ms, feedback 0.25. A silent oscillator times its disconnection.
    const room = (tail) => {
      const delay = ctx.createDelay(0.2), feedback = ctx.createGain(), wet = ctx.createGain(), timer = ctx.createOscillator(), mute = ctx.createGain();
      delay.delayTime.value = 0.09; feedback.gain.value = 0.25; wet.gain.value = 0.3; mute.gain.value = 0;
      delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(bus);
      timer.connect(mute); mute.connect(bus); timer.start(t); timer.stop(t + tail); add(timer, t, t + tail);
      voice.nodes.push(delay, feedback, wet, mute);
      return delay;
    };
    return { voice, tone, burst, room };
  }

  const RECIPES = {
    catch(b, o) {
      const n = finite(o.combo) && o.combo > 0 ? Math.min(8, Math.floor(o.combo)) : 0, f = n ? COMBO_SCALE[n - 1] : 880;
      b.tone({ type: 'triangle', f0: f, f1: f * 1.5, dur: 0.22, a: 0.002, peak: SFX_PEAK_DB.catch - 3 });
      b.tone({ type: 'triangle', f0: f * SEMITONE_7, dur: 0.22, a: 0.002, peak: SFX_PEAK_DB.catch - 3 });
      b.burst({ dur: 0.04, a: 0.001, peak: -26, filter: { type: 'highpass', freq: 4000 } });
    },
    miss(b) { b.tone({ type: 'sawtooth', f0: 330, f1: 165, dur: 0.28, a: 0.005, peak: SFX_PEAK_DB.miss, filter: { type: 'lowpass', freq: 900 } }); },
    bombWarn(b, o) {
      const lead = clamp(o.leadMs, 0, 10000, 0) / 1000, base = Math.max(0, lead - 0.5);   // the three beeps close in on the impact
      for (const off of [0, 0.25, 0.42]) b.tone({ type: 'square', f0: 1200, at: base + off, dur: 0.06, a: 0.002, peak: SFX_PEAK_DB.bombWarn });
    },
    bomb(b, o) {
      const long = o.short !== true, dur = long ? 0.45 : 0.22, room = long ? b.room(0.9) : null;
      b.burst({ dur, a: 0.003, peak: SFX_PEAK_DB.bomb - 2, filter: { type: 'lowpass', freq: 2400, freq1: 180 }, send: room });
      b.tone({ type: 'sine', f0: 110, f1: long ? 40 : 50, dur: long ? 0.35 : 0.2, a: 0.003, peak: SFX_PEAK_DB.bomb - 3 });
    },
    avoid(b) {
      b.tone({ type: 'sine', f0: 600, f1: 900, dur: 0.12, a: 0.005, peak: SFX_PEAK_DB.avoid });
      b.burst({ dur: 0.1, a: 0.01, peak: SFX_PEAK_DB.avoid, filter: { type: 'bandpass', freq: 2500, q: 1 } });
    },
    swat(b) {
      b.burst({ dur: 0.06, a: 0.001, peak: SFX_PEAK_DB.swat, filter: { type: 'bandpass', freq: 1200, q: 2 } });
      b.tone({ type: 'sine', f0: 200, f1: 90, dur: 0.08, a: 0.002, peak: SFX_PEAK_DB.swat });
      b.tone({ type: 'triangle', f0: 880, at: 0.1, dur: 0.09, peak: -16 });
      b.tone({ type: 'triangle', f0: 1175, at: 0.19, dur: 0.12, peak: -16 });
    },
    bite(b) { b.tone({ type: 'square', f0: 700, f1: 250, dur: 0.18, a: 0.005, peak: SFX_PEAK_DB.bite, trem: { hz: 8, depth: 0.4 }, filter: { type: 'lowpass', freq: 1500 } }); },
    roundStart(b) { [392, 523, 659].forEach((f, i) => b.tone({ type: 'triangle', f0: f, at: i * 0.11, dur: 0.09, peak: SFX_PEAK_DB.roundStart })); },
    roundEnd(b) { [659, 523, 392, 262].forEach((f, i) => b.tone({ type: 'triangle', f0: f, at: i * 0.16, dur: i === 3 ? 0.4 : 0.14, peak: SFX_PEAK_DB.roundEnd })); },
    tick(b, o) { b.tone({ type: 'sine', f0: clamp(o.freq, 800, 3000, 1500), at: clamp(o.at, 0, 5, 0), dur: 0.02, a: 0.001, peak: SFX_PEAK_DB.tick }); }
  };
  RECIPES.hit = (b) => RECIPES.bomb(b, { short: true });
  RECIPES.dodge = RECIPES.avoid;
  // Result outcomes that end the mosquito (its hum must stop with them).
  const ENDS_MOSQUITO = new Set(['swat', 'bite']);

  function play(name, opts = {}) {
    const recipe = RECIPES[name];
    if (!recipe || !ready()) return false;
    const t = ctx.currentTime;
    if (opts.skipDedupe !== true) {
      const last = lastPlayed.get(name);
      if (last !== undefined && t - last < dedupeMs / 1000) return false;
      lastPlayed.set(name, t);
    }
    if (ENDS_MOSQUITO.has(name)) mosquitoLoop.stop();
    for (const v of voices.filter(v => v.end <= t)) forget(v);
    for (;;) {   // at most maxVoices sounding at once: make room by dropping the oldest of the same sound, else the oldest of all
      const sounding = voices.filter(v => v.start <= t);
      if (sounding.length < maxVoices) break;
      kill(sounding.find(v => v.name === name) ?? sounding[0]);
    }
    const builder = openVoice(name);
    try { recipe(builder, opts); } catch { kill(builder.voice); return false; }
    if (builder.voice.sources.length === 0) return false;
    voices.push(builder.voice);
    return true;
  }

  // The mosquito hum: a sawtooth with 6 Hz vibrato whose pitch and level follow the mosquito; the ticking while it sits on the face lives here too.
  const mosquitoLoop = {
    start() {
      if (mosq || !ready()) return false;
      const osc = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), low = ctx.createBiquadFilter(), gain = ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = 380; lfo.frequency.value = 6; depth.gain.value = 12;
      low.type = 'lowpass'; low.frequency.value = 1800; gain.gain.value = 0.0001;
      lfo.connect(depth); depth.connect(osc.frequency); osc.connect(low); low.connect(gain); gain.connect(bus);
      osc.start(); lfo.start();
      mosq = { osc, lfo, depth, low, gain }; tickNext = null; lateTicks = 0;
      setParam(gain.gain, db(MOSQUITO_DB.far), 0.05);
      return true;
    },
    // dist: 0 at the face .. 1 far away. landed: sitting on the face; progress: 0..1 over the landing window.
    update({ dist = 1, landed = false, progress = 0 } = {}) {
      if (!mosq || !ready()) return false;
      const d = clamp(dist, 0, 1, 1), p = clamp(progress, 0, 1, 0), t = ctx.currentTime;
      const freq = landed ? 520 : 380 + 120 * (1 - d);
      const level = landed ? db(MOSQUITO_DB.landed) : db(MOSQUITO_DB.far) + (db(MOSQUITO_DB.near) - db(MOSQUITO_DB.far)) * (1 - d);
      setParam(mosq.osc.frequency, freq, 0.05); setParam(mosq.gain.gain, level, 0.05); setParam(mosq.lfo.frequency, landed ? 9 : 6, 0.05);
      if (!landed) { tickNext = null; lateTicks = 0; return true; }
      // Countdown ticks: every 250 ms, every 100 ms (rising in pitch) in the last quarter of the window.
      if (tickNext === null) tickNext = t;
      for (let guard = 0; tickNext <= t + 0.02 && guard < 8; guard++) {
        const late = p >= 0.75;
        play('tick', { freq: late ? 1500 + 60 * lateTicks : 1500, at: Math.max(0, tickNext - t), skipDedupe: true });
        if (late) lateTicks++;
        tickNext += late ? 0.1 : 0.25;
      }
      return true;
    },
    stop() {
      if (!mosq) return;
      const m = mosq; mosq = null; tickNext = null; lateTicks = 0;
      try { m.gain.gain.cancelScheduledValues?.(ctx.currentTime); m.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03); m.osc.stop(ctx.currentTime + 0.25); m.lfo.stop(ctx.currentTime + 0.25); } catch { /* already stopped */ }
      m.osc.onended = () => { for (const n of [m.osc, m.lfo, m.depth, m.low, m.gain]) { try { n.disconnect(); } catch { /* gone */ } } };
    },
    get active() { return Boolean(mosq); }
  };

  function setEnabled(on) {
    enabled = Boolean(on); save();
    if (!enabled) { mosquitoLoop.stop(); for (const v of [...voices]) kill(v); }
    if (master) setParam(master.gain, masterLevel(), 0.02);
  }
  function setVolume(v) {
    volume = clamp(v, 0, 1, volume); save();
    if (master) setParam(master.gain, masterLevel(), 0.02);
  }
  function suspend() {
    if (keepAlive || !ctx) return;
    mosquitoLoop.stop();
    try { Promise.resolve(ctx.suspend()).catch(() => {}); } catch { /* nothing to suspend */ }
  }
  function resume() {
    if (!ctx || !unlocked) return;
    try { Promise.resolve(ctx.resume()).catch(() => {}); } catch { /* stays suspended until the next click */ }
  }
  const status = () => !enabled ? 'MUTED' : unlocked ? 'AUDIO READY' : 'AUDIO LOCKED';

  return { unlock, setEnabled, setVolume, play, mosquitoLoop, suspend, resume, status,
    get enabled() { return enabled; }, get volume() { return volume; }, get unlocked() { return unlocked; } };
}
