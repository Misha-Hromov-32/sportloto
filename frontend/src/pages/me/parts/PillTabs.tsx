import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import styles from './PillTabs.module.css';

export interface PillTab<K extends string> {
  key: K;
  label: string;
  count?: number;
  /** Требует внимания: число выделяется цветом ожидания. */
  attention?: boolean;
}

interface PillTabsProps<K extends string> {
  tabs: PillTab<K>[];
  active: K;
  onChange: (key: K) => void;
  label: string;
  children: ReactNode;
}

/**
 * Вкладки-таблетки: на телефоне прокручиваются по горизонтали, а не прячутся в «ещё».
 * Клавиатура: стрелки влево и вправо, Home и End, как у обычного списка вкладок.
 */
export function PillTabs<K extends string>({ tabs, active, onChange, label, children }: PillTabsProps<K>) {
  const id = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const layoutKey = tabs.map((t) => `${t.key}:${t.count ?? ''}`).join('|');

  // Выбранная вкладка всегда видна в прокручиваемом ряду, при этом страница по вертикали не сдвигается.
  useEffect(() => {
    const list = listRef.current;
    const tab = refs.current[active];
    if (!list || !tab) return;
    const box = list.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    const pad = 16;
    if (rect.left < box.left + pad) {
      list.scrollBy({ left: rect.left - box.left - pad });
    } else if (rect.right > box.right - pad) {
      list.scrollBy({ left: rect.right - box.right + pad });
    }
  }, [active, layoutKey]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.key === active);
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const key = tabs[next]!.key;
    onChange(key);
    refs.current[key]?.focus();
  };

  return (
    <div className={styles.root}>
      <div ref={listRef} className={styles.list} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((t) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              className={[styles.tab, selected && styles.selected].filter(Boolean).join(' ')}
              onClick={() => onChange(t.key)}
            >
              <span>{t.label}</span>
              {t.count !== undefined && (
                <span className={[styles.count, t.attention && styles.attention].filter(Boolean).join(' ')}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        data-motion-key={active}
        aria-labelledby={`${id}-tab-${active}`}
        className={styles.panel}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
