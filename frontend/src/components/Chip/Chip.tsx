import { Check, X } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import styles from './Chip.module.css';

interface ChipProps {
  children: ReactNode;
  /** Выбранный фильтр-переключатель. */
  selected?: boolean;
  onClick?: () => void;
  /** Снимаемый чип (результат поиска фразой): показывает крестик. */
  onRemove?: () => void;
  icon?: ReactNode;
  /** Пометка «подставил помощник». */
  fromAssistant?: boolean;
  count?: number;
  disabled?: boolean;
}

export function Chip({
  children,
  selected = false,
  onClick,
  onRemove,
  icon,
  fromAssistant,
  count,
  disabled,
}: ChipProps) {
  const cls = [
    styles.chip,
    selected && styles.selected,
    onRemove && styles.removable,
    fromAssistant && styles.assistant,
  ]
    .filter(Boolean)
    .join(' ');

  if (onRemove) {
    return (
      <span className={cls}>
        {icon}
        <span>{children}</span>
        <button
          type="button"
          className={styles.remove}
          onClick={onRemove}
          aria-label={`Убрать фильтр «${String(children)}»`}
        >
          <X size={16} weight="bold" aria-hidden />
        </button>
      </span>
    );
  }

  return (
    <button type="button" className={cls} aria-pressed={selected} onClick={onClick} disabled={disabled}>
      {selected ? <Check size={16} weight="bold" aria-hidden /> : icon}
      <span>{children}</span>
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}
