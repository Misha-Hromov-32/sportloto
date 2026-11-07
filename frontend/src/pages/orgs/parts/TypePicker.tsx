import { CheckIcon } from '@phosphor-icons/react';

import { ORG_TYPE } from '@/lib/labels';
import type { OrgType } from '@/types/domain';

import styles from './FormParts.module.css';

const TYPES: { value: OrgType; hint: string }[] = [
  { value: 'club', hint: 'Постоянный состав и регулярные встречи' },
  { value: 'circle', hint: 'Занятия при школе, доме культуры, библиотеке' },
  { value: 'school', hint: 'Тренировки для детей и взрослых с тренером' },
  { value: 'coach', hint: 'Вы сами ведёте занятия' },
  { value: 'initiative', hint: 'Соседи, двор или компания друзей' },
  { value: 'company', hint: 'Спорт для сотрудников или платные занятия' },
  { value: 'federation', hint: 'Объединяет клубы и проводит соревнования' },
  { value: 'sponsor', hint: 'Помогаете клубам инвентарём, залом или формой, без денег' },
  // В4: владелец площадок
  { value: 'venue', hint: 'Зал, поле, корт или бассейн: показываете свободные окна для встреч' },
];

export function TypePicker({
  value,
  onChange,
  invalid,
  describedBy,
}: {
  value: OrgType | null;
  onChange: (value: OrgType) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <div
      className={styles.types}
      role="radiogroup"
      aria-labelledby="org-type-label"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    >
      {TYPES.map((t, i) => {
        const checked = value === t.value;
        return (
          <label key={t.value} className={[styles.type, checked && styles.typeOn].filter(Boolean).join(' ')}>
            <input
              id={i === 0 ? 'org-type' : undefined}
              type="radio"
              name="org-type"
              value={t.value}
              checked={checked}
              onChange={() => onChange(t.value)}
              className={styles.radio}
            />
            <span className={styles.typeMark} aria-hidden>
              {checked && <CheckIcon size={16} weight="bold" />}
            </span>
            <span className={styles.typeText}>
              <span className={styles.typeTitle}>{ORG_TYPE[t.value]}</span>
              <span className={styles.typeHint}>{t.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
