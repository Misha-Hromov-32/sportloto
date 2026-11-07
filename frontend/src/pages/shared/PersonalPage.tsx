import { useLayoutEffect, type ReactNode } from 'react';

import { SportsPattern } from '../landing/parts/SportsPattern';
import styles from './PersonalPage.module.css';

interface PersonalPageProps {
  title: string;
  eyebrow?: string;
  description: ReactNode;
  /** Карточка справа от заголовка: число или короткая сводка. Не нужна, если повторяет страницу. */
  icon?: ReactNode;
  summary?: ReactNode;
  value?: number;
  actions?: ReactNode;
  children: ReactNode;
}

export function PersonalPage({
  title,
  eyebrow,
  description,
  icon,
  summary,
  value,
  actions,
  children,
}: PersonalPageProps) {
  useLayoutEffect(() => {
    const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <SportsPattern />
        <div className={styles.container}>
          <div className={styles.heroGrid} data-single={summary ? undefined : ''}>
            <div className={styles.copy}>
              {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
              <h1>
                {title}
                <span>.</span>
              </h1>
              <p className={styles.description}>{description}</p>
              {actions && <div className={styles.actions}>{actions}</div>}
            </div>
            {summary && (
              <div className={styles.summary}>
                <span className={styles.symbol} aria-hidden>
                  {icon}
                </span>
                {value !== undefined && (
                  <strong className={styles.value}>{value.toLocaleString('ru-RU')}</strong>
                )}
                <div className={styles.summaryText}>{summary}</div>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className={[styles.container, styles.content].join(' ')}>{children}</div>
    </div>
  );
}
