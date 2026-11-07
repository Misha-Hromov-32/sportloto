import { ErrorState, Section } from '@/components';

import styles from '../parts/admin.module.css';
import { useAdminStopList } from './api';
import { StopEntriesTable } from './StopEntriesTable';

/** D-16: стоп-лист клуба в карточке организации. */
export function OrgStopListSection({ orgId }: { orgId: string }) {
  const list = useAdminStopList({ orgId });
  const entries = list.data?.entries ?? [];

  return (
    <Section title="Стоп-лист клуба" aside={list.data ? entries.length : undefined}>
      {list.isError ? (
        <ErrorState title="Не удалось загрузить стоп-лист" onRetry={() => void list.refetch()} />
      ) : (
        <>
          {entries.length > 0 && (
            <p className={styles.panelText}>
              Кого организаторы клуба не пускают на свои встречи. Заметки организаторов здесь не показываются.
            </p>
          )}
          <StopEntriesTable
            by="person"
            caption="Стоп-лист клуба"
            rows={entries}
            loading={list.isLoading}
            onChanged={() => void list.refetch()}
            empty={<p className={styles.empty}>Клуб никого не добавлял в стоп-лист.</p>}
          />
        </>
      )}
    </Section>
  );
}
