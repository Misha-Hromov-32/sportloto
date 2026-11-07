import { ProhibitIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { useAction } from '@/lib/api';
import { formatAgo, formatDayMonth } from '@/lib/dates';
import type { StopEntryView, StopListView, StopOwnerKey } from '@/types/api';

import { Avatar } from '../Avatar/Avatar';
import { Button } from '../Button/Button';
import { SkeletonBlock } from '../Skeleton/Skeleton';
import { EmptyState, ErrorState, NoAccessState } from '../States/States';
import { StatusBadge } from '../StatusBadge/StatusBadge';
import { STOP_API, ownerMeetings } from './stopApi';
import { useStopList } from './useStopList';
import styles from './StopList.module.css';

/** Строки стоп-листа: кто, почему, заметка, кто добавил, срок и «Убрать из стоп-листа». */
export function StopListTable({ owner, emptyHint }: { owner: StopOwnerKey; emptyHint?: ReactNode }) {
  const { data, isLoading, isError, error, refetch } = useStopList(owner);
  const { run } = useAction<StopListView>();
  const { modal } = App.useApp();

  if (isLoading) {
    return (
      <div className={styles.rows} role="status">
        <span className="sr-only">Загружаем стоп-лист…</span>
        <SkeletonBlock height={120} />
        <SkeletonBlock height={120} />
      </div>
    );
  }
  if (error?.code === 'forbidden') {
    return (
      <NoAccessState layout="inline" title="Стоп-лист ведёт организатор">
        {error.message || 'Смотреть и менять этот список могут только организатор и его соуправляющие.'}
      </NoAccessState>
    );
  }
  if (isError || !data) {
    return (
      <ErrorState onRetry={() => void refetch()}>
        Не удалось загрузить стоп-лист. Проверьте интернет и нажмите «Повторить».
      </ErrorState>
    );
  }
  if (!data.entries.length) {
    return (
      <EmptyState title="В стоп-листе никого нет" icon={<ProhibitIcon size={28} aria-hidden />}>
        {emptyHint ??
          `Сюда попадают люди, которых вы не пускаете на ${ownerMeetings(owner)}. Добавить человека можно в управлении встречей: у участника, заявки или сообщения в обсуждении нажмите «⋯» и выберите «Не пускать».`}
      </EmptyState>
    );
  }

  const remove = (entry: StopEntryView) =>
    modal.confirm({
      title: 'Убрать из стоп-листа?',
      content: `${entry.user.name} снова сможет записываться на ${ownerMeetings(owner)} и получит уведомление. Отменённые раньше записи не вернутся.`,
      okText: 'Убрать из стоп-листа',
      cancelText: 'Оставить',
      onOk: async () => {
        try {
          await run(
            STOP_API.entry(entry.id),
            {},
            { method: 'delete', success: 'Человек убран из стоп-листа' },
          );
        } catch {
          /* текст ошибки уже показан */
        }
      },
    });

  return (
    <ul className={styles.rows} aria-label="Стоп-лист">
      {data.entries.map((entry) => (
        <StopRow
          key={entry.id}
          entry={entry}
          onRemove={data.canEdit && entry.state === 'active' ? () => remove(entry) : undefined}
        />
      ))}
    </ul>
  );
}

function StopRow({ entry, onRemove }: { entry: StopEntryView; onRemove?: () => void }) {
  const off = entry.state !== 'active';
  return (
    <li className={[styles.row, off && styles.rowOff].filter(Boolean).join(' ')}>
      <div className={styles.rowHead}>
        <Avatar name={entry.user.name} initials={entry.user.initials} src={entry.user.avatarUrl} size={48} />
        <div className={styles.rowWho}>
          <Link to={`/profile/${entry.user.id}`} className={styles.rowName}>
            {entry.user.name}
          </Link>
          {entry.state === 'expired' && (
            <StatusBadge kind="custom" meta={{ label: 'Срок закончился', tone: 'off', icon: 'history' }} />
          )}
          {entry.state === 'lifted' && (
            <StatusBadge kind="custom" meta={{ label: 'Запрет снят', tone: 'off', icon: 'shield' }} />
          )}
        </div>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Причина</dt>
          <dd>{entry.reasonLabel}</dd>
        </div>
        {entry.note && (
          <div>
            <dt>Заметка</dt>
            <dd>{entry.note}</dd>
          </div>
        )}
        <div>
          <dt>Кто добавил</dt>
          <dd>
            {entry.addedBy.name}, {formatAgo(entry.createdAt)}
          </dd>
        </div>
        <div>
          <dt>Срок</dt>
          <dd>{entry.until ? `до ${formatDayMonth(entry.until)}` : 'бессрочно'}</dd>
        </div>
        {entry.state === 'lifted' && (
          <div>
            <dt>Снято администратором</dt>
            <dd>
              {entry.liftedReason || 'Причина не указана'}
              {entry.liftedAt && `, ${formatAgo(entry.liftedAt)}`}
            </dd>
          </div>
        )}
      </dl>
      {onRemove && (
        <div className={styles.rowActions}>
          <Button variant="secondary" size="sm" onClick={onRemove}>
            Убрать из стоп-листа
          </Button>
        </div>
      )}
    </li>
  );
}
