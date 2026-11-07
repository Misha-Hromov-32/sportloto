import {
  ArrowUUpLeftIcon,
  CalendarPlusIcon,
  CheckCircleIcon,
  PaperPlaneTiltIcon,
  XCircleIcon,
  type Icon,
} from '@phosphor-icons/react';
import { useMany } from '@refinedev/core';
import { Segmented } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router';

import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  EventCard,
  ListSkeleton,
  Section,
  SkeletonBlock,
} from '@/components';
import { dayjs, formatAgo, formatEventDate } from '@/lib/dates';
import { SKILL_LEVEL } from '@/lib/labels';
import type { EventDetails, EventView, OrganizationView } from '@/types/api';
import type { OrganizationReview } from '@/types/domain';

import styles from './CabinetParts.module.css';

const REVIEW: Record<OrganizationReview['decision'], { label: string; icon: Icon; tone: string }> = {
  submitted: { label: 'Заявка отправлена на проверку', icon: PaperPlaneTiltIcon, tone: styles.neutral! },
  approved: { label: 'Администратор допустил организацию', icon: CheckCircleIcon, tone: styles.ok! },
  rejected: { label: 'Администратор отклонил заявку', icon: XCircleIcon, tone: styles.danger! },
  returned: { label: 'Администратор вернул заявку на доработку', icon: ArrowUUpLeftIcon, tone: styles.wait! },
};

