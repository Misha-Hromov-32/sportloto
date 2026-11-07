import {
  ArrowSquareOutIcon,
  ArrowUUpLeftIcon,
  BuildingsIcon,
  InfoIcon,
  ProhibitIcon,
  RobotIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useList, useOne } from '@refinedev/core';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import {
  AssistantFlag,
  AssistantMark,
  Avatar,
  Button,
  DiscussionMessage,
  EmptyState,
  ErrorState,
  GoneState,
  OrganizerBlock,
  PageHeader,
  PageSkeleton,
  Section,
  SkeletonText,
  SportIcon,
  StatusBadge,
} from '@/components';
import { API, useAction, useLiveRefetch, type ApiError } from '@/lib/api';
import { formatAgo, formatDuration, formatEventDate } from '@/lib/dates';
import { EVENT_LEVEL, JOIN_MODE, SKILL_LEVEL } from '@/lib/labels';
import { priceSummary } from '@/lib/money';
import { count, plural, WORDS } from '@/lib/plural';
import type { AuditView, EventDetails, MessageView, ParticipantView } from '@/types/api';
import type { PlatformRule } from '@/types/domain';

import { DecisionModal } from './parts/DecisionModal';
import styles from './parts/admin.module.css';
import { quoted } from './parts/labels';
import { useMessageModeration } from './parts/useMessageModeration';

type Moderation = 'remove' | 'restore' | 'delete';

