import { HandHeartIcon } from '@phosphor-icons/react';
import { Checkbox } from 'antd';

import { API, useAction } from '@/lib/api';
import type { EventDetails } from '@/types/api';

import styles from './escort.module.css';

/** Н1: метка для организатора в списке участников и заявок. */
export function EscortMark({ needed }: { needed?: boolean }) {
  if (!needed) return null;
  return (
    <span className={styles.mark}>
      <HandHeartIcon size={16} weight="fill" aria-hidden />
      Нужно сопровождение
    </span>
  );
}

const hasAccess = (e: EventDetails) =>
  Boolean(e.access && (e.access.venue.length > 0 || e.access.extras.length > 0));

/**
 * Н1: «Мне нужно сопровождение». До записи — галочка, которую карточка отправит вместе с записью,
 * после записи — переключатель, который сразу сообщает организатору.
 */
export function EscortOption({
  event: e,
  value,
  onChange,
}: {
  event: EventDetails;
  /** Выбор до записи (хранит карточка). */
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const { run, isPending } = useAction<EventDetails>();
  const my = e.my;
  const active = Boolean(my && ['confirmed', 'pending', 'waitlist'].includes(my.status));
  if (e.isOrganizer || !hasAccess(e)) return null;
  if (active) {
    const on = Boolean(my?.needsEscort);
    return (
      <div className={styles.box}>
        <Checkbox
          checked={on}
          disabled={isPending || e.state !== 'upcoming'}
          onChange={(ev) =>
            void run(API.escort(e.id), { needed: ev.target.checked }, {
              method: 'put',
              success: ev.target.checked
                ? 'Организатор увидит, что вам нужно сопровождение'
                : 'Отметку о сопровождении сняли',
            }).catch(() => undefined)
          }
        >
          <span className={styles.label}>Мне нужно сопровождение</span>
        </Checkbox>
        <p className={styles.hint}>
          {on ? 'Организатор знает и договорится, кто вас встретит.' : 'Отметьте, если нужна помощь на месте.'}
        </p>
      </div>
    );
  }
  if (!e.can.join) return null;
  return (
    <div className={styles.box}>
      <Checkbox checked={value} onChange={(ev) => onChange(ev.target.checked)}>
        <span className={styles.label}>Мне нужно сопровождение</span>
      </Checkbox>
      <p className={styles.hint}>Организатор увидит отметку и договорится, кто встретит вас у входа.</p>
    </div>
  );
}
