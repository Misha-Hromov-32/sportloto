export type SwipeDir = 'left' | 'right' | 'up';

export interface DeckState {
  order: string[];
  index: number;
  decisions: Record<string, SwipeDir>;
  last: { key: string; dir: SwipeDir } | null;
  actions: number;
}

export const SWIPE = {
  slop: 8,
  threshold: 0.35,
  velocity: 0.5,
  maxRotate: 12,
  returnMs: 200,
  flyMs: 250,
  hintActions: 3,
} as const;

export function createDeck(keys: readonly string[]): DeckState {
  return { order: [...new Set(keys)], index: 0, decisions: {}, last: null, actions: 0 };
}

export const currentKey = (s: DeckState): string | null => s.order[s.index] ?? null;
export const remaining = (s: DeckState): number => Math.max(0, s.order.length - s.index);
export const isDone = (s: DeckState): boolean => s.index >= s.order.length;
export const upcomingKeys = (s: DeckState, depth = 3): string[] => s.order.slice(s.index, s.index + depth);

export function decide(s: DeckState, dir: SwipeDir, key = currentKey(s)): DeckState {
  if (key === null || currentKey(s) !== key) return s;
  return {
    ...s,
    index: s.index + 1,
    decisions: { ...s.decisions, [key]: dir },
    last: { key, dir },
    actions: s.actions + 1,
  };
}

/** «Решу позже»: карточка уходит в конец стопки без решения. */
export function postpone(s: DeckState, key = currentKey(s)): DeckState {
  if (key === null || currentKey(s) !== key || remaining(s) < 2) return s;
  const order = s.order.filter((k) => k !== key);
  order.push(key);
  return { ...s, order, last: null, actions: s.actions + 1 };
}

/** Одна глубина: возвращается только последнее решение. */
export function undo(s: DeckState): { state: DeckState; key: string; dir: SwipeDir } | null {
  if (!s.last) return null;
  const { key, dir } = s.last;
  const at = s.order.indexOf(key);
  if (at === -1 || s.decisions[key] !== dir) return null;
  const order = s.order.filter((k) => k !== key);
  const index = Math.min(s.index - (at < s.index ? 1 : 0), order.length);
  order.splice(index, 0, key);
  const decisions = { ...s.decisions };
  delete decisions[key];
  return { state: { ...s, order, index, decisions, last: null }, key, dir };
}

/** Действие не удалось: карточка снова сверху, решение снято. */
export function restore(s: DeckState, key: string): DeckState {
  const at = s.order.indexOf(key);
  if (at === -1 || at >= s.index) return s;
  const order = s.order.filter((k) => k !== key);
  const index = s.index - 1;
  order.splice(index, 0, key);
  const decisions = { ...s.decisions };
  delete decisions[key];
  return { ...s, order, index, decisions, last: s.last?.key === key ? null : s.last };
}

/** Убрать карточки, которых больше нет (отменили, сняли). */
export function drop(s: DeckState, keys: readonly string[]): DeckState {
  const gone = new Set(keys.filter((k) => s.order.includes(k)));
  if (!gone.size) return s;
  const before = s.order.slice(0, s.index).filter((k) => gone.has(k)).length;
  const decisions = { ...s.decisions };
  gone.forEach((k) => delete decisions[k]);
  return {
    ...s,
    order: s.order.filter((k) => !gone.has(k)),
    index: s.index - before,
    decisions,
    last: s.last && gone.has(s.last.key) ? null : s.last,
  };
}

export const keysWith = (s: DeckState, dir: SwipeDir): string[] =>
  s.order.filter((k) => s.decisions[k] === dir);

export function axisLock(dx: number, dy: number, slop: number = SWIPE.slop): 'x' | 'y' | null {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/** Сработает ли свайп: дальше 35% ширины или резкий взмах в ту же сторону. */
export function swipeOutcome(
  dx: number,
  width: number,
  velocity: number,
  opts: { threshold?: number; minVelocity?: number } = {},
): 'left' | 'right' | null {
  const threshold = opts.threshold ?? SWIPE.threshold;
  const minVelocity = opts.minVelocity ?? SWIPE.velocity;
  if (width <= 0) return null;
  if (Math.abs(dx) >= width * threshold) return dx > 0 ? 'right' : 'left';
  if (
    Math.abs(velocity) >= minVelocity &&
    Math.sign(velocity) === Math.sign(dx) &&
    Math.abs(dx) >= SWIPE.slop
  )
    return velocity > 0 ? 'right' : 'left';
  return null;
}

/** Доля пути до порога, 0…1: от неё зависят яркость штампа и подъём следующей карточки. */
export function dragProgress(dx: number, width: number, threshold: number = SWIPE.threshold): number {
  if (width <= 0) return 0;
  return Math.min(1, Math.abs(dx) / (width * threshold));
}

export function dragRotation(dx: number, width: number, max: number = SWIPE.maxRotate): number {
  if (width <= 0) return 0;
  const r = (dx / width) * max * 1.5;
  return Math.max(-max, Math.min(max, r));
}

export interface Sample {
  x: number;
  t: number;
}

/** Для скорости взмаха хватает последних 100 мс движения. */
export function recentSamples(samples: Sample[], now: number, windowMs = 100): Sample[] {
  const kept = samples.filter((s) => now - s.t <= windowMs);
  return kept.length >= 2 ? kept : samples.slice(-2);
}

/** Скорость в момент отпускания, px/мс. */
export function releaseVelocity(samples: readonly Sample[]): number {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last || last.t <= first.t) return 0;
  return (last.x - first.x) / (last.t - first.t);
}

export function progressLabel(s: DeckState): string {
  const total = s.order.length;
  return `${Math.min(s.index + 1, total)} из ${total}`;
}
