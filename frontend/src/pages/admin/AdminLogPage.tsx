import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useList } from '@refinedev/core';
import { Input, Select } from 'antd';
import { useMemo } from 'react';
import { Link } from 'react-router';

import { Button, EmptyState, ErrorState, PageHeader } from '@/components';
import { dayjs, formatAgo } from '@/lib/dates';
import { normalize } from '@/lib/text';
import type { AuditView } from '@/types/api';
import type { AuditAction } from '@/types/domain';

import { AdminTable, type AdminColumn } from './parts/AdminTable';
import styles from './parts/admin.module.css';
import { Filters } from './parts/Filters';
import { useSearchField, useUrlParams } from './parts/hooks';
import { AUDIT_ACTION, AUDIT_GROUPS, auditTargetLink } from './parts/labels';

export default function AdminLogPage() {
  const [params, setParams] = useUrlParams({ q: '', action: '', actor: '' });
  const [text, setText] = useSearchField(params.q, (q) => setParams({ q }));

  const { result, query } = useList<AuditView>({ resource: 'audit', pagination: { mode: 'off' } });
  const all = useMemo(() => result?.data ?? [], [result]);

  const actors = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of all) map.set(a.actorId, a.actorName);
    return [...map]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [all]);

  const rows = useMemo(() => {
    const words = normalize(params.q).split(' ').filter(Boolean);
    return all.filter((a) => {
      if (params.action && !a.action.startsWith(params.action)) return false;
      if (params.actor && a.actorId !== params.actor) return false;
      if (words.length) {
        const hay = normalize(`${a.targetTitle} ${a.reason} ${a.actorName} ${a.ruleTitle ?? ''}`);
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }, [all, params]);

  const filtered = Boolean(params.q || params.action || params.actor);
  const reset = () => {
    setText('');
    setParams({ q: '', action: '', actor: '' });
  };

  const columns: AdminColumn<AuditView>[] = [
    {
      key: 'what',
      title: 'Что сделано',
      primary: true,
      render: (a) => {
        const link = auditTargetLink(a);
        return (
          <div className={styles.nameCell}>
            <strong>{AUDIT_ACTION[a.action]}</strong>
            {link ? (
              <Link to={link} className={styles.inlineIcon}>
                {a.targetTitle}
              </Link>
            ) : (
              <span>{a.targetTitle}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'who',
      title: 'Кто',
      width: 190,
      render: (a) => <span className={styles.nowrap}>{a.actorName}</span>,
    },
    {
      key: 'why',
      title: 'Причина',
      render: (a) =>
        a.ruleTitle || a.reason ? (
          <div className={styles.nameCell}>
            {a.ruleTitle && <span className={styles.sub}>Правило: {a.ruleTitle}</span>}
            {a.reason && <span>{a.reason}</span>}
          </div>
        ) : (
          <span className={styles.empty}>—</span>
        ),
    },
    {
      key: 'when',
      title: 'Когда',
      width: 170,
      sorter: (a, b) => a.at.localeCompare(b.at),
      defaultSortOrder: 'descend',
      render: (a) => (
        <div className={styles.nameCell}>
          <time dateTime={a.at} className={styles.nowrap}>
            {dayjs(a.at).format('D MMMM, HH:mm')}
          </time>
          <span className={styles.sub}>{formatAgo(a.at)}</span>
        </div>
      ),
    },
  ];

  const actionOptions = [
    {
      label: 'Разделы',
      options: AUDIT_GROUPS.map((g) => ({ value: g.value, label: g.label })),
    },
    {
      label: 'Отдельные действия',
      options: (Object.keys(AUDIT_ACTION) as AuditAction[]).map((k) => ({
        value: k,
        label: AUDIT_ACTION[k],
      })),
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Журнал"
        subtitle="Решения администраторов и важные действия организаторов. У каждой записи есть автор, время и причина."
      />

      <Filters
        active={[params.action, params.actor].filter(Boolean).length}
        search={
          <Input
            className={styles.search}
            value={text}
            onChange={(e) => setText(e.target.value)}
            allowClear
            prefix={<MagnifyingGlassIcon size={20} aria-hidden />}
            placeholder="Название, причина или имя"
            aria-label="Поиск по журналу"
          />
        }
      >
        <Select
          className={styles.select}
          value={params.action || undefined}
          onChange={(action?: string) => setParams({ action: action ?? '' })}
          allowClear
          placeholder="Любое действие"
          options={actionOptions}
          popupMatchSelectWidth={false}
          aria-label="Тип действия"
        />
        <Select
          className={styles.select}
          value={params.actor || undefined}
          onChange={(actor?: string) => setParams({ actor: actor ?? '' })}
          allowClear
          placeholder="Кто угодно"
          options={actors}
          aria-label="Кто сделал"
        />
      </Filters>

      {query.isError ? (
        <ErrorState title="Не удалось загрузить журнал" onRetry={() => void query.refetch()} />
      ) : (
        <>
          {!query.isLoading && (
            <p className={styles.resultLine} aria-live="polite">
              <span className={styles.resultCount}>Записей: {rows.length}</span>
              {filtered && (
                <Button variant="quiet" size="sm" onClick={reset}>
                  Сбросить фильтры
                </Button>
              )}
            </p>
          )}
          <AdminTable
            caption="Журнал действий"
            rows={rows}
            rowKey={(a) => a.id}
            columns={columns}
            loading={query.isLoading}
            pageSize={25}
            empty={
              filtered ? (
                <EmptyState
                  title="Таких записей нет"
                  actions={
                    <Button variant="secondary" onClick={reset}>
                      Сбросить фильтры
                    </Button>
                  }
                >
                  Попробуйте другое слово или уберите фильтр.
                </EmptyState>
              ) : (
                <EmptyState title="Журнал пуст">
                  Здесь появятся решения по организациям, снятые события и скрытые сообщения.
                </EmptyState>
              )
            }
          />
        </>
      )}
    </div>
  );
}
