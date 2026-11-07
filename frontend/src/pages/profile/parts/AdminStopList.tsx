import { InfoIcon, ShieldCheckIcon, WarningIcon } from '@phosphor-icons/react';

import { ErrorState } from '@/components';
import { count } from '@/lib/plural';
import { useAdminStopList } from '@/pages/admin/stoplist/api';
import { StopEntriesTable } from '@/pages/admin/stoplist/StopEntriesTable';

import pageStyles from '../ProfilePage.module.css';
import styles from './AdminStopList.module.css';

const ORGANIZER_WORDS = ['организатора', 'организаторов', 'организаторов'] as const;

/** D-16: только для администратора — в чьих стоп-листах этот человек. */
export function AdminStopList({ userId }: { userId: string }) {
  const list = useAdminStopList({ userId });
  const entries = list.data?.entries ?? [];
  const recent = list.data?.recentOwners ?? 0;

  return (
    <section id="profile-stop" className={styles.block} aria-labelledby="stop-title">
      <header className={pageStyles.sectionHead}>
        <h2 id="stop-title">
          В стоп-листах организаторов
          {list.data && <span className={pageStyles.headingCount}>{entries.length}</span>}
        </h2>
      </header>
      <p className={styles.lead}>
        <ShieldCheckIcon size={20} aria-hidden />
        <span>Видят только администраторы. Заметки организаторов здесь не показываются.</span>
      </p>
      {recent > 0 && (
        <p className={[styles.intro, recent >= 3 ? styles.warn : ''].join(' ')}>
          {recent >= 3 ? <WarningIcon size={20} aria-hidden /> : <InfoIcon size={20} aria-hidden />}
          <span>
            В стоп-листах у {count(recent, ORGANIZER_WORDS)} за 30 дней.
            {recent >= 3 && ' Стоит посмотреть жалобы на этого человека.'}
          </span>
        </p>
      )}
      {list.isError ? (
        <ErrorState title="Не удалось загрузить стоп-листы" onRetry={() => void list.refetch()} />
      ) : (
        <StopEntriesTable
          by="owner"
          caption="Стоп-листы, где есть этот человек"
          rows={entries}
          loading={list.isLoading}
          onChanged={() => void list.refetch()}
          empty={<p className={styles.empty}>Ни один организатор не добавлял этого человека в стоп-лист.</p>}
        />
      )}
    </section>
  );
}
