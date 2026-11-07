import { ArrowLeft } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import styles from './PageHeader.module.css';

interface PageHeaderProps {
  title: string;
  /** Одна строка под заголовком: что здесь можно сделать. */
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  /** Мелкая строка над заголовком — только для контекста (например, название события в «Управлении»). */
  context?: ReactNode;
}

export function PageHeader({ title, subtitle, back, actions, context }: PageHeaderProps) {
  return (
    <header className={styles.root}>
      {back && (
        <Link to={back.to} className={styles.back}>
          <ArrowLeft size={20} aria-hidden />
          {back.label}
        </Link>
      )}
      <div className={styles.row}>
        <div className={styles.text}>
          {context && <p className={styles.context}>{context}</p>}
          <h1 className="h1">{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  );
}
