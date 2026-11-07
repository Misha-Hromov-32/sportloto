import { CheckCircleIcon, FlagIcon } from '@phosphor-icons/react';
import { useList } from '@refinedev/core';
import { useState } from 'react';
import { Link } from 'react-router';

import { Button, ErrorState, Section, SkeletonBlock } from '@/components';
import { COMMUNITY_API, useAction, useLiveRefetch } from '@/lib/api';
import { formatAgo } from '@/lib/dates';
import { count } from '@/lib/plural';
import type { ReportGroupView, ReportReason, ReportTarget } from '@/types/community';
import type { PlatformRule } from '@/types/domain';

import { DecisionModal, type DecisionValues } from '../parts/DecisionModal';
import { HIDE_TEMPLATES } from '../parts/labels';
import styles from './reports.module.css';

const REASON: Record<ReportReason, string> = {
  spam: 'Спам или реклама',
  fraud: 'Мошенничество',
  abuse: 'Оскорбления',
  danger: 'Опасно',
  other: 'Другое',
};
const REPORTS = ['жалоба', 'жалобы', 'жалоб'] as const;

type Decision = { group: ReportGroupView; kind: 'uphold' | 'dismiss' } | null;

/** С16: жалобы участников в очереди модерации событий или сообщений. */
export function ReportsPanel({ target }: { target: ReportTarget }) {
  const { result, query } = useList<ReportGroupView>({
    resource: 'reports',
    filters: [{ field: 'targetType', operator: 'eq', value: target }],
    pagination: { mode: 'off' },
  });
  useLiveRefetch(['reports', 'events', 'messages', 'demo'], () => void query.refetch());
  const { result: rules } = useList<PlatformRule>({ resource: 'rules', pagination: { mode: 'off' } });
  const { run } = useAction();
  const [decision, setDecision] = useState<Decision>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const groups = result?.data ?? [];

  if (query.isError) return <ErrorState title="Не удалось загрузить жалобы" onRetry={() => void query.refetch()} />;
  if (query.isLoading) return <SkeletonBlock height={120} />;
  if (!groups.length) return null;

  const decide = (group: ReportGroupView, kind: 'uphold' | 'dismiss', values: Partial<DecisionValues> = {}) =>
    run(
      COMMUNITY_API.decideReports,
      { targetType: group.targetType, targetId: group.targetId, decision: kind, ruleId: values.ruleId, reason: values.reason },
      {
        success:
          kind === 'dismiss'
            ? 'Жалоба отклонена. Авторы жалобы получат уведомление'
            : group.targetType === 'event'
              ? 'Событие снято. Авторы жалобы получат уведомление'
              : 'Сообщение скрыто. Авторы жалобы получат уведомление',
      },
    );

  const isEvent = target === 'event';
  const d = decision;

  return (
    <Section title={`Жалобы участников (${groups.length})`}>
      <ul className={styles.list}>
        {groups.map((g) => (
          <li key={g.id} className={styles.item}>
            <div className={styles.head}>
              <span className={styles.count}>
                <FlagIcon size={18} weight="bold" aria-hidden />
                {count(g.count, REPORTS)}
              </span>
              <span className={styles.when}>последняя {formatAgo(g.lastAt)}</span>
            </div>
            {isEvent ? (
              <p className={styles.preview}>
                <Link to={`/admin/events/${g.eventId}`}>{g.eventTitle}</Link>
                <span className={styles.sub}> Организатор: {g.authorName}</span>
              </p>
            ) : (
              <>
                <blockquote className={styles.quote}>{g.preview}</blockquote>
                <p className={[styles.preview, styles.sub].join(' ')}>
                  {g.authorName} в событии <Link to={`/admin/events/${g.eventId}`}>{g.eventTitle}</Link>
                </p>
              </>
            )}
            <ul className={styles.reasons} aria-label="Причины">
              {g.reasons.map((r) => (
                <li key={r.reason} className={styles.reason}>
                  {REASON[r.reason]}
                  {r.count > 1 && `: ${r.count}`}
                </li>
              ))}
            </ul>
            {g.comments.length > 0 && (
              <ul className={styles.comments} aria-label="Комментарии к жалобам">
                {g.comments.map((c) => (
                  <li key={c.at}>«{c.text}»</li>
                ))}
              </ul>
            )}
            <div className={styles.actions}>
              {g.alreadyHandled ? (
                <>
                  <span className={styles.handled}>
                    <CheckCircleIcon size={18} weight="bold" aria-hidden />
                    {isEvent ? 'Событие уже снято или удалено' : 'Сообщение уже скрыто или удалено'}
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={closing === g.id}
                    onClick={() => {
                      setClosing(g.id);
                      void decide(g, 'uphold')
                        .catch(() => undefined)
                        .finally(() => setClosing(null));
                    }}
                  >
                    Закрыть жалобы
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="danger" onClick={() => setDecision({ group: g, kind: 'uphold' })}>
                    {isEvent ? 'Снять с публикации' : 'Скрыть сообщение'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setDecision({ group: g, kind: 'dismiss' })}>
                    Отклонить жалобу
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <DecisionModal
        open={Boolean(d && d.kind === 'uphold')}
        title={isEvent ? 'Снять событие по жалобам' : 'Скрыть сообщение по жалобам'}
        confirmLabel={isEvent ? 'Снять с публикации' : 'Скрыть сообщение'}
        confirmTone="danger"
        consequences={
          isEvent
            ? [
                'Событие пропадёт из поиска, записаться на него будет нельзя.',
                'Организатор и записавшиеся получат уведомление с причиной.',
                `Все, кто пожаловался (${d?.group.count ?? 0}), узнают о решении.`,
              ]
            : [
                'Вместо текста все увидят «Сообщение скрыто модератором».',
                'Автор получит уведомление с причиной.',
                `Все, кто пожаловался (${d?.group.count ?? 0}), узнают о решении.`,
              ]
        }
        rules={{ list: rules?.data ?? [], required: isEvent }}
        reason={
          isEvent
            ? { label: 'Комментарий для организатора', required: false }
            : { label: 'Причина для автора', required: false, templates: HIDE_TEMPLATES }
        }
        onConfirm={(values) => decide(d!.group, 'uphold', values)}
        onClose={() => setDecision(null)}
      />
      <DecisionModal
        open={Boolean(d && d.kind === 'dismiss')}
        title="Отклонить жалобу"
        confirmLabel="Отклонить жалобу"
        consequences={[
          isEvent ? 'Событие останется в поиске.' : 'Сообщение останется в обсуждении.',
          'Все, кто пожаловался, получат уведомление: нарушений не нашли.',
        ]}
        reason={{ label: 'Что ответить авторам жалобы', required: false, placeholder: 'Например: проверили, встреча настоящая' }}
        onConfirm={(values) => decide(d!.group, 'dismiss', values)}
        onClose={() => setDecision(null)}
      />
    </Section>
  );
}
