import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { useSettings } from '@/theme/useSettings';

import { Button } from '../Button/Button';
import {
  axisLock,
  currentKey,
  decide,
  dragProgress,
  dragRotation,
  progressLabel,
  recentSamples,
  releaseVelocity,
  remaining,
  restore,
  swipeOutcome,
  undo,
  upcomingKeys,
  SWIPE,
  type DeckState,
  type SwipeDir,
} from './deck';
import styles from './SwipeDeck.module.css';

export interface SwipeAction<T> {
  /** Подпись кнопки: «Мимо», «Хочу пойти». */
  label: string;
  /** Штамп на карточке при свайпе: «МИМО», «БЕРУ». */
  stamp: string;
  icon: ReactNode;
  /** Что услышит экранный диктор после действия: «Сохранено». */
  announce: string;
  /** Причина, по которой действие недоступно для этой карточки. */
  disabled?: (item: T) => string | null | undefined;
  /** false — карточка ждёт результата (например, панели записи) и уходит только после успеха. */
  optimistic?: boolean;
  /** Вид центральной кнопки: главная («Записаться») или второстепенная («Решу позже»). */
  variant?: 'primary' | 'secondary';
}

/** false — действие не выполнено, карточка остаётся (или возвращается) в стопку. */
export type SwipeResult = void | boolean | { stamp?: string; announce?: string };

export interface SwipeCardContext {
  expanded: boolean;
  toggle: () => void;
}

interface SwipeDeckProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  itemLabel: (item: T) => string;
  state: DeckState;
  onStateChange: (update: (state: DeckState) => DeckState) => void;
  renderCard: (item: T, ctx: SwipeCardContext) => ReactNode;
  actions: { left: SwipeAction<T>; right: SwipeAction<T>; up?: SwipeAction<T> };
  onAction: (item: T, dir: SwipeDir) => SwipeResult | Promise<SwipeResult>;
  onUndo?: (item: T, dir: SwipeDir) => void;
  /** Подсказка у «Вернуть»: что возврат не отменяет. */
  undoHint?: (dir: SwipeDir) => string | undefined;
  /** Название стопки для диктора: «События по одной». */
  label: string;
  /** Кнопки над карточкой слева: «Списком», «Фильтры». */
  toolbar?: ReactNode;
  /** Esc: выйти из режима. */
  onExit?: () => void;
  exitLabel?: string;
  /** Сообщение для диктора снаружи (живое обновление). */
  notice?: string;
}

const reducedMotion = () =>
  document.documentElement.hasAttribute('data-simple') ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const IGNORE_DRAG = 'button, a, input, textarea, select, label, [role="button"], .leaflet-container';
const IGNORE_KEYS =
  'input, textarea, select, [contenteditable="true"], [role="dialog"], .ant-select, .ant-drawer, .ant-modal, .ant-popover';

interface Drag {
  id: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  axis: 'x' | 'y' | null;
  samples: { x: number; t: number }[];
  armed: boolean;
}

/**
 * Стопка карточек «по одной»: жест, три кнопки, клавиатура, «Вернуть» и объявления для диктора.
 * Состояние стопки хранит родитель (чтобы помнить позицию), логика — в deck.ts.
 */
