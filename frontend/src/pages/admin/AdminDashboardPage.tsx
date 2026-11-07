import { useList } from '@refinedev/core';
import { Link } from 'react-router';

import { Button, EmptyState, ErrorState, PageHeader, Section, SkeletonBlock } from '@/components';
import { useAdminStats, useCommunityStats } from '@/lib/api';
import { dayjs, formatAgo } from '@/lib/dates';
import { truncate } from '@/lib/text';
import type { AuditView, EventView } from '@/types/api';

import styles from './parts/admin.module.css';
import { AUDIT_ACTION, auditTargetLink } from './parts/labels';
import { StopSignalsSection } from './stoplist/StopSignalsSection';

interface QueueItem {
  key: string;
  value: number | null;
  label: string;
  hint: string;
  to: string;
  hot?: boolean;
}

export default function AdminDashboardPage() {
  const { stats, isLoading, isError, refetch } = useAdminStats();
  const { data: community } = useCommunityStats(); // С16, В8
  const { result: audit, query: auditQuery } = useList<AuditView>({
    resource: 'audit',
    pagination: { mode: 'off' },
  });

  const { result: removed, query: removedQuery } = useList<EventView>({
    resource: 'events',
    filters: [
      { field: 'scope', operator: 'eq', value: 'admin' },
      { field: 'status', operator: 'eq', value: 'removed' },
    ],
    pagination: { mode: 'off' },
  });
  const appeals = removedQuery.isLoading
    ? null
    : (removed?.data ?? []).filter((e) => e.moderation?.appeal).length;

  const weekAgo = dayjs().subtract(7, 'day');
  const entries = audit?.data ?? [];
  const removedThisWeek = auditQuery.isLoading
    ? null
    : entries.filter((a) => a.action === 'event.remove' && dayjs(a.at).isAfter(weekAgo)).length;

  if (isError) {
    return (
      <div className={styles.page}>
        <PageHeader title="Сводка" />
        <ErrorState title="Не удалось загрузить сводку" onRetry={() => void refetch()} />
      </div>
    );
  }

  const queues: QueueItem[] = [
    {
      key: 'orgs',
      value: stats?.pendingOrgs ?? null,
      label: 'Организации ждут решения',
      hint: stats?.flaggedOrgs
        ? `Пока заявка не рассмотрена, клуб не может публиковать события. Из них помощник пометил: ${stats.flaggedOrgs}`
        : 'Пока заявка не рассмотрена, клуб не может публиковать события',
      to: '/admin/organizations?status=pending',
      hot: true,
    },
    {
      key: 'flagged-events',
      value: stats?.flaggedEvents ?? null,
      label: 'События с пометкой помощника',
      hint: 'Возможная реклама или обман. Проверьте пометку помощника',
      to: '/admin/events?flagged=1',
    },
    {
      key: 'flagged-messages',
      value: stats?.flaggedMessages ?? null,
      label: 'Сообщения с пометкой помощника',
      hint: 'Спам или грубость в обсуждениях. Пока вы не решили, сообщения видны всем',
      to: '/admin/messages',
    },
    {
      key: 'sports',
      value: stats?.customSports ?? null,
      label: 'Направления, которых нет в каталоге',
      hint: 'Их добавили пользователи. Перенесите в каталог или объедините с похожим',
      to: '/admin/sports',
    },
    {
      key: 'removed-week',
      value: removedThisWeek,
      label: 'Снято с публикации за неделю',
      hint: 'Кто снял, когда и по какому правилу, видно в журнале',
      to: '/admin/log?action=event.remove',
    },
    {
      key: 'appeals',
      value: appeals,
      label: 'Просят вернуть событие',
      hint: stats
        ? `Организатор исправил карточку после снятия. Всего снято сейчас: ${stats.removedEvents}`
        : 'Организатор исправил карточку после снятия',
      to: '/admin/events?state=appeal',
    },
    // С16, В8: жалобы участников и посты сообществ
    {
      key: 'reports',
      value: community ? community.reports.events + community.reports.messages : null,
      label: 'Жалобы участников',
      hint: community
        ? `На события: ${community.reports.events}, на сообщения: ${community.reports.messages}. Пожаловавшиеся узнают о решении`
        : 'Пожаловавшиеся узнают о решении',
      to:
        community && !community.reports.events && community.reports.messages
          ? '/admin/messages'
          : '/admin/events',
      hot: true,
    },
    {
      key: 'imports',
      value: community?.imports.drafts ?? null,
      label: 'Посты сообществ ждут проверки',
      hint: 'Помощник разобрал их в черновики встреч. Опубликуйте или отклоните',
      to: '/admin/imports',
    },
  ];

  return (
    <div className={[styles.page, styles.cards].join(' ')}>
      <PageHeader title="Сводка" subtitle="Что ждёт вашего решения. Цифры обновляются сами." />

      <div role="region" aria-labelledby="queues-title">
        <h2 id="queues-title" className="sr-only">
          Очереди
        </h2>
        <div className={styles.board}>
          {queues.map((q) => (
            <Link key={q.key} to={q.to} className={styles.boardItem}>
              <span
                className={[
                  styles.boardNum,
                  q.value === 0 && styles.boardNumZero,
                  q.hot && q.value ? styles.boardNumHot : undefined,
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden={q.value === null}
              >
                {q.value === null || isLoading ? <SkeletonBlock width={56} height={48} /> : q.value}
              </span>
              <span className={styles.boardText}>
                <span className={styles.boardLabel}>{q.label}</span>
                <span className={styles.boardHint}>{q.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <StopSignalsSection />

      <Section title="За неделю">
        <dl className={styles.stats}>
          {[
            ['Опубликовано сейчас', stats?.publishedEvents],
            ['Новых событий', stats?.week?.newEvents],
            ['Новых записей', stats?.week?.joins],
            ['Вопросов в обсуждениях', stats?.week?.questions],
            ['Из них с ответом', stats?.week?.answeredQuestions],
          ].map(([label, value]) => (
            <div key={String(label)} className={styles.stat}>
              <dt>{label}</dt>
              <dd>{value === undefined ? <SkeletonBlock width={48} height={32} /> : value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section
        title="Последние действия"
        actions={
          <Button to="/admin/log" variant="secondary" size="sm">
            Открыть журнал
          </Button>
        }
      >
        {auditQuery.isError ? (
          <ErrorState title="Не удалось загрузить журнал" onRetry={() => void auditQuery.refetch()} />
        ) : auditQuery.isLoading ? (
          <div className={styles.logList} aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className={styles.logItem}>
                <SkeletonBlock width={120} height={16} />
                <SkeletonBlock width="70%" height={20} />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState title="Действий пока не было">
            Здесь появятся решения по организациям, снятия событий и скрытые сообщения.
          </EmptyState>
        ) : (
          <ul className={styles.logList}>
            {entries.slice(0, 6).map((a) => {
              const link = auditTargetLink(a);
              return (
                <li key={a.id} className={styles.logItem}>
                  <time className={styles.logWhen} dateTime={a.at}>
                    {formatAgo(a.at)}
                  </time>
                  <div className={styles.logWhat}>
                    <span>
                      <strong>{AUDIT_ACTION[a.action]}:</strong>{' '}
                      {link ? <Link to={link}>{a.targetTitle}</Link> : <span>{a.targetTitle}</span>}
                    </span>
                    <span className={styles.sub}>
                      {a.actorName}
                      {a.ruleTitle && `. Правило: ${a.ruleTitle}`}
                      {a.reason && `. ${truncate(a.reason, 160)}`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
