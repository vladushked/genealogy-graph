/**
 * Smooth transitions for the live graph: every faded value (an opacity, a radius) eases toward its target each frame
 * instead of jumping, so highlighting generations or selecting people blends in and out.
 */

/** Time constant of the easing: about 95% of a change is done in three of these (~240 ms). */
export const FADE_MS = 80;

export class Fader {
  private values = new Map<string, number>();
  private time: number | null = null;
  private step = 1;
  /** True when a value read this frame has not reached its target yet. */
  moving = false;

  /** Starts a frame at `now` (ms); a frame after a pause eases as if one display frame passed. */
  begin(now: number) {
    const elapsed = this.time === null ? 1000 / 60 : Math.min(100, Math.max(0, now - this.time));
    this.time = now;
    this.step = 1 - Math.exp(-elapsed / FADE_MS);
    this.moving = false;
  }

  /** Ends a frame; once everything has settled the next change starts from a fresh clock. */
  end() { if (!this.moving) this.time = null; }

  /** The current value of `key`, moved one frame toward `target`. A new key starts at `initial`. */
  value(key: string, target: number, initial = target): number {
    const current = this.values.get(key) ?? initial;
    let next = current + (target - current) * this.step;
    if (Math.abs(next - target) <= Math.max(0.004, Math.abs(target) * 0.002)) next = target;
    else this.moving = true;
    this.values.set(key, next);
    return next;
  }
}
