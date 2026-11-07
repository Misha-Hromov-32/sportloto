import type { ReactNode } from 'react';

import styles from './Section.module.css';

interface SectionProps {
  title: string;
  /** Короткое пояснение или число рядом с заголовком. */
  aside?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}

/** Смысловой блок страницы: заголовок с чертой сверху, как раздел афиши. */
export function Section({ title, aside, actions, children, id }: SectionProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={styles.section} id={id} aria-labelledby={headingId}>
      <header className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          {title}
          {aside !== undefined && <span className={styles.aside}>{aside}</span>}
        </h2>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      {children}
    </section>
  );
}
