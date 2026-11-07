import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useList, type CrudFilter } from '@refinedev/core';
import { Checkbox, Input, Select } from 'antd';
import { useMemo } from 'react';
import { Link } from 'react-router';

import { Button, EmptyState, ErrorState, PageHeader, SportIcon, StatusBadge } from '@/components';
import { formatEventDate } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import { useLiveGet } from '@/lib/api';
import type { EventView, SportView } from '@/types/api';
import type { EventState } from '@/types/domain';

import { AdminTable, type AdminColumn } from './parts/AdminTable';
import { AiFlagNote } from './parts/AiFlagNote';
import styles from './parts/admin.module.css';
import { ReportsPanel } from './reports/ReportsPanel'; // С16
import { Filters } from './parts/Filters';
import { useSearchField, useUrlParams } from './parts/hooks';

const STATE_OPTIONS: { value: string; label: string; states: EventState[] }[] = [
  { value: 'all', label: 'Любое состояние', states: [] },
  { value: 'open', label: 'В поиске сейчас', states: ['upcoming', 'live'] },
  { value: 'upcoming', label: 'Идёт запись', states: ['upcoming'] },
  { value: 'live', label: 'Уже идёт', states: ['live'] },
  { value: 'past', label: 'Прошли', states: ['past'] },
  { value: 'cancelled', label: 'Отменены организатором', states: ['cancelled'] },
  { value: 'removed', label: 'Сняты модератором', states: ['removed'] },
  { value: 'appeal', label: 'Просят вернуть', states: ['removed'] },
  { value: 'deleted', label: 'Удалены', states: ['deleted'] },
];

