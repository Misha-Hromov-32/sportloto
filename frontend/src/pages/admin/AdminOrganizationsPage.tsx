import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useList } from '@refinedev/core';
import { Checkbox, Input, Select } from 'antd';
import { useMemo } from 'react';
import { Link } from 'react-router';

import { Button, Chip, EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components';
import { formatAgo } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import { normalize } from '@/lib/text';
import type { OrganizationView } from '@/types/api';
import type { OrgStatus } from '@/types/domain';

import { AdminTable, type AdminColumn } from './parts/AdminTable';
import { AiFlagNote } from './parts/AiFlagNote';
import styles from './parts/admin.module.css';
import { Filters } from './parts/Filters';
import { useSearchField, useUrlParams } from './parts/hooks';
import { submittedAt } from './parts/labels';

const STATUS_ORDER: OrgStatus[] = ['pending', 'returned', 'rejected', 'approved', 'draft', 'blocked'];

const STATUS_FILTER_LABEL: Record<OrgStatus, string> = {
  pending: 'Ждут решения',
  returned: 'На доработке',
  rejected: 'Отклонены',
  approved: 'Допущены',
  draft: 'Черновики',
  blocked: 'Заблокированы',
};

export default function AdminOrganizationsPage() {
  const [params, setParams] = useUrlParams({ q: '', status: 'all', flagged: '', sort: 'new' });
  const [text, setText] = useSearchField(params.q, (q) => setParams({ q }));

  const { result, query } = useList<OrganizationView>({
    resource: 'organizations',
    filters: [{ field: 'scope', operator: 'eq', value: 'admin' }],
    pagination: { mode: 'off' },
  });
  const all = useMemo(() => result?.data ?? [], [result]);

  const counts = useMemo(() => {
    const c: Partial<Record<OrgStatus, number>> = {};
    for (const o of all) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [all]);

  const rows = useMemo(() => {
    const words = normalize(params.q).split(' ').filter(Boolean);
    const list = all.filter((o) => {
      if (params.status !== 'all' && o.status !== params.status) return false;
      if (params.flagged && o.aiFlag === 'none') return false;
      if (words.length) {
        const hay = normalize(`${o.name} ${o.description} ${o.owner?.name ?? ''} ${o.address}`);
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const dir = params.sort === 'old' ? 1 : -1;
    return [...list].sort((a, b) => dir * submittedAt(a).localeCompare(submittedAt(b)));
  }, [all, params]);

  const filtered = Boolean(params.q || params.status !== 'all' || params.flagged);
  const reset = () => {
    setText('');
    setParams({ q: '', status: 'all', flagged: '' });
  };

  const columns: AdminColumn<OrganizationView>[] = [
    {
      key: 'name',
      title: 'Организация',
      primary: true,
      render: (o) => (
        <div className={styles.nameCell}>
          <Link to={`/admin/organizations/${o.id}`} className={styles.nameLink}>
            {o.name}
          </Link>
          <span className={styles.sub}>{o.typeLabel}</span>
          <AiFlagNote flag={o.aiFlag} reason={o.aiReason} subject="org" />
        </div>
      ),
    },
    {
      key: 'status',
      title: 'Состояние',
      width: 190,
      render: (o) => <StatusBadge kind="org" status={o.status} />,
    },
    {
      key: 'submitted',
      title: 'Заявка подана',
      width: 150,
      render: (o) => (
        <time dateTime={submittedAt(o)} className={styles.nowrap}>
          {formatAgo(submittedAt(o))}
        </time>
      ),
    },
    {
      key: 'owner',
      title: 'Представитель',
      width: 170,
      render: (o) => o.owner?.name ?? <span className={styles.empty}>—</span>,
    },
    {
      key: 'events',
      title: 'Событий',
      width: 90,
      align: 'right',
      render: (o) => <span className={styles.num}>{o.eventsCount}</span>,
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Организации"
        subtitle="Заявки на допуск и допущенные клубы. Пока заявку не одобрили, организация не может публиковать события."
      />

      <Filters
        active={[params.sort !== 'new', params.flagged].filter(Boolean).length}
        search={
          <Input
            className={styles.search}
            value={text}
            onChange={(e) => setText(e.target.value)}
            allowClear
            prefix={<MagnifyingGlassIcon size={20} aria-hidden />}
            placeholder="Название, описание или представитель"
            aria-label="Поиск организаций"
          />
        }
      >
        <Select
          className={styles.select}
          value={params.sort}
          onChange={(sort) => setParams({ sort })}
          aria-label="Порядок"
          options={[
            { value: 'new', label: 'Новые заявки выше' },
            { value: 'old', label: 'Давние заявки выше' },
          ]}
        />
        <Checkbox
          className={styles.check}
          checked={Boolean(params.flagged)}
          onChange={(e) => setParams({ flagged: e.target.checked ? '1' : '' })}
        >
          Только с пометкой помощника
        </Checkbox>
      </Filters>

      <div className={styles.chips} role="group" aria-label="Состояние заявки">
        <Chip
          selected={params.status === 'all'}
          onClick={() => setParams({ status: 'all' })}
          count={all.length}
        >
          Все
        </Chip>
        {STATUS_ORDER.filter((s) => counts[s] || s === 'pending').map((s) => (
          <Chip
            key={s}
            selected={params.status === s}
            onClick={() => setParams({ status: s })}
            count={counts[s] ?? 0}
          >
            {STATUS_FILTER_LABEL[s]}
          </Chip>
        ))}
      </div>

      {query.isError ? (
        <ErrorState title="Не удалось загрузить организации" onRetry={() => void query.refetch()} />
      ) : (
        <>
          {!query.isLoading && (
            <p className={styles.resultLine} aria-live="polite">
              <span className={styles.resultCount}>{count(rows.length, WORDS.organization)}</span>
              {filtered && (
                <Button variant="quiet" size="sm" onClick={reset}>
                  Сбросить фильтры
                </Button>
              )}
            </p>
          )}
          <AdminTable
            caption="Организации"
            rows={rows}
            rowKey={(o) => o.id}
            columns={columns}
            loading={query.isLoading}
            rowLink={(o) => `/admin/organizations/${o.id}`}
            empty={
              filtered ? (
                <EmptyState
                  title="По этим условиям организаций нет"
                  actions={
                    <Button variant="secondary" onClick={reset}>
                      Сбросить фильтры
                    </Button>
                  }
                >
                  {params.status === 'pending'
                    ? 'Все заявки рассмотрены. Новые появятся здесь сами.'
                    : 'Попробуйте другое слово или уберите фильтр.'}
                </EmptyState>
              ) : (
                <EmptyState title="Организаций пока нет">
                  Когда кто-то отправит заявку на допуск, она появится здесь.
                </EmptyState>
              )
            }
          />
        </>
      )}
    </div>
  );
}
