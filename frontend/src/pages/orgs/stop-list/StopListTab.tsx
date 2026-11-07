import { ProhibitIcon } from '@phosphor-icons/react';
import { useId } from 'react';

import { StopListTable } from '@/components';
import type { OrganizationView } from '@/types/api';

import styles from './stopList.module.css';

/** D-16: общий стоп-лист клуба — ведут владелец и соуправляющие, видно, кто добавил. */
export function OrgStopList({ org }: { org: OrganizationView }) {
  const titleId = useId();
  return (
    <section className={styles.panel} id="stop-list" aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        <ProhibitIcon size={24} aria-hidden />
        Стоп-лист
      </h2>
      <p className={styles.muted}>
        Кого клуб не пускает на свои встречи. Список общий для владельца и соуправляющих.
      </p>
      <StopListTable
        owner={`org:${org.id}`}
        emptyHint="Сюда попадают люди, которых клуб не пускает на свои встречи. Добавить человека можно в управлении встречей клуба: у участника, заявки или сообщения в обсуждении нажмите «⋯» и выберите «Не пускать на встречи клуба»."
      />
    </section>
  );
}
