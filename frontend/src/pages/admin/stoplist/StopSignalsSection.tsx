import { Link } from 'react-router';

import { Avatar, ErrorState, Section } from '@/components';
import { formatAgo } from '@/lib/dates';
import { count } from '@/lib/plural';

import styles from '../parts/admin.module.css';
import { useStopSignals } from './api';

/** Родительный падеж после «у»: у 1 организатора, у 3 организаторов. */
const ORGANIZER_WORDS = ['организатора', 'организаторов', 'организаторов'] as const;

/** D-16: люди, которых за 30 дней добавили в стоп-листы 3 и больше организаторов. Решает администратор. */
export function StopSignalsSection() {
  const signals = useStopSignals();
  const rows = signals.data ?? [];

  if (signals.isError) {
    return (
      <Section title="Стоп-листы: стоит проверить">
        <ErrorState title="Не удалось загрузить стоп-листы" onRetry={() => void signals.refetch()} />
      </Section>
    );
  }
  if (!rows.length) return null;

  return (
    <Section title="Стоп-листы: стоит проверить" aside={rows.length}>
      <p className={styles.panelText}>
        Этих людей за 30 дней не пускают на встречи сразу несколько организаторов. Откройте профиль: там причины и
        кнопка «Снять запрет».
      </p>
      <ul className={styles.peopleList}>
        {rows.map((s) => (
          <li key={s.user.id} className={styles.peopleItem}>
            <div className={styles.person}>
              <Avatar name={s.user.name} initials={s.user.initials} src={s.user.avatarUrl} size={40} />
              <div className={styles.personBody}>
                <Link to={`/profile/${s.user.id}#profile-stop`} className={styles.nameLink}>
                  {s.user.name}
                </Link>
                <span className={styles.sub}>
                  В стоп-листах у {count(s.owners, ORGANIZER_WORDS)} за 30 дней. Последний раз{' '}
                  {formatAgo(s.lastAt)}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