export default function AdminEventsPage() {
  const [params, setUrlParams] = useUrlParams({ q: '', state: 'all', sport: '', org: 'all', flagged: '', page: '1', sort: 'when', order: 'desc' });
  const setParams = (patch: Partial<typeof params>) => setUrlParams({ ...patch, page: '1' });
  const [text, setText] = useSearchField(params.q, (q) => setParams({ q }));
  const page = Math.max(1, Number(params.page) || 1);
  const states = STATE_OPTIONS.find((o) => o.value === params.state)?.states ?? [];
  const filters: CrudFilter[] = [{ field: 'scope', operator: 'eq', value: 'admin' }];
  if (params.q) filters.push({ field: 'adminSearch', operator: 'eq', value: params.q });
  if (states.length) filters.push({ field: 'adminStates', operator: 'eq', value: states });
  if (params.state === 'appeal') filters.push({ field: 'adminAppeal', operator: 'eq', value: true });
  if (params.sport) filters.push({ field: 'sportId', operator: 'eq', value: params.sport });
  if (params.org !== 'all') filters.push({ field: 'adminOrganizer', operator: 'eq', value: params.org });
  if (params.flagged) filters.push({ field: 'aiFlagged', operator: 'eq', value: true });

  const { result, query } = useList<EventView>({
    resource: 'events',
    filters,
    sorters: [{ field: params.sort === 'people' ? 'counts.confirmed' : 'startsAt', order: params.order === 'asc' ? 'asc' : 'desc' }],
    pagination: { currentPage: page, pageSize: 20, mode: 'server' },
  });
  const { result: sports } = useList<SportView>({
    resource: 'sports',
    filters: [{ field: 'includeHidden', operator: 'eq', value: true }],
    pagination: { mode: 'off' },
  });

  const rows = result?.data ?? [];
  const { data: eventCounts } = useLiveGet<{ bySport: Record<string, number> }>(
    '/admin/events-summary', ['events', 'sports'],
  );

  const usedSports = useMemo(() => {
    return (sports?.data ?? []).filter((s) => (eventCounts?.bySport[s.id] ?? 0) > 0);
  }, [eventCounts, sports]);

  const filtered = Boolean(
    params.q || params.state !== 'all' || params.sport || params.org !== 'all' || params.flagged,
  );
  const reset = () => {
    setText('');
    setParams({ q: '', state: 'all', sport: '', org: 'all', flagged: '' });
  };

  const columns: AdminColumn<EventView>[] = [
    {
      key: 'title',
      title: 'Событие',
      primary: true,
      render: (e) => (
        <div className={styles.nameCell}>
          <Link to={`/admin/events/${e.id}`} className={styles.nameLink}>
            {e.title}
          </Link>
          <span className={[styles.sub, styles.inlineIcon].join(' ')}>
            <SportIcon sport={e.sport} size={18} />
            {e.sport.name}
            {e.sport.kind === 'custom' && ' (новое направление)'}
          </span>
          <span className={styles.sub}>
            {e.organizer.kind === 'org' ? 'Организация' : 'Частное лицо'}: {e.organizerView.name}
          </span>
          <AiFlagNote flag={e.aiFlag} reason={e.aiReason} subject="event" />
        </div>
      ),
    },
    {
      key: 'when',
      title: 'Когда',
      width: 190,
      sorter: (a, b) => a.startsAt.localeCompare(b.startsAt),
      render: (e) => <time dateTime={e.startsAt}>{formatEventDate(e.startsAt)}</time>,
    },
    {
      key: 'people',
      title: 'Записи',
      width: 110,
      sorter: (a, b) => a.counts.confirmed - b.counts.confirmed,
      render: (e) => (
        <div className={styles.nameCell}>
          <span>
            <span className={styles.num}>{e.counts.confirmed}</span>
            {e.capacity ? ` из ${e.capacity}` : ''}
          </span>
          {e.counts.pending > 0 && (
            <span className={styles.sub}>{count(e.counts.pending, WORDS.application)}</span>
          )}
        </div>
      ),
    },
    {
      key: 'state',
      title: 'Состояние',
      width: 210,
      render: (e) => (
        <div className={styles.nameCell}>
          <StatusBadge kind="event" status={e.state} />
          {e.state === 'removed' && e.moderation?.appeal && (
            <span className={styles.sub}>Организатор просит вернуть</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="События"
        subtitle="Все события платформы, включая снятые и прошедшие. Заявки участников рассматривает организатор."
      />

      {/* С16: жалобы участников */}
      <ReportsPanel target="event" />

      <Filters
        active={
          [params.state !== 'all', params.sport, params.org !== 'all', params.flagged].filter(Boolean).length
        }
        search={
          <Input
            className={styles.search}
            value={text}
            onChange={(e) => setText(e.target.value)}
            allowClear
            prefix={<MagnifyingGlassIcon size={20} aria-hidden />}
            placeholder="Название, место, направление или организатор"
            aria-label="Поиск встреч"
          />
        }
      >
        <Select
          className={styles.select}
          value={params.state}
          onChange={(state) => setParams({ state })}
          options={STATE_OPTIONS.map(({ value, label }) => ({ value, label }))}
          aria-label="Состояние"
        />
        <Select
          className={styles.select}
          value={params.sport || undefined}
          onChange={(sport?: string) => setParams({ sport: sport ?? '' })}
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Любое направление"
          options={usedSports.map((s) => ({ value: s.id, label: s.name }))}
          aria-label="Направление"
        />
        <Select
          className={styles.select}
          value={params.org}
          onChange={(org) => setParams({ org })}
          options={[
            { value: 'all', label: 'Любой организатор' },
            { value: 'org', label: 'Организации' },
            { value: 'user', label: 'Частные лица' },
          ]}
          aria-label="Кто организует"
        />
        <Checkbox
          className={styles.check}
          checked={Boolean(params.flagged)}
          onChange={(e) => setParams({ flagged: e.target.checked ? '1' : '' })}
        >
          Только с пометкой помощника
        </Checkbox>
      </Filters>

      {query.isError ? (
        <ErrorState title="Не удалось загрузить события" onRetry={() => void query.refetch()} />
      ) : (
        <>
          {!query.isLoading && (
            <p className={styles.resultLine} aria-live="polite">
              <span className={styles.resultCount}>{count(result?.total ?? 0, WORDS.event)}</span>
              {filtered && (
                <Button variant="quiet" size="sm" onClick={reset}>
                  Сбросить фильтры
                </Button>
              )}
            </p>
          )}
          <AdminTable
            caption="События"
            rows={rows}
            rowKey={(e) => e.id}
            columns={columns}
            loading={query.isLoading}
            server={{ page, total: result?.total ?? 0, onPageChange: (next) => setUrlParams({ page: String(next) }),
              sortKey: params.sort, sortOrder: params.order === 'asc' ? 'asc' : 'desc',
              onSortChange: (sort, order) => setUrlParams({ sort, order, page: '1' }) }}
            rowLink={(e) => `/admin/events/${e.id}`}
            empty={
              filtered ? (
                <EmptyState
                  title="По этим условиям событий нет"
                  actions={
                    <Button variant="secondary" onClick={reset}>
                      Сбросить фильтры
                    </Button>
                  }
                >
                  {params.flagged
                    ? 'Помощник ничего не пометил. Новые пометки появятся здесь сами.'
                    : 'Попробуйте другое слово или уберите фильтр.'}
                </EmptyState>
              ) : (
                <EmptyState title="Событий пока нет">
                  Когда кто-то опубликует событие, оно появится здесь.
                </EmptyState>
              )
            }
          />
        </>
      )}
    </div>
  );
}
