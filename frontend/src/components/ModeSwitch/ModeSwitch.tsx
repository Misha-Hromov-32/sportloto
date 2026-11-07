import { PencilSimple, Sparkle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import styles from './ModeSwitch.module.css';

export type FillMode = 'manual' | 'assistant';

interface ModeSwitchProps {
  value: FillMode;
  onChange: (mode: FillMode) => void;
  /** Подпись для экранного диктора: «Как заполнить карточку события». */
  label?: string;
}

/** Два равноправных режима. Переключение не стирает введённое — за это отвечает экран. */
export function ModeSwitch({ value, onChange, label = 'Как заполнить' }: ModeSwitchProps) {
  const options: { value: FillMode; title: string; hint: string; icon: ReactNode }[] = [
    {
      value: 'manual',
      title: 'Заполню сам',
      hint: 'Обычная форма по шагам',
      icon: <PencilSimple size={22} aria-hidden />,
    },
    {
      value: 'assistant',
      title: 'Создать с помощником',
      hint: 'Опишите одной-двумя фразами',
      icon: <Sparkle size={22} weight="fill" aria-hidden />,
    },
  ];
  return (
    <div className={styles.root} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={[styles.option, value === o.value && styles.active].filter(Boolean).join(' ')}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          <span className={styles.text}>
            <span className={styles.title}>{o.title}</span>
            <span className={styles.hint}>{o.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
