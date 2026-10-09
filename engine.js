/* Pure, deterministic game rules. All time values are seconds. */
(function (root, factory) {
  "use strict";
  const Engine = factory();
  if (typeof module === "object" && module.exports) module.exports = Engine;
  if (root) root.BlinkEngine = Engine;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RULES = Object.freeze({
    dryBase: 7.4,
    dryDifficulty: 0.028,
    dryGazeAcceleration: 1.4,
    restBase: 0.16,
    restGazeSquared: 0.033,
    restDryness: 0.0024,
    forcedRestPenalty: 0.76,
    recoveryFraction: 0.18,
    speedBase: 0.057,
    speedAcceleration: 0.0024,
    speedMaximum: 0.235,
    reverseChance: 0.09,
    forcedReverseChance: 0.03,
    reverseCooldown: 4,
  });

  class BlinkEngine {
    constructor(options) {
      options = options && typeof options === "object" ? options : {};
      this._rng = typeof options.rng === "function" ? options.rng : Math.random;
      this.exitMargin = Number.isFinite(options.exitMargin)
        ? Math.max(0, Math.min(0.5, options.exitMargin))
        : 0.1;
      this._reset("ready");
    }

    _reset(status) {
      this._status = status;
      this._eye = "open";
      this._elapsed = 0;
      this._dryness = 0;
      this._x = 0.5;
      this._gazeTime = 0;
      this._closeTime = 0;
      this._minRest = 0;
      this._blinks = 0;
      this._forcedBlinks = 0;
      this._direction = 1;
      this._endReason = null;
      this._recoveryRate = 0;
      this._recoveryTarget = 0;
      this._sinceReverse = RULES.reverseCooldown;
    }

    _random() {
      let value;
      try { value = this._rng(); } catch (_) { value = 0.5; }
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
    }

    start() {
      this._reset("playing");
      return this.snapshot();
    }

    _restFor(forced) {
      return RULES.restBase
        + RULES.restGazeSquared * this._gazeTime * this._gazeTime
        + RULES.restDryness * this._dryness
        + (forced ? RULES.forcedRestPenalty : 0);
    }

    estimateRest() {
      return this._eye === "closed" ? this._minRest : this._restFor(false);
    }

    _beginBlink(forced) {
      this._eye = "closed";
      this._closeTime = 0;
      this._minRest = this._restFor(forced);
      this._blinks += 1;
      if (forced) this._forcedBlinks += 1;
      this._recoveryTarget = this._dryness * RULES.recoveryFraction;
      this._recoveryRate = (this._dryness - this._recoveryTarget) / this._minRest;

      // Movement is predominantly toward the nearest exit. Occasional feints
      // are separated by four blinks, so repeated lucky reversals are bounded.
      if (Math.abs(this._x - 0.5) < 1e-10) {
        this._direction = this._random() < 0.5 ? -1 : 1;
      } else {
        const outward = this._x < 0.5 ? -1 : 1;
        const mayReverse = this._sinceReverse >= RULES.reverseCooldown
          && Math.abs(this._x - 0.5) > 0.14;
        const chance = forced ? RULES.forcedReverseChance : RULES.reverseChance;
        if (mayReverse && this._random() < chance) {
          this._direction = -outward;
          this._sinceReverse = 0;
        } else {
          this._direction = outward;
          this._sinceReverse += 1;
        }
      }
    }

    blink() {
      if (this._status !== "playing" || this._eye !== "open") return false;
      this._beginBlink(false);
      return true;
    }

    open() {
      if (this._status !== "playing" || this._eye !== "closed"
        || this._closeTime + 1e-10 < this._minRest) return false;
      this._eye = "open";
      this._gazeTime = 0;
      this._closeTime = 0;
      this._minRest = 0;
      this._dryness = this._recoveryTarget;
      return true;
    }

    pause() {
      if (this._status !== "playing") return false;
      this._status = "paused";
      return true;
    }

    resume() {
      if (this._status !== "paused") return false;
      this._status = "playing";
      return true;
    }

    _speed() {
      return Math.min(RULES.speedMaximum,
        RULES.speedBase + RULES.speedAcceleration * this._elapsed);
    }

    _travel(time) {
      const speed = this._speed();
      const acceleratingTime = Math.min(time,
        Math.max(0, (RULES.speedMaximum - speed) / RULES.speedAcceleration));
      return speed * acceleratingTime
        + 0.5 * RULES.speedAcceleration * acceleratingTime * acceleratingTime
        + RULES.speedMaximum * (time - acceleratingTime);
    }

    _timeToTravel(distance) {
      if (distance <= 0) return 0;
      const speed = this._speed();
      const acceleratingTime = Math.max(0,
        (RULES.speedMaximum - speed) / RULES.speedAcceleration);
      const acceleratingDistance = speed * acceleratingTime
        + 0.5 * RULES.speedAcceleration * acceleratingTime * acceleratingTime;
      if (distance <= acceleratingDistance) {
        return 2 * distance / (speed
          + Math.sqrt(speed * speed + 2 * RULES.speedAcceleration * distance));
      }
      return acceleratingTime + (distance - acceleratingDistance) / RULES.speedMaximum;
    }

    _timeToForcedBlink() {
      const remainingDryness = Math.max(0, 100 - this._dryness);
      const rate = RULES.dryBase + RULES.dryDifficulty * this._elapsed
        + RULES.dryGazeAcceleration * this._gazeTime;
      const acceleration = RULES.dryDifficulty + RULES.dryGazeAcceleration;
      return 2 * remainingDryness / (rate
        + Math.sqrt(rate * rate + 2 * acceleration * remainingDryness));
    }

    _advanceOpen(time) {
      const rate = RULES.dryBase + RULES.dryDifficulty * this._elapsed
        + RULES.dryGazeAcceleration * this._gazeTime;
      this._dryness = Math.min(100, this._dryness + rate * time
        + 0.5 * (RULES.dryDifficulty + RULES.dryGazeAcceleration) * time * time);
      this._gazeTime += time;
      this._elapsed += time;
    }

    step(dt) {
      if (this._status !== "playing" || !Number.isFinite(dt) || dt <= 0) {
        return this.snapshot();
      }
      let remaining = dt;
      while (remaining > 0 && this._status === "playing") {
        if (this._eye === "open") {
          const untilForced = this._timeToForcedBlink();
          const time = Math.min(remaining, untilForced);
          this._advanceOpen(time);
          remaining = Math.max(0, remaining - time);
          if (time >= untilForced) {
            this._dryness = 100;
            this._beginBlink(true);
          }
        } else {
          const untilOpen = Math.max(0, this._minRest - this._closeTime);
          const exit = this._direction < 0 ? -this.exitMargin : 1 + this.exitMargin;
          const untilExit = this._timeToTravel(Math.abs(exit - this._x));
          const time = Math.min(remaining, untilOpen, untilExit);
          this._x += this._direction * this._travel(time);
          this._dryness = Math.max(this._recoveryTarget,
            this._dryness - this._recoveryRate * time);
          this._elapsed += time;
          this._closeTime += time;
          remaining = Math.max(0, remaining - time);
          if (time >= untilExit) {
            this._x = exit;
            this._status = "ended";
            this._endReason = this._direction < 0 ? "escaped-left" : "escaped-right";
          } else if (time >= untilOpen) {
            this._closeTime = this._minRest;
            this.open();
          }
        }
      }
      return this.snapshot();
    }

    snapshot() {
      return {
        status: this._status,
        eye: this._eye,
        elapsed: this._elapsed,
        dryness: this._dryness,
        x: this._x,
        gazeTime: this._gazeTime,
        closeTime: this._closeTime,
        minRest: this._minRest,
        nextRest: this.estimateRest(),
        blinks: this._blinks,
        forcedBlinks: this._forcedBlinks,
        speed: this._speed(),
        direction: this._direction,
        endReason: this._endReason,
        exitMargin: this.exitMargin,
      };
    }
  }

  BlinkEngine.RULES = RULES;
  return BlinkEngine;
});
