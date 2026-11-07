import { ProhibitInsetIcon } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Avatar, Button, StatusBadge } from '@/components';
import { formatAgo, formatDayMonth } from '@/lib/dates';
import type { StatusMeta } from '@/lib/labels';
import type { StopEntryState, StopEntryView } from '@/types/api';

import { AdminTable, type AdminColumn } from '../parts/AdminTable';
import styles from '../parts/admin.module.css';
import { LiftStopDialog } from './LiftStopDialog';

const STATE: Record<StopEntryState, StatusMeta> = {
  active: { label: 'Действует', tone: 'danger', icon: 'ban' },
  expired: { label: 'Срок закончился', tone: 'off', icon: 'history' },
  lifted: { label: 'Снят администратором', tone: 'neutral', icon: 'arrowUUpLeft' },
};

function termText(e: StopEntryView): string {
  if (!e.until) return 'Бессрочно';
  return e.state === 'expired' ? `Закончился ${formatDayMonth(e.until)}` : `До ${formatDayMonth(e.until)}`;
}

function ownerLink(owner: StopEntryView['owner']): string {
  return owner.kind === 'org' ? `/admin/organizations/${owner.id}` : `/profile/${owner.id}`;
}

/**
 * Записи стоп-листов для администратора. `by="person"` — список клуба, в первой колонке человек;
 * `by="owner"` — стоп-листы, где упоминается человек, в первой колонке организатор.
 * Заметки организатора сюда не приходят.
 */
export function StopEntriesTable({
  rows,
  loading,
  by,
  caption,
  empty,
  onChanged,
}: {
  rows: StopEntryView[];
  loading: boolean;
  by: 'person' | 'owner';
  caption: string;
  empty: ReactNode;
  onChanged?: () => void;
}) {
  const [lifting, setLifting] = useState<StopEntryView | null>(null);

  const first: AdminColumn<StopEntryView> =
    by === 'person'
      ? {
          key: 'who',
          title: 'Кто',
          width: 200,
          primary: true,
          render: (e) => (
            <div className={styles.person}>
              <Avatar name={e.user.name} initials={e.user.initials} src={e.user.avatarUrl} size={40} />
              <Link to={`/profile/${e.user.id}`} className={styles.nameLink}>
                {e.user.name}
              </Link>
            </div>
          ),
        }
      : {
          key: 'owner',
          title: 'Организатор',
          width: 220,
          primary: true,
          render: (e) => (
            <div className={styles.nameCell}>
              <Link to={ownerLink(e.owner)} className={styles.nameLink}>
                {e.owner.name}
              </Link>
              <span className={styles.sub}>{e.owner.kind === 'org' ? 'Организация' : 'Частный организатор'}</span>
            </div>
          ),
        };

  const columns: AdminColumn<StopEntryView>[] = [
    first,
    {
      key: 'reason',
      title: 'Причина',
      render: (e) => (
        <div className={styles.nameCell}>
          <span>{e.reasonLabel}</span>
          <span className={styles.sub}>
            Кто добавил: {e.addedBy.name}, {formatAgo(e.createdAt)}
          </span>
        </div>
      ),
    },
    {
      key: 'state',
      title: 'Состояние',
      width: 240,
      render: (e) => (
        <div className={styles.nameCell}>
          <StatusBadge kind="custom" meta={STATE[e.state]} />
          {e.state === 'lifted' && e.liftedAt ? (
            <>
              <span className={styles.sub}>
                {formatAgo(e.liftedAt)}
                {e.liftedBy && `, ${e.liftedBy.name}`}
              </span>
              {e.liftedReason && <span className={styles.sub}>Причина: {e.liftedReason}</span>}
            </>
          ) : (
            <span className={styles.sub}>{termText(e)}</span>
          )}
          {e.state === 'active' && (
            <Button
              size="sm"
              variant="secondary"
              icon={<ProhibitInsetIcon size={18} aria-hidden />}
              onClick={() => setLifting(e)}
            >
              Снять запрет
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        caption={caption}
        rows={rows}
        rowKey={(e) => e.id}
        columns={columns}
        loading={loading}
        pageSize={10}
        empty={empty}
      />
      <LiftStopDialog entry={lifting} onClose={() => setLifting(null)} onLifted={onChanged} />
    </>
  );
}
