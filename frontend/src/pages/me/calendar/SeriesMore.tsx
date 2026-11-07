import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components';
import { API, useAction } from '@/lib/api';
import { dayjs } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import { capitalize } from '@/lib/text';
import type { EventView } from '@/types/api';

import styles from './SeriesMore.module.css';

/** С10: остальные встречи серии под ближайшей; каждую можно отменить, не выходя из серии. */
export function SeriesMore({ events }: { events: EventView[] }) {
  const { run } = useAction();
  const { modal } = App.useApp();
  const [busy, setBusy] = useState<string | null>(null);

  const cancel = (e: EventView) =>
    modal.confirm({
      title: `Отменить запись на ${dayjs(e.startsAt).format('D MMMM')}?`,
      content: 'Отменится только эта встреча. На остальные встречи серии вы остаётесь записаны.',
      okText: 'Отменить эту встречу',
      cancelText: 'Оставить',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(e.id);
        try {
          await run(API.leaveEvent(e.id), {}, { success: 'Запись на эту встречу отменена' });
        } catch {
          /* текст ошибки уже показан */
        } finally {
          setBusy(null);
        }
      },
    });

  return (
    <li className={styles.more}>
      <details>
        <summary className={styles.summary}>
          <ArrowsClockwiseIcon size={18} aria-hidden />
          Ещё {count(events.length, WORDS.meeting)} этой серии
        </summary>
        <ul className={styles.list}>
          {events.map((e) => (
            <li key={e.id} className={styles.item}>
              <Link to={`/events/${e.id}`} className={styles.date}>
                {capitalize(dayjs(e.startsAt).format('dd, D MMMM, HH:mm'))}
              </Link>
              <Button
                variant="quiet"
                size="sm"
                loading={busy === e.id}
                loadingText="Отменяем…"
                onClick={() => cancel(e)}
              >
                Отменить эту встречу
              </Button>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}
