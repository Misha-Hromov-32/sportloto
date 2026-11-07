import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { Input, InputNumber } from 'antd';
import { useId } from 'react';

import { Button, Chip } from '@/components';
import type { GearLineInput } from '@/types/inventory';
import { FieldGroup } from '@/pages/events/create/fields';

import styles from './inventory.module.css';

const SUGGESTIONS = ['Мяч', 'Манишки', 'Ракетка', 'Воланы', 'Коврик'];
const MAX_LINES = 12;

/** Поле формы события «Что нужно для игры»: строки «что — сколько». */
export function GearFields({
  value,
  onChange,
  error,
}: {
  value: GearLineInput[];
  onChange: (next: GearLineInput[]) => void;
  error?: string;
}) {
  const baseId = useId();
  const update = (i: number, patch: Partial<GearLineInput>) =>
    onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const add = (name = '') => onChange([...value, { name, quantity: 1 }]);
  const unused = SUGGESTIONS.filter((s) => !value.some((l) => l.name.trim().toLowerCase() === s.toLowerCase()));

  return (
    <FieldGroup
      legend="Что нужно для игры"
      optional
      error={error}
      hint="Например, 4 ракетки и 6 воланов. Участники отметят, кто что принесёт, а недостающее можно попросить на общей полке."
    >
      {value.length > 0 && (
        <ul className={styles.formLines}>
          {value.map((line, i) => (
            <li key={line.id ?? `new-${i}`} className={styles.formLine}>
              <label htmlFor={`${baseId}-name-${i}`} className="sr-only">
                Что нужно, строка {i + 1}
              </label>
              <Input
                id={`${baseId}-name-${i}`}
                size="large"
                value={line.name}
                maxLength={60}
                placeholder="Ракетка"
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <label htmlFor={`${baseId}-qty-${i}`} className="sr-only">
                Сколько, строка {i + 1}
              </label>
              <InputNumber
                id={`${baseId}-qty-${i}`}
                size="large"
                min={1}
                max={99}
                precision={0}
                value={line.quantity}
                className={styles.formQty}
                onChange={(v) => update(i, { quantity: Number(v) || 1 })}
              />
              <button
                type="button"
                className={styles.removeLine}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label={`Убрать строку «${line.name || 'без названия'}»`}
              >
                <XIcon size={18} weight="bold" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.formAdd}>
        {value.length < MAX_LINES && (
          <Button size="sm" variant="secondary" icon={<PlusIcon size={18} aria-hidden />} onClick={() => add()}>
            Добавить строку
          </Button>
        )}
        {value.length === 0 &&
          unused.map((s) => (
            <Chip key={s} onClick={() => add(s)} icon={<PlusIcon size={16} aria-hidden />}>
              {s}
            </Chip>
          ))}
      </div>
    </FieldGroup>
  );
}
