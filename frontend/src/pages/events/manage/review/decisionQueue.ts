export type DecisionKind = 'accept' | 'reject';

export interface Decision {
  id: string;
  kind: DecisionKind;
  reason?: string;
}

export type SendOutcome = { ok: true } | { ok: false; code: string | null; message: string };

export interface Clock {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

/** Сколько секунд решение можно вернуть, пока оно не ушло человеку. */
export const UNDO_WINDOW_MS = 5000;

const realClock: Clock = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function outcomeOf(error: unknown): SendOutcome {
  const e = (error && typeof error === 'object' ? error : {}) as { code?: unknown; message?: unknown };
  return {
    ok: false,
    code: typeof e.code === 'string' ? e.code : null,
    message: typeof e.message === 'string' ? e.message : '',
  };
}

export interface DecisionQueue<D extends Decision> {
  /** Новое решение ждёт окно «Вернуть»; предыдущее, если ещё ждало, уходит сразу. */
  push: (decision: D) => void;
  /** Отменить ждущее решение без запроса. Без id — любое ждущее. */
  undo: (id?: string) => D | null;
  /** Отправить ждущее решение сейчас: следующее решение, уход со страницы, закрытие стопки. */
  flush: () => Promise<void>;
  held: () => D | null;
  /** Дождаться всех начатых отправок. */
  idle: () => Promise<void>;
}

/**
 * Отложенная отправка решений по заявкам. Держит одно решение в окне «Вернуть», отправляет строго по
 * очереди и сообщает итог каждой отправки. Часы подменяются в проверках.
 */
export function createDecisionQueue<D extends Decision>(opts: {
  send: (decision: D) => Promise<unknown>;
  onSettled: (decision: D, outcome: SendOutcome) => void;
  onHeldChange?: (decision: D | null) => void;
  clock?: Clock;
  windowMs?: number;
}): DecisionQueue<D> {
  const clock = opts.clock ?? realClock;
  const windowMs = opts.windowMs ?? UNDO_WINDOW_MS;
  let held: D | null = null;
  let timer: unknown = null;
  let chain: Promise<void> = Promise.resolve();

  const setHeld = (next: D | null) => {
    if (timer !== null) clock.clear(timer);
    timer = null;
    held = next;
    opts.onHeldChange?.(next);
  };

  const dispatch = (decision: D) => {
    chain = chain.then(async () => {
      let outcome: SendOutcome;
      try {
        await opts.send(decision);
        outcome = { ok: true };
      } catch (error) {
        outcome = outcomeOf(error);
      }
      opts.onSettled(decision, outcome);
    });
    return chain;
  };

  const flush = () => {
    const decision = held;
    if (!decision) return chain;
    setHeld(null);
    return dispatch(decision);
  };

  return {
    push(decision) {
      void flush();
      setHeld(decision);
      timer = clock.set(() => {
        timer = null;
        void flush();
      }, windowMs);
    },
    undo(id) {
      const decision = held;
      if (!decision || (id !== undefined && decision.id !== id)) return null;
      setHeld(null);
      return decision;
    },
    flush,
    held: () => held,
    idle: () => chain,
  };
}
