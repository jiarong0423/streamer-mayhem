#!/usr/bin/env node
// Headless simulated play-through (theme): the real engine and the real wave generator against a bot streamer who leans the hoop at a fixed speed.
// Answers "are the balls reachable, and what happens at different lean speeds?" without a camera.
// Usage: node scripts/sim-play.mjs [--rounds=40] [--json=path]
// The bot: sees where the next shot lands (the landing ring is visible), starts moving `react` ms after the shot appears, moves at `speed` window widths per second,
// catches balls by being under them at the landing time, and steps out of the way of a pie when it would cover it.
import { MatrixGame, gradeFor } from '../dist/matrix.mjs';
import { DropWaves } from '../dist/drop_waves.mjs';
import { dropLandX, DROP_CATCH_HALF } from '../dist/drop_lanes.mjs';
import { writeFileSync } from 'node:fs';

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const ROUNDS = Number(arg('rounds', 40)), ROUND_MS = 75000, STEP = 33;
const THEME = { maxActive: 3, fallMin: 2200, fallMax: 3800, fallFloor: 1500, speedFactor: [1.1, 1.5], gapMin: 550, gapMax: 2400, gapBase: 800, gapMean: 1000, gapFloor: 550, laneStepMs: 450, bombStart: .12, bombEnd: .22, columnWeights: [.06, .88, .06], maxSame: 4 };

function playRound(seed, { speed, react, staggered, crops = 'none' }) {
  const clock = { now: 0 }, results = [];
  const game = new MatrixGame({ clock: () => clock.now, onEvent: (e) => { if (e.type === 'result') results.push(e); }, options: staggered ? { landJitter: .12, avoidScore: 0 } : {} });
  game.setConnection(true); game.start();
  let serial = 0, frame = 0, x = .5;
  const waves = new DropWaves({ seed, ...(staggered ? { ...THEME, landXFor: (c, t) => dropLandX(c, `wave-${serial + 1}-${t}`, .12) } : {}) });
  let nextCrop = 20000;   // auto-framing wants to re-frame at 20 s, 40 s and 60 s
  const seen = new Map();   // eventId -> {x (landing), at (appeared), due, bomb}
  for (clock.now = 0; clock.now < ROUND_MS; clock.now += STEP) {
    const now = clock.now;
    const next = waves.update(now, game.attacks.length);
    if (next) {
      const id = `wave-${++serial}-${next.tag ?? 0}`;
      const r = game.receiveWaveDrop({ notificationId: id, messageId: id, actorId: id, receivedAt: now }, { column: next.column, variant: next.variant, fall: next.fall });
      if (r.accepted) seen.set(id, { x: r.landX ?? [.35, .5, .65][next.column - 1], at: now, due: now + next.fall, bomb: next.variant === 'BOMB' });
    }
    // auto-framing: ungated it applies the crop at once (which clears every ball on screen), gated it waits until the field is clear
    if (crops !== 'none' && now >= nextCrop && (crops === 'ungated' || game.attacks.length === 0)) { game.invalidateTracking(); nextCrop += 20000; }
    // the bot: aim at the earliest pending ball (or dodge the earliest pie that would be covered)
    const pending = game.attacks.map((a) => seen.get(a.eventId)).filter(Boolean).sort((p, q) => p.due - q.due);
    const visible = pending.filter((p) => now - p.at >= react);
    let target = x;
    const ball = visible.find((p) => !p.bomb);
    if (ball) target = ball.x;
    const pie = visible.find((p) => p.bomb && Math.abs(target - p.x) < DROP_CATCH_HALF + .02);
    if (pie) target = pie.x < .5 ? pie.x + DROP_CATCH_HALF + .03 : pie.x - DROP_CATCH_HALF - .03;
    const step = speed * STEP / 1000;
    x += Math.max(-step, Math.min(step, target - x));
    frame++; game.addFrame({ frameId: `f${frame}`, captureTime: now, nose: { x, y: .5, visibility: 1 }, leftShoulder: null, rightShoulder: null }); game.tick();
  }
  const count = (o) => results.filter((r) => r.kind === 'DROP' && r.outcome === o).length;
  return { shots: results.filter((r) => r.kind === 'DROP').length, caught: count('CATCH'), missed: count('MISS'), pieHit: count('BOMB'), pieDodged: count('AVOID'), unknown: count('UNKNOWN'), score: game.score };
}

function table(label, opts) {
  const rows = [];
  for (let s = 1; s <= ROUNDS; s++) rows.push(playRound(s, opts));
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0), balls = sum('caught') + sum('missed');
  const out = { label, rounds: ROUNDS, shotsPerRound: +(sum('shots') / ROUNDS).toFixed(1), catchRate: +(sum('caught') / Math.max(1, balls) * 100).toFixed(1), pieHitPerRound: +(sum('pieHit') / ROUNDS).toFixed(2), pieDodgedPerRound: +(sum('pieDodged') / ROUNDS).toFixed(2), unknownPerRound: +(sum('unknown') / ROUNDS).toFixed(2), avgScore: Math.round(sum('score') / ROUNDS), grades: {} };
  for (const r of rows) { const g = gradeFor(r.score) ?? '-'; out.grades[g] = (out.grades[g] ?? 0) + 1; }
  return out;
}

const report = [
  table('original waves, bot 0.30 w/s', { speed: .30, react: 250, staggered: false }),
  table('theme staggered, bot 0.45 w/s (quick)', { speed: .45, react: 250, staggered: true }),
  table('theme staggered, bot 0.30 w/s (assumed)', { speed: .30, react: 250, staggered: true }),
  table('theme staggered, bot 0.22 w/s (slow)', { speed: .22, react: 250, staggered: true }),
  table('theme staggered, bot 0.30 w/s, slow reaction 450 ms', { speed: .30, react: 450, staggered: true }),
  table('theme staggered, bot 0.15 w/s (very slow)', { speed: .15, react: 250, staggered: true }),
  table('theme + 3 auto re-frames, UNGATED (the bug: balls cleared)', { speed: .30, react: 250, staggered: true, crops: 'ungated' }),
  table('theme + 3 auto re-frames, GATED (the fix)', { speed: .30, react: 250, staggered: true, crops: 'gated' })
];
for (const r of report) console.log(JSON.stringify(r));
const path = arg('json', '');
if (path) writeFileSync(path, JSON.stringify(report, null, 2));
