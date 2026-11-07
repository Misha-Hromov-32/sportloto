import { CheckIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Chip } from '@/components';

import styles from './fields.module.css';

interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  /** Пометка помощника рядом с подписью. */
  mark?: ReactNode;
  children: ReactNode;
}

/** Поле формы: подпись всегда видна, пояснение до ввода, ошибка — под полем. */
export function Field({ label, htmlFor, hint, error, optional, mark, children }: FieldProps) {
  return (
    <div className={[styles.field, error && styles.invalid].filter(Boolean).join(' ')} data-field-error={error ? true : undefined}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
          {optional && <span className={styles.optional}>необязательно</span>}
        </label>
        {mark}
      </div>
      {hint && <p className={styles.hint}>{hint}</p>}
      {children}
      <FieldError error={error} />
    </div>
  );
}

export function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className={styles.error} role="alert">
      <WarningCircleIcon size={18} weight="bold" aria-hidden />
      {error}
    </p>
  );
}

/** Группа связанных переключателей с общей подписью (fieldset). */
export function FieldGroup({
  legend,
  hint,
  error,
  optional,
  mark,
  children,
}: Omit<FieldProps, 'htmlFor' | 'label'> & { legend: ReactNode }) {
  return (
    <fieldset className={[styles.field, styles.fieldset, error && styles.invalid].filter(Boolean).join(' ')} data-field-error={error ? true : undefined}>
      <div className={styles.labelRow}>
        <legend className={styles.label}>
          {legend}
          {optional && <span className={styles.optional}>необязательно</span>}
        </legend>
        {mark}
      </div>
      {hint && <p className={styles.hint}>{hint}</p>}
      {children}
      <FieldError error={error} />
    </fieldset>
  );
}

export interface CardOption<T extends string> {
  value: T;
  title: string;
  text?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Дополнение под вариантом (например, статус и ссылка у недоступного). */
  after?: ReactNode;
}

/** Крупные варианты-карточки: выбор с объяснением последствий. */
export function OptionCards<T extends string>({
  value,
  options,
  onChange,
  columns = 1,
  label,
  size = 'md',
}: {
  value: T;
  options: CardOption<T>[];
  onChange: (value: T) => void;
  columns?: 1 | 2 | 3;
  label: string;
  size?: 'md' | 'sm';
}) {
  return (
    <div
      className={[styles.cards, styles[`cols${columns}`], size === 'sm' && styles.cardsSm].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <div key={o.value} className={styles.cardWrap}>
            <button
              type="button"
              role="radio"
              aria-checked={active}
              disabled={o.disabled}
              className={[styles.card, active && styles.cardActive].filter(Boolean).join(' ')}
              onClick={() => onChange(o.value)}
            >
              <span className={styles.radio} aria-hidden>
                {active && <CheckIcon size={14} weight="bold" />}
              </span>
              <span className={styles.cardBody}>
                <span className={styles.cardTitle}>
                  {o.icon}
                  {o.title}
                </span>
                {o.text && <span className={styles.cardText}>{o.text}</span>}
              </span>
            </button>
            {o.after}
          </div>
        );
      })}
    </div>
  );
}

/** Быстрый выбор одного значения чипами (дата, время, длительность). */
export function ChoiceChips<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className={styles.chips} role="group" aria-label={label}>
      {options.map((o) => (
        <Chip key={String(o.value)} selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

/** Переключатель «включить и задать число»: лимит мест, порог сбора. */
export function ToggleRow({
  title,
  text,
  control,
  children,
}: {
  title: ReactNode;
  text?: ReactNode;
  control: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleHead}>
        <div className={styles.toggleText}>
          <span className={styles.toggleTitle}>{title}</span>
          {text && <span className={styles.hint}>{text}</span>}
        </div>
        {control}
      </div>
      {children}
    </div>
  );
}