export default function AdminEventPage() {
  const { id = '' } = useParams();
  const { result: event, query } = useOne<EventDetails>({ resource: 'events', id });
  const { result: messagesRes, query: messagesQuery } = useList<MessageView>({
    resource: 'messages',
    filters: [{ field: 'eventId', operator: 'eq', value: id }],
    pagination: { mode: 'off' },
  });
  const { result: rulesRes } = useList<PlatformRule>({ resource: 'rules', pagination: { mode: 'off' } });
  const { result: auditRes } = useList<AuditView>({
    resource: 'audit',
    filters: [{ field: 'targetType', operator: 'eq', value: 'event' }],
    pagination: { mode: 'off' },
  });
  useLiveRefetch(['participations', 'messages'], () => void query.refetch());

  const rules = rulesRes?.data ?? [];
  const messages = messagesRes?.data ?? [];
  const { run, isPending } = useAction();
  const [modal, setModal] = useState<Moderation | null>(null);
  const moderation = useMessageModeration(rules);

  if (query.isLoading) return <PageSkeleton />;
  if (query.isError || !event) {
    const notFound = (query.error as ApiError | null)?.statusCode === 404;
    return (
      <div className={styles.page}>
        <PageHeader title="Событие" back={{ to: '/admin/events', label: 'Все события' }} />
        {notFound ? (
          <GoneState
            title="Такого события нет"
            layout="inline"
            actions={
              <Button variant="secondary" to="/admin/events">
                К списку событий
              </Button>
            }
          >
            Возможно, ссылка устарела. Найдите событие по названию в списке.
          </GoneState>
        ) : (
          <ErrorState title="Не удалось загрузить событие" onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }

  const active = event.counts.confirmed + event.counts.pending + event.counts.waitlist;
  const frozen = event.manage?.declined.filter((p) => p.status === 'event_removed').length ?? 0;
  const notifiedText = (n: number) =>
    `${count(n, WORDS.person)} ${plural(n, ['получит', 'получат', 'получат'])} уведомление`;
  const moderator = (auditRes?.data ?? []).find(
    (a) => a.targetId === event.id && (a.action === 'event.remove' || a.action === 'event.delete'),
  );
  const rule = rules.find((r) => r.id === event.moderation?.ruleId) ?? null;
  const price = priceSummary(event.price, event.counts.confirmed, event.minParticipants);
  const manage = event.manage;

  const moderate =
    (action: Moderation) =>
    async ({ ruleId, reason }: { ruleId?: string; reason: string }) =>
      run(
        API.moderateEvent(event.id),
        { action, ruleId, comment: reason },
        {
          success: {
            remove: 'Событие снято с публикации. Организатор и участники получили уведомление',
            restore: 'Событие снова в поиске. Записи восстановлены',
            delete: 'Событие удалено',
          }[action],
        },
      );

  const dismissFlag = () =>
    void run(API.dismissEventFlag(event.id), {}, { success: 'Пометка помощника снята' }).catch(
      () => undefined,
    );

  const parentOf = (m: MessageView) =>
    m.replyTo ? (messages.find((x) => x.id === m.replyTo) ?? null) : null;

  return (
    <div className={styles.page}>
      <PageHeader
        back={{ to: '/admin/events', label: 'Все события' }}
        context={
          <span className={styles.inlineIcon}>
            <SportIcon sport={event.sport} size={20} />
            {event.sport.name}
          </span>
        }
        title={event.title}
      />
      <div className={[styles.headBadges, styles.pageHead].join(' ')}>
        <StatusBadge kind="event" status={event.state} size="lg" />
        {event.createdWithAssistant && (
          <AssistantMark why="Карточку заполняли в режиме «Создать с помощником»." />
        )}
      </div>

      {event.aiFlag !== 'none' && <AssistantFlag flag={event.aiFlag} reason={event.aiReason} />}

      <div className={styles.detail}>
        <aside className={[styles.aside, styles.asideFirst].join(' ')} aria-label="Модерация">
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Модерация</h2>
            <p className={styles.panelText}>{panelText(event)}</p>
            <div className={styles.panelActions}>
              {event.status === 'published' && (
                <Button
                  variant="danger"
                  block
                  icon={<ProhibitIcon size={20} aria-hidden />}
                  onClick={() => setModal('remove')}
                >
                  Снять с публикации
                </Button>
              )}
              {(event.status === 'removed' || event.status === 'deleted') && (
                <Button variant="primary" block onClick={() => setModal('restore')}>
                  Вернуть в публикацию
                </Button>
              )}
              {event.aiFlag !== 'none' && event.status === 'published' && (
                <Button
                  variant="secondary"
                  block
                  icon={<RobotIcon size={20} aria-hidden />}
                  onClick={dismissFlag}
                  loading={isPending && modal === null}
                >
                  Снять пометку помощника
                </Button>
              )}
              {event.status !== 'deleted' && (
                <Button
                  variant="secondary"
                  block
                  icon={<TrashIcon size={20} aria-hidden />}
                  onClick={() => setModal('delete')}
                >
                  Удалить
                </Button>
              )}
              <Button
                variant="quiet"
                block
                to={`/events/${event.id}`}
                icon={<ArrowSquareOutIcon size={20} aria-hidden />}
              >
                Как видят участники
              </Button>
            </div>
          </section>
        </aside>

        <div className={styles.main}>
          {event.status === 'removed' && event.moderation?.appeal && (
            <div className={[styles.note, styles.warnNote].join(' ')} role="status">
              <ArrowUUpLeftIcon size={20} aria-hidden />
              <div className={styles.stackList}>
                <strong>Организатор просит вернуть событие, {formatAgo(event.moderation.appeal.at)}</strong>
                {event.moderation.appeal.comment && <span>«{event.moderation.appeal.comment}»</span>}
                <span className={styles.sub}>
                  Проверьте карточку ниже. Если всё исправлено, верните событие в публикацию.
                </span>
              </div>
            </div>
          )}

          {event.moderation && (
            <div className={[styles.note, styles.warnNote].join(' ')} role="status">
              <InfoIcon size={20} aria-hidden />
              <div className={styles.stackList}>
                <strong>
                  {event.moderation.action === 'removed' ? 'Снято с публикации' : 'Удалено'}{' '}
                  {formatAgo(event.moderation.at)}
                  {moderator ? `. Кто решил: ${moderator.actorName}` : ''}
                </strong>
                {rule && (
                  <span>
                    Правило {rule.number}: <Link to={`/rules#${rule.id}`}>{rule.title}</Link>
                  </span>
                )}
                {event.moderation.comment && <span>Комментарий: {event.moderation.comment}</span>}
                <span className={styles.sub}>
                  Организатор и записавшиеся видят эту причину на карточке события.
                </span>
              </div>
            </div>
          )}

          <Section title="Сведения">
            <dl className={styles.facts}>
              <dt>Когда</dt>
              <dd>
                {formatEventDate(event.startsAt)}, {formatDuration(event.durationMin)}
              </dd>
              <dt>Где</dt>
              <dd>
                {[event.place.address, event.districtName].filter(Boolean).join(', ')}
                {event.place.landmark && <span className={styles.sub}>. {event.place.landmark}</span>}
              </dd>
              <dt>Уровень</dt>
              <dd>
                {EVENT_LEVEL[event.level]}
                {event.beginnersWelcome && event.level !== 'beginner' ? ', рады новичкам' : ''}
              </dd>
              <dt>Запись</dt>
              <dd>
                {JOIN_MODE[event.joinMode].label}.{' '}
                {event.capacity ? `Мест: ${event.capacity}. ` : 'Без ограничения мест. '}
                {event.minParticipants ? `Состоится, если наберётся ${event.minParticipants}.` : ''}
              </dd>
              <dt>Цена</dt>
              <dd>{price.main}</dd>
              <dt>Обсуждение</dt>
              <dd>{event.discussion === 'everyone' ? 'Открыто всем' : 'Только для участников'}</dd>
              <dt>Описание</dt>
              <dd className={styles.prose}>
                {event.description || <span className={styles.empty}>Не заполнено</span>}
              </dd>
              {event.firstStep.bring && (
                <>
                  <dt>Взять с собой</dt>
                  <dd>{event.firstStep.bring}</dd>
                </>
              )}
              {event.privateInfo && (
                <>
                  <dt>Только участникам</dt>
                  <dd className={styles.prose}>{event.privateInfo}</dd>
                </>
              )}
              {event.cancelReason && (
                <>
                  <dt>Причина отмены</dt>
                  <dd>{event.cancelReason}</dd>
                </>
              )}
              <dt>Опубликовано</dt>
              <dd>{formatAgo(event.createdAt)}</dd>
            </dl>
          </Section>

          <Section title="Организатор">
            <OrganizerBlock organizer={event.organizerView} />
            {event.organizer.kind === 'org' && (
              <Button
                variant="secondary"
                size="sm"
                to={`/admin/organizations/${event.organizer.id}`}
                icon={<BuildingsIcon size={20} aria-hidden />}
              >
                Заявка организации
              </Button>
            )}
          </Section>

          <Section title="Участники и заявки" aside={event.counts.confirmed}>
            <p className={styles.note}>
              <InfoIcon size={20} aria-hidden />
              <span>Решения по заявкам принимает организатор. Здесь можно только посмотреть.</span>
            </p>
            {manage ? (
              <>
                <PeopleGroup
                  title="Участники"
                  people={manage.confirmed}
                  empty={frozen ? undefined : 'Пока никто не записался'}
                />
                <PeopleGroup title="Ждут решения организатора" people={manage.pending} />
                <PeopleGroup title="Лист ожидания" people={manage.waitlist} />
                <PeopleGroup
                  title="Записи приостановлены до возврата события"
                  people={manage.declined.filter((p) => p.status === 'event_removed')}
                />
                <PeopleGroup
                  title="Отказы и отмены"
                  people={manage.declined.filter((p) => p.status !== 'event_removed')}
                />
              </>
            ) : (
              <SkeletonText lines={3} />
            )}
          </Section>

          <Section title="Обсуждение" aside={event.messagesCount}>
            {messagesQuery.isError ? (
              <ErrorState
                title="Не удалось загрузить обсуждение"
                onRetry={() => void messagesQuery.refetch()}
              />
            ) : messagesQuery.isLoading ? (
              <SkeletonText lines={4} />
            ) : messages.length === 0 ? (
              <EmptyState title="Сообщений нет">Вопросов к организатору пока не задавали.</EmptyState>
            ) : (
              <div className={styles.discussion} id="discussion">
                {messages.map((m) => (
                  <div key={m.id}>
                    <DiscussionMessage message={m} parent={parentOf(m)} showFlag canReact={false} />
                    {!m.system && m.status !== 'deleted' && (
                      <MessageActions
                        message={m}
                        busy={moderation.busyIds.includes(m.id)}
                        onHide={() => moderation.askHide([m])}
                        onKeep={() => void moderation.keep([m])}
                        onRestore={() => void moderation.restore([m])}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      <DecisionModal
        open={modal === 'remove'}
        title={`Снять ${quoted(event.title)} с публикации?`}
        confirmLabel="Снять с публикации"
        confirmTone="danger"
        consequences={[
          'Событие пропадёт из поиска и ленты.',
          'Записаться будет нельзя, даже по прямой ссылке. На карточке появится причина.',
          `${notifiedText(active + 1)}: организатор и записавшиеся. Их записи приостановятся.`,
          'Вернуть в публикацию можно здесь же, тогда записи восстановятся сами.',
        ]}
        rules={{ list: rules, required: true, initial: event.aiFlag === 'spam' ? 'rule-1' : null }}
        reason={{
          label: 'Комментарий для организатора',
          hint: 'Что не так и что исправить, чтобы событие вернули.',
          required: false,
          placeholder: 'Например: уберите ссылки на продажу абонементов',
        }}
        onConfirm={moderate('remove')}
        onClose={() => setModal(null)}
      />
      <DecisionModal
        open={modal === 'restore'}
        title={`Вернуть ${quoted(event.title)} в публикацию?`}
        confirmLabel="Вернуть в публикацию"
        consequences={[
          'Событие снова появится в поиске, на него можно будет записаться.',
          'Записи, которые были до снятия, восстановятся.',
          'Организатор и участники получат уведомление.',
        ]}
        onConfirm={moderate('restore')}
        onClose={() => setModal(null)}
      />
      <DecisionModal
        open={modal === 'delete'}
        title={`Удалить ${quoted(event.title)}?`}
        confirmLabel="Удалить событие"
        confirmTone="danger"
        consequences={[
          'Событие исчезнет из поиска и из «Моих занятий». По ссылке участники увидят, что событие удалено.',
          `${notifiedText(active + frozen + 1)}: организатор и записавшиеся.`,
          'Если удалили по ошибке, событие можно вернуть из этой карточки.',
        ]}
        rules={{ list: rules, required: true, initial: event.moderation?.ruleId ?? null }}
        reason={{ label: 'Комментарий', required: false }}
        onConfirm={moderate('delete')}
        onClose={() => setModal(null)}
      />
      {moderation.modal}
    </div>
  );
}

function panelText(e: EventDetails): string {
  if (e.status === 'removed' && e.moderation?.appeal)
    return 'Организатор исправил карточку и просит вернуть событие. Проверьте и решите.';
  if (e.status === 'removed') return 'Событие снято: его нет в поиске, записаться нельзя. Записи приостановлены.';
  if (e.status === 'deleted') return 'Событие удалено. По прямой ссылке участники видят, что его удалили.';
  if (e.status === 'cancelled') return 'Организатор отменил событие. Записаться на него нельзя.';
  if (e.state === 'past') return 'Событие прошло. Оно в архиве организатора и участников.';
  return 'Событие в поиске, на него можно записаться. Снимите, если оно нарушает правила.';
}

function PeopleGroup({ title, people, empty }: { title: string; people: ParticipantView[]; empty?: string }) {
  if (!people.length && !empty) return null;
  return (
    <div>
      <h3 className="h3">
        {title} <span className={styles.num}>{people.length}</span>
      </h3>
      {people.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <ul className={styles.peopleList}>
          {people.map((p) => (
            <li key={p.id} className={styles.peopleItem}>
              <div className={styles.person}>
                <Avatar name={p.user.name} initials={p.user.initials} src={p.user.avatarUrl} size={40} />
                <div className={styles.personBody}>
                  <Link to={`/profile/${p.user.id}`} className={styles.nameLink}>
                    {p.user.name}
                  </Link>
                  <span className={styles.sub}>
                    {[
                      p.user.level && SKILL_LEVEL[p.user.level],
                      p.user.age && count(p.user.age, ['год', 'года', 'лет']),
                    ]
                      .filter(Boolean)
                      .join(', ') || 'Уровень не указан'}
                  </span>
                  {p.note && <span className={styles.sub}>Сообщение: «{p.note}»</span>}
                  {p.rejectReason && <span className={styles.sub}>Причина отказа: {p.rejectReason}</span>}
                </div>
              </div>
              <StatusBadge
                kind="participation"
                status={p.status}
                audience="organizer"
                waitlistPosition={p.waitlistPosition}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageActions({
  message,
  busy,
  onHide,
  onKeep,
  onRestore,
}: {
  message: MessageView;
  busy: boolean;
  onHide: () => void;
  onKeep: () => void;
  onRestore: () => void;
}) {
  const buttons: ReactNode[] = [];
  if (message.status === 'hidden') {
    buttons.push(
      <Button key="restore" size="sm" variant="secondary" onClick={onRestore} loading={busy}>
        Вернуть сообщение
      </Button>,
    );
  } else {
    buttons.push(
      <Button key="hide" size="sm" variant="secondary" onClick={onHide} disabled={busy}>
        Скрыть
      </Button>,
    );
    if (message.aiFlag !== 'none')
      buttons.push(
        <Button key="keep" size="sm" variant="quiet" onClick={onKeep} loading={busy}>
          Оставить, снять пометку
        </Button>,
      );
  }
  return <div className={styles.adminMsgActions}>{buttons}</div>;
}