export function ReviewHistory({ reviews }: { reviews: OrganizationReview[] }) {
  const list = [...reviews].reverse();
  return (
    <Section title="История заявки" aside={list.length || undefined}>
      {list.length === 0 ? (
        <p className={styles.muted}>Заявка ещё не отправлялась.</p>
      ) : (
        <ol className={styles.history}>
          {list.map((r) => {
            const meta = REVIEW[r.decision];
            const IconEl = meta.icon;
            return (
              <li key={r.id} className={styles.historyItem}>
                <span className={[styles.historyIcon, meta.tone].join(' ')}>
                  <IconEl size={20} weight="bold" aria-hidden />
                </span>
                <div className={styles.historyBody}>
                  <p className={styles.historyTitle}>{meta.label}</p>
                  <p className={styles.historyTime}>{formatAgo(r.at)}</p>
                  {r.reason && <p className={styles.historyReason}>{r.reason}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

/** Честные цифры: ноль показываем нулём. «За 30 дней» — подтверждённые участники прошедших встреч. */
export function OrgStats({
  org,
  events,
  isLoading,
}: {
  org: OrganizationView;
  events: EventView[];
  isLoading: boolean;
}) {
  const monthAgo = dayjs().subtract(30, 'day');
  const people = events
    .filter((e) => e.state === 'past' && dayjs(e.startsAt).isAfter(monthAgo))
    .reduce((sum, e) => sum + e.counts.confirmed, 0);
  const pending = events.filter((e) => e.state === 'upcoming').reduce((sum, e) => sum + e.counts.pending, 0);
  const items = [
    { label: 'Встреч проведено', value: org.facts.held },
    { label: 'Участников за 30 дней', value: people },
    { label: 'Встреч впереди', value: org.facts.upcoming },
    { label: 'Заявок ждут решения', value: pending },
  ];
  return (
    <dl className={styles.stats} aria-label="Цифры организации">
      {items.map((i) => (
        <div key={i.label} className={styles.stat}>
          <dt className={styles.statLabel}>{i.label}</dt>
          <dd className={styles.statValue}>
            {isLoading ? <SkeletonBlock width={48} height={36} /> : i.value.toLocaleString('ru-RU')}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Заявки по всем встречам организации. Решение — на экране управления встречей. */
export function Applications({ events }: { events: EventView[] }) {
  const withPending = events.filter((e) => e.state === 'upcoming' && e.counts.pending > 0);
  const ids = withPending.map((e) => e.id);
  const { result, query } = useMany<EventDetails>({
    resource: 'events',
    ids,
    queryOptions: { enabled: ids.length > 0 },
    errorNotification: false,
  });
  const total = withPending.reduce((sum, e) => sum + e.counts.pending, 0);
  const details = new Map(result.data.map((d) => [d.id, d]));

  return (
    <Section title="Заявки участников" aside={total || undefined} id="applications">
      {withPending.length === 0 ? (
        <EmptyState title="Новых заявок нет" icon={<CheckCircleIcon size={28} aria-hidden />}>
          Здесь появятся заявки на встречи клуба. Принимать или отклонять их могут организаторы клуба.
        </EmptyState>
      ) : query.isError ? (
        <ErrorState title="Не удалось загрузить заявки" onRetry={() => void query.refetch()} />
      ) : (
        <ul className={styles.apps}>
          {withPending.map((e) => {
            const people = details.get(e.id)?.manage?.pending ?? [];
            return (
              <li key={e.id} className={styles.app}>
                <div className={styles.appHead}>
                  <div className={styles.appEvent}>
                    <Link to={`/events/${e.id}`} className={styles.appTitle}>
                      {e.title}
                    </Link>
                    <span className={styles.appMeta}>
                      {formatEventDate(e.startsAt)}. Ждут решения: {e.counts.pending}
                    </span>
                  </div>
                  <Button variant="secondary" size="sm" to={`/events/${e.id}/manage`}>
                    Рассмотреть заявки
                  </Button>
                </div>
                {query.isLoading ? (
                  <SkeletonBlock height={48} />
                ) : (
                  <ul className={styles.people}>
                    {people.map((p) => (
                      <li key={p.id} className={styles.person}>
                        <Avatar
                          name={p.user.name}
                          initials={p.user.initials}
                          src={p.user.avatarUrl}
                          size={40}
                        />
                        <div className={styles.personBody}>
                          <p className={styles.personName}>
                            {p.user.name}
                            {p.user.level && (
                              <span className={styles.personLevel}>{SKILL_LEVEL[p.user.level]}</span>
                            )}
                          </p>
                          {p.note && <p className={styles.personNote}>«{p.note}»</p>}
                          <p className={styles.personTime}>Заявка {formatAgo(p.createdAt)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

type EventsTab = 'upcoming' | 'past';

export function OrgEvents({
  org,
  events,
  isLoading,
  isError,
  onRetry,
}: {
  org: OrganizationView;
  events: EventView[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const [tab, setTab] = useState<EventsTab>('upcoming');
  const upcoming = events.filter((e) => e.state === 'upcoming' || e.state === 'live');
  const past = events
    .filter((e) => !['upcoming', 'live'].includes(e.state))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const list = tab === 'upcoming' ? upcoming : past;

  return (
    <Section
      title="Встречи организации"
      actions={
        upcoming.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            to={`/events/new?org=${org.id}`}
            icon={<CalendarPlusIcon size={20} aria-hidden />}
          >
            Создать встречу
          </Button>
        )
      }
    >
      <Segmented<EventsTab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upcoming', label: `Предстоящие ${isLoading ? '' : upcoming.length}`.trim() },
          { value: 'past', label: `Прошедшие ${isLoading ? '' : past.length}`.trim() },
        ]}
        className={styles.tabs}
      />
      {isError ? (
        <ErrorState title="Не удалось загрузить встречи" onRetry={onRetry} />
      ) : isLoading ? (
        <ListSkeleton count={2} label="Загружаем встречи…" />
      ) : list.length === 0 ? (
        tab === 'upcoming' ? (
          <EmptyState
            title="Предстоящих встреч нет"
            icon={<CalendarPlusIcon size={28} aria-hidden />}
            actions={
              <Button variant="primary" to={`/events/new?org=${org.id}`}>
                Создать встречу
              </Button>
            }
          >
            Встреча появится в поиске и на странице организации сразу после публикации.
          </EmptyState>
        ) : (
          <EmptyState title="Прошедших встреч пока нет">
            Сюда попадают прошедшие и отменённые встречи.
          </EmptyState>
        )
      ) : (
        <ul className={styles.events}>
          {list.map((e) => (
            <li key={e.id}>
              <EventCard event={e} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
