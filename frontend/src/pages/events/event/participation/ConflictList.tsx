import { WarningCircleIcon } from '@phosphor-icons/react';

import { dayjs, dayLabel, formatTime, formatTimeRange } from '@/lib/dates';
import type { TimeConflict } from '@/types/api';

import styles from './participation.module.css';

/** С9: с чем пересекается новая запись. */
export function ConflictList({ conflicts }: { conflicts: TimeConflict[] }) {
  return (
    <div className={styles.dialogText}>
      <ul className={styles.conflicts}>
        {conflicts.map((c) => (
          <li key={c.eventId} className={styles.conflict}>
            <WarningCircleIcon size={20} weight="fill" aria-hidden />
            <span>
              Пересекается с «{c.title}» в {formatTime(c.startsAt)}
              {c.role === 'organizer' ? ', эту встречу проводите вы' : ''}
              <span className={styles.block}>
                {dayLabel(c.startsAt)}, {dayjs(c.startsAt).format('D MMMM')},{' '}
                {formatTimeRange(c.startsAt, c.durationMin)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p>Если успеете на обе встречи, записывайтесь.</p>
    </div>
  );
}
