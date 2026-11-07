import { WarningCircleIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { AssistantMark } from '@/components';

import styles from './FormParts.module.css';

interface FieldProps {
  id: string;
  label: string;
  /** Группа (радио, чипы) подписывается по id, обычное поле — через htmlFor. */
  group?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: string;
  /** Заполнил помощник: показать пометку и «почему так». */
  assisted?: string;
  aside?: ReactNode;
  children: ReactNode;
}

export function Field({ id, label, group, optional, hint, error, assisted, aside, children }: FieldProps) {
  const LabelTag = group ? 'span' : 'label';
  return (
    <div className={[styles.field, error && styles.fieldError].filter(Boolean).join(' ')}>
      <div className={styles.labelRow}>
        <LabelTag id={`${id}-label`} htmlFor={group ? undefined : id} className={styles.label}>
          {label}
          {optional && <span className={styles.optional}>необязательно</span>}
        </LabelTag>
        {assisted !== undefined && <AssistantMark why={assisted} />}
        {aside && <span className={styles.labelAside}>{aside}</span>}
      </div>
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} className={styles.error}>
          <WarningCircleIcon size={18} weight="bold" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