export function SwipeDeck<T>({
  items,
  getKey,
  itemLabel,
  state,
  onStateChange,
  renderCard,
  actions,
  onAction,
  onUndo,
  undoHint,
  label,
  toolbar,
  onExit,
  exitLabel = 'выйти',
  notice,
}: SwipeDeckProps<T>) {
  const { settings } = useSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const busy = useRef(false);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const wantFocus = useRef(false);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [flyStamp, setFlyStamp] = useState<string | null>(null);
  const [enter, setEnter] = useState<{ key: string; dir: SwipeDir } | null>(null);
  const [live, setLive] = useState('');
  const [waiting, setWaiting] = useState(false);
  const reasonId = useId();

  const byKey = useMemo(() => new Map(items.map((item) => [getKey(item), item])), [items, getKey]);
  const topKey = currentKey(state);
  const top = topKey ? (byKey.get(topKey) ?? null) : null;
  const stack = upcomingKeys(state, 3)
    .map((key) => ({ key, item: byKey.get(key) }))
    .filter((c): c is { key: string; item: T } => c.item !== undefined);
  const expanded = expandedKey !== null && expandedKey === topKey;

  const announce = useCallback((text: string) => {
    setLive('');
    requestAnimationFrame(() => setLive(text));
  }, []);

  useEffect(() => {
    if (notice) announce(notice);
  }, [notice, announce]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-deck', '');
    return () => root.removeAttribute('data-deck');
  }, []);

  useLayoutEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    cardRef.current?.focus({ preventScroll: true });
  }, [topKey]);

  const setVars = (dx: number, dy: number, dir: SwipeDir | null) => {
    const card = cardRef.current;
    const root = rootRef.current;
    if (!card || !root) return;
    const width = card.offsetWidth;
    const p = dragProgress(dx, width);
    card.style.transform = `translate3d(${dx}px, ${dy * 0.2}px, 0) rotate(${dragRotation(dx, width)}deg)`;
    card.style.setProperty('--stamp-left', dir === 'left' ? String(p) : '0');
    card.style.setProperty('--stamp-right', dir === 'right' ? String(p) : '0');
    root.style.setProperty('--deck-p', String(p));
  };

  const resetCard = (animate: boolean) => {
    const card = cardRef.current;
    const root = rootRef.current;
    if (!card || !root) return;
    root.removeAttribute('data-dragging');
    card.style.transition = animate ? `transform ${SWIPE.returnMs}ms var(--ease)` : '';
    card.style.transform = '';
    card.style.setProperty('--stamp-left', '0');
    card.style.setProperty('--stamp-right', '0');
    card.style.removeProperty('--stamp-up');
    root.style.setProperty('--deck-p', '0');
    if (animate) window.setTimeout(() => card && (card.style.transition = ''), SWIPE.returnMs);
  };

  const fly = (dir: SwipeDir) =>
    new Promise<void>((resolve) => {
      const card = cardRef.current;
      rootRef.current?.removeAttribute('data-dragging');
      if (!card || reducedMotion()) {
        resolve();
        return;
      }
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const current = drag.current;
      const dy = current ? current.dy * 0.2 : 0;
      card.style.transition = `transform ${SWIPE.flyMs}ms ease-in, opacity ${SWIPE.flyMs}ms ease-in`;
      if (dir === 'up') {
        card.style.setProperty('--stamp-up', '1');
        card.style.transform = `translate3d(0, ${-h * 1.2}px, 0)`;
      } else {
        const sign = dir === 'right' ? 1 : -1;
        card.style.setProperty(dir === 'right' ? '--stamp-right' : '--stamp-left', '1');
        card.style.transform = `translate3d(${sign * w * 1.5}px, ${dy}px, 0) rotate(${sign * 18}deg)`;
      }
      card.style.opacity = '0';
      rootRef.current?.style.setProperty('--deck-p', '1');
      window.setTimeout(resolve, SWIPE.flyMs);
    });

  const afterMove = (next: DeckState, text: string) => {
    const left = remaining(next);
    announce(left > 0 ? `${text}. Осталось ${left}` : `${text}. Это была последняя карточка`);
    const active = document.activeElement;
    wantFocus.current = !active || active === document.body || Boolean(rootRef.current?.contains(active));
  };

  const commit = async (dir: SwipeDir, viaDrag = false) => {
    const s = stateRef.current;
    const key = currentKey(s);
    const item = key ? byKey.get(key) : undefined;
    const action = actions[dir];
    if (!key || item === undefined || !action || busy.current) {
      if (viaDrag) resetCard(true);
      return;
    }
    const reason = action.disabled?.(item);
    if (reason) {
      if (viaDrag) resetCard(true);
      announce(reason);
      return;
    }
    busy.current = true;
    try {
      if (action.optimistic === false) {
        if (viaDrag) resetCard(true);
        setWaiting(true);
        const res = await onAction(item, dir);
        setWaiting(false);
        if (res === false) return;
        const result = typeof res === 'object' ? res : {};
        if (result.stamp) {
          setFlyStamp(result.stamp);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }
        await fly(dir);
        const next = decide(stateRef.current, dir, key);
        onStateChange((cur) => decide(cur, dir, key));
        afterMove(next, result.announce ?? action.announce);
      } else {
        let pending: Promise<SwipeResult>;
        try {
          pending = Promise.resolve(onAction(item, dir));
        } catch (error) {
          pending = Promise.reject(error);
        }
        await fly(dir);
        const next = decide(stateRef.current, dir, key);
        onStateChange((cur) => decide(cur, dir, key));
        afterMove(next, action.announce);
        pending
          .then((res) => res === false && Promise.reject(new Error('cancelled')))
          .catch(() => {
            onStateChange((cur) => restore(cur, key));
            announce(`Не получилось. «${itemLabel(item)}» снова в стопке`);
          });
      }
    } finally {
      busy.current = false;
      setWaiting(false);
      drag.current = null;
    }
  };

  const doUndo = () => {
    if (busy.current) return;
    const result = undo(stateRef.current);
    if (!result) return;
    const item = byKey.get(result.key);
    onStateChange(() => result.state);
    if (item !== undefined) onUndo?.(item, result.dir);
    if (!reducedMotion()) setEnter({ key: result.key, dir: result.dir });
    const hint = undoHint?.(result.dir);
    announce(`Вернули «${item !== undefined ? itemLabel(item) : ''}»${hint ? `. ${hint}` : ''}`);
    wantFocus.current = true;
  };

  useEffect(() => {
    if (!enter) return;
    const timer = window.setTimeout(() => setEnter(null), SWIPE.flyMs);
    return () => window.clearTimeout(timer);
  }, [enter]);

  useLayoutEffect(() => {
    setFlyStamp(null);
    const card = cardRef.current;
    if (card) {
      card.style.opacity = '';
      card.style.transition = '';
      card.style.transform = '';
    }
    rootRef.current?.style.setProperty('--deck-p', '0');
  }, [topKey]);

  const toggle = () => setExpandedKey((k) => (k === topKey ? null : topKey));

  const onKey = useRef<(e: KeyboardEvent) => void>(() => undefined);
  onKey.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.(IGNORE_KEYS)) return;
    if (document.querySelector('.ant-modal-wrap, .ant-drawer-open, .ant-popover:not(.ant-popover-hidden)'))
      return;
    const onControl = Boolean(target?.closest?.('button, a') && target !== cardRef.current);
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        void commit('left');
        return;
      case 'ArrowRight':
        e.preventDefault();
        void commit('right');
        return;
      case 'ArrowUp':
        if (!actions.up) return;
        e.preventDefault();
        void commit('up');
        return;
      case 'Enter':
      case ' ':
        if (onControl || !top) return;
        e.preventDefault();
        toggle();
        return;
      case 'Backspace':
        e.preventDefault();
        doUndo();
        return;
      case 'Escape':
        if (expanded) {
          e.preventDefault();
          setExpandedKey(null);
          cardRef.current?.focus({ preventScroll: true });
        } else if (onExit) {
          e.preventDefault();
          onExit();
        }
        return;
    }
    if (e.code === 'KeyZ') {
      e.preventDefault();
      doUndo();
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const dirAllowed = (dir: 'left' | 'right') => top !== null && !actions[dir].disabled?.(top);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (busy.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as HTMLElement).closest(IGNORE_DRAG)) return;
    drag.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      dx: 0,
      dy: 0,
      axis: null,
      samples: [{ x: e.clientX, t: e.timeStamp }],
      armed: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || busy.current) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.axis) {
      d.axis = axisLock(dx, dy);
      if (!d.axis) return;
      if (d.axis === 'y') {
        drag.current = null;
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.style.transition = 'none';
      rootRef.current?.setAttribute('data-dragging', '');
      suppressClick.current = true;
    }
    const dir = dx > 0 ? 'right' : 'left';
    const allowed = dirAllowed(dir);
    d.dx = allowed ? dx : dx * 0.25;
    d.dy = dy;
    d.samples.push({ x: e.clientX, t: e.timeStamp });
    d.samples = recentSamples(d.samples, e.timeStamp);
    setVars(d.dx, dy, allowed ? dir : null);
    const width = e.currentTarget.offsetWidth;
    const over = allowed && dragProgress(d.dx, width) >= 1;
    if (over && !d.armed) navigator.vibrate?.(8);
    d.armed = over;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.axis !== 'x') {
      drag.current = null;
      return;
    }
    const outcome = swipeOutcome(d.dx, e.currentTarget.offsetWidth, releaseVelocity(d.samples));
    if (outcome && dirAllowed(outcome)) void commit(outcome, true);
    else {
      resetCard(true);
      if (outcome && top) {
        const reason = actions[outcome].disabled?.(top);
        if (reason) announce(reason);
      }
      drag.current = null;
    }
  };

  const onPointerCancel = () => {
    if (drag.current?.axis === 'x') resetCard(true);
    drag.current = null;
  };

  const onCardClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (e.target instanceof Element && e.target.closest(IGNORE_DRAG)) return;
    if (!expanded) toggle();
  };

  const onCardKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }
  };

  const reasons = top
    ? (['left', 'up', 'right'] as const)
        .map((dir) => {
          const reason = actions[dir]?.disabled?.(top);
          return reason ? { dir, reason } : null;
        })
        .filter((r): r is { dir: 'left' | 'up' | 'right'; reason: string } => r !== null)
    : [];
  const lastHint = state.last ? undoHint?.(state.last.dir) : undefined;

  const sideButton = (dir: 'left' | 'right') => {
    const action = actions[dir];
    const reason = top ? action.disabled?.(top) : 'Карточек нет';
    return (
      <button
        key={dir}
        type="button"
        className={[styles.side, dir === 'right' ? styles.yes : styles.no].join(' ')}
        onClick={() => void commit(dir)}
        disabled={Boolean(reason) || waiting}
        aria-describedby={reason ? reasonId : undefined}
        aria-keyshortcuts={dir === 'right' ? 'ArrowRight' : 'ArrowLeft'}
      >
        <span className={styles.sideIcon} aria-hidden>
          {action.icon}
        </span>
        <span className={styles.sideLabel}>{action.label}</span>
      </button>
    );
  };

  const upAction = actions.up;
  const upReason = top && upAction ? upAction.disabled?.(top) : null;
  const center = upAction ? (
    <Button
      key="up"
      variant={upAction.variant ?? 'primary'}
      className={styles.center}
      icon={upAction.icon}
      onClick={() => void commit('up')}
      disabled={Boolean(upReason) || !top}
      loading={waiting && upAction.optimistic === false}
      aria-describedby={upReason ? reasonId : undefined}
      aria-keyshortcuts="ArrowUp"
    >
      {upAction.label}
    </Button>
  ) : (
    <span key="up" />
  );
  const controls = settings.leftHand
    ? [sideButton('right'), center, sideButton('left')]
    : [sideButton('left'), center, sideButton('right')];

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-motion="off"
      role="region"
      aria-roledescription="стопка карточек"
      aria-label={label}
    >
      {toolbar && <div className={styles.top}>{toolbar}</div>}
      <div className={styles.progress}>
        <span className={styles.count}>{progressLabel(state)}</span>
        <span className={styles.bar} aria-hidden>
          <i style={{ width: `${(state.order.length ? state.index / state.order.length : 0) * 100}%` }} />
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon={<ArrowCounterClockwiseIcon size={18} aria-hidden />}
          onClick={doUndo}
          disabled={!state.last}
          title={lastHint}
          aria-keyshortcuts="Z Backspace"
        >
          Вернуть
        </Button>
      </div>
      {lastHint && <p className={styles.undoHint}>{lastHint}</p>}

      <div className={styles.stage}>
        {stack
          .map(({ key, item }, depth) => {
            const isTop = depth === 0;
            const entering = isTop && enter?.key === key ? enter.dir : undefined;
            return (
              <div
                key={key}
                ref={isTop ? cardRef : undefined}
                className={styles.card}
                data-depth={depth}
                data-enter={entering}
                data-expanded={isTop && expanded ? '' : undefined}
                tabIndex={isTop ? 0 : -1}
                aria-hidden={isTop ? undefined : true}
                inert={!isTop}
                role={isTop ? 'group' : undefined}
                aria-roledescription={isTop ? 'карточка' : undefined}
                aria-label={isTop ? itemLabel(item) : undefined}
                onPointerDown={isTop ? onPointerDown : undefined}
                onPointerMove={isTop ? onPointerMove : undefined}
                onPointerUp={isTop ? onPointerUp : undefined}
                onPointerCancel={isTop ? onPointerCancel : undefined}
                onLostPointerCapture={isTop ? onPointerCancel : undefined}
                onClick={isTop ? onCardClick : undefined}
                onKeyDown={isTop ? onCardKey : undefined}
                onDragStart={(e) => e.preventDefault()}
              >
                {renderCard(item, { expanded: isTop && expanded, toggle })}
                {isTop && (
                  <>
                    <span className={[styles.stamp, styles.stampLeft].join(' ')} aria-hidden>
                      {actions.left.stamp}
                    </span>
                    <span className={[styles.stamp, styles.stampRight].join(' ')} aria-hidden>
                      {actions.right.stamp}
                    </span>
                    {upAction && (
                      <span className={[styles.stamp, styles.stampUp].join(' ')} aria-hidden>
                        {flyStamp ?? upAction.stamp}
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })
          .reverse()}
      </div>

      {reasons.length > 0 && (
        <p id={reasonId} className={styles.reason}>
          {reasons.map((r) => r.reason).join('. ')}
        </p>
      )}
      <div className={styles.controls}>{controls}</div>

      {state.actions < SWIPE.hintActions && (
        <aside className={styles.hint} aria-label="Клавиши">
          <p className={styles.hintTitle}>Можно клавишами</p>
          <dl>
            <div>
              <dt>
                <kbd>←</kbd>
              </dt>
              <dd>{actions.left.label}</dd>
            </div>
            <div>
              <dt>
                <kbd>→</kbd>
              </dt>
              <dd>{actions.right.label}</dd>
            </div>
            {upAction && (
              <div>
                <dt>
                  <kbd>↑</kbd>
                </dt>
                <dd>{upAction.label}</dd>
              </div>
            )}
            <div>
              <dt>
                <kbd>Enter</kbd>
              </dt>
              <dd>Подробнее</dd>
            </div>
            <div>
              <dt>
                <kbd>Z</kbd>
              </dt>
              <dd>Вернуть</dd>
            </div>
            {onExit && (
              <div>
                <dt>
                  <kbd>Esc</kbd>
                </dt>
                <dd>{exitLabel}</dd>
              </div>
            )}
          </dl>
        </aside>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {live}
      </p>
    </div>
  );
}
