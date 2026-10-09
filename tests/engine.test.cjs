"use strict";
const assert = require("node:assert/strict");
const BlinkEngine = require("../engine.js");

function fixed() { return 0.5; }
function seeded(seed = 17) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function near(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`);
}
function equalState(a, b) {
  for (const key of Object.keys(a)) {
    if (typeof a[key] === "number") near(a[key], b[key]);
    else assert.equal(a[key], b[key], key);
  }
}

const engine = new BlinkEngine({ rng: fixed });
assert.equal(engine.snapshot().status, "ready");
equalState(engine.step(100), engine.snapshot());
assert.equal(engine.blink(), false);
engine.start();
const start = engine.snapshot();
engine.step(3);
let state = engine.snapshot();
assert.equal(state.x, start.x, "Eyes open must freeze all character movement");
assert.ok(state.dryness > 0 && state.dryness < 100);
near(state.elapsed, 3);
near(state.gazeTime, 3);
const predictedRest = state.nextRest;
assert.equal(engine.blink(), true);
assert.equal(engine.blink(), false);
assert.equal(engine.open(), false, "Locked rest cannot be cancelled");
state = engine.snapshot();
near(state.minRest, predictedRest);
engine.step(predictedRest / 2);
assert.equal(engine.snapshot().eye, "closed");
assert.ok(engine.snapshot().x > 0.5);
assert.ok(engine.snapshot().dryness < state.dryness);
assert.equal(engine.open(), false);
const closedX = engine.snapshot().x;
engine.step(predictedRest / 2 + 0.4);
state = engine.snapshot();
assert.equal(state.eye, "open", "Completed rest automatically reopens eyes");
near(state.gazeTime, 0.4);
assert.ok(state.x > closedX);
const reopenedX = state.x;
engine.step(1);
assert.equal(engine.snapshot().x, reopenedX);

const shortGaze = new BlinkEngine({ rng: fixed });
const longGaze = new BlinkEngine({ rng: fixed });
shortGaze.start(); longGaze.start();
shortGaze.step(1); longGaze.step(4);
assert.ok(longGaze.estimateRest() > 3 * shortGaze.estimateRest(),
  "Long gazes incur a nonlinear rest penalty");

const forced = new BlinkEngine({ rng: fixed });
forced.start(); forced.step(8);
assert.equal(forced.snapshot().eye, "closed");
assert.equal(forced.snapshot().forcedBlinks, 1);
assert.ok(forced.snapshot().minRest > longGaze.estimateRest());
assert.ok(forced.snapshot().x > 0.5);

const continuous = new BlinkEngine({ rng: seeded() });
const partitioned = new BlinkEngine({ rng: seeded() });
continuous.start(); partitioned.start();
continuous.step(50);
for (let i = 0; i < 3000; i++) partitioned.step(1 / 60);
equalState(continuous.snapshot(), partitioned.snapshot());
assert.equal(continuous.snapshot().status, "ended");
assert.ok(Math.abs(continuous.snapshot().x - 0.5) >= 0.6 - 1e-10);
const finished = continuous.snapshot();
continuous.step(100); continuous.blink(); continuous.open();
equalState(continuous.snapshot(), finished);

const pause = new BlinkEngine({ rng: fixed });
pause.start(); pause.step(2); pause.blink(); pause.step(0.1);
assert.equal(pause.pause(), true);
const paused = pause.snapshot();
pause.step(100);
equalState(pause.snapshot(), paused);
assert.equal(pause.blink(), false);
assert.equal(pause.open(), false);
assert.equal(pause.resume(), true);
pause.step(0.1);
assert.ok(pause.snapshot().elapsed > paused.elapsed);

const invalid = new BlinkEngine({ rng: () => NaN, exitMargin: NaN });
invalid.start();
const beforeInvalid = invalid.snapshot();
for (const dt of [undefined, null, "1", -1, NaN, Infinity, 0]) {
  equalState(invalid.step(dt), beforeInvalid);
}
assert.equal(invalid.blink(), true);
invalid.step(0.5);
assert.ok(Number.isFinite(invalid.snapshot().x));
const customMargin = new BlinkEngine({ rng: fixed, exitMargin: 0.2 });
customMargin.start(); customMargin.step(1000);
near(customMargin.snapshot().x, 1.2);

function survival(gazeInterval, seed) {
  const game = new BlinkEngine({ rng: seeded(seed) });
  game.start();
  while (game.snapshot().status === "playing") {
    const current = game.snapshot();
    if (current.eye === "open" && current.gazeTime >= gazeInterval - 1e-10) game.blink();
    const next = game.snapshot();
    const duration = next.eye === "closed"
      ? next.minRest - next.closeTime
      : Math.min(0.05, gazeInterval - next.gazeTime);
    game.step(Math.max(1e-8, duration));
  }
  return game.snapshot().elapsed;
}
const samples = Array.from({ length: 12 }, (_, i) => survival(1.8, i + 1));
assert.ok(samples.every(t => t >= 20 && t <= 100));
console.log("Engine behavior checks passed: freeze, recovery lock, automatic reopen, forced blink,");
console.log("frame-rate independence, pause, loss boundary, invalid inputs and deterministic randomness.");
console.log(`Balanced 1.8-second gaze samples: ${Math.min(...samples).toFixed(1)}–${Math.max(...samples).toFixed(1)} s.`);
