import {
  CalendarXIcon,
  CardsIcon,
  ClockClockwiseIcon,
  ClockCountdownIcon,
  CalendarCheckIcon,
  EyeIcon,
  PencilSimpleIcon,
  PrinterIcon,
} from '@phosphor-icons/react';
import { useMany, useOne } from '@refinedev/core';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';

import {
  Button,
  CollectProgress,
  EmptyState,
  ErrorState,
  EventStateBanner,
  GoneState,
  NoAccessState,
  PageSkeleton,
  StatusBadge,
} from '@/components';
import { useMe, type ApiError } from '@/lib/api';
import { formatAgo, formatEventDate } from '@/lib/dates';
import { JOIN_MODE } from '@/lib/labels';
import { useSettings } from '@/theme/useSettings';
import type { EventDetails, UserView } from '@/types/api';
import type { PlatformRule } from '@/types/domain';

import { sentence } from '../me/parts/groups';
import { PillTabs } from '../me/parts/PillTabs';
import { PersonalPage } from '../shared/PersonalPage';
import { AckPanel } from './manage/AckPanel';
import { ApplicationCard } from './manage/ApplicationCard';
import { DiscussionPanel } from './manage/DiscussionPanel';
import { CancelDialog, RescheduleDialog } from './manage/EventDialogs';
import styles from './manage/manage.module.css';
import { unansweredQuestions, useEventMessages } from './manage/manageData';
import { ParticipantsPanel, WaitlistPanel } from './manage/PeoplePanels';
import { ReviewDeck } from './manage/review/ReviewDeck';
import { BestPlaceButton } from './manage/bestplace/BestPlaceButton'; // В5
import { ManageCommunity } from './manage/greeter/ManageCommunity'; // С1, С3, Н2
// С11, С14: «Создать похожее» и список участников таблицей
import { CreateSimilarButton } from './create/templates/CreateSimilar';
import { InvitePanel } from './event/company/InvitePanel';
import { OrganizerTeams } from './event/company/TeamPanel';
import { GatherAgain } from './event/company/GatherAgain';
import { ExportParticipants } from '../orgs/managers/ExportParticipants';
import { EventMoneyPanel } from './manage/money/EventMoneyPanel'; // оплата на сайте

type ManageTab = 'requests' | 'participants' | 'waitlist' | 'discussion' | 'ack';
const TABS: ManageTab[] = ['requests', 'participants', 'waitlist', 'discussion', 'ack'];

export default function EventManagePage() {
  const { id = '' } = useParams();
  const { me, role } = useMe();
  const isAdmin = role === 'admin';
  const { result: event, query } = useOne<EventDetails>({
    resource: 'events',
    id,
    liveMode: 'auto',
    queryOptions: { enabled: !isAdmin },
  });

  if (isAdmin) {
    return (
      <div className="container">
        <NoAccessState
          title="Заявки рассматривает организатор"
          actions={
            <Button variant="primary" to={`/admin/events/${id}`}>
              Открыть модерацию
            </Button>
          }
        >
          Администратор не принимает и не отклоняет заявки участников, это решение автора события. В
          администрировании можно посмотреть участников и снять событие с публикации.
        </NoAccessState>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="container">
        <PageSkeleton label="Загружаем управление событием…" />
      </div>
    );
  }

  if (query.isError || !event) {
    const error = query.error as ApiError | null;
    return (
      <div className="container">
        {error?.code === 'event_deleted' || error?.code === 'not_found' ? (
          <GoneState
            title={error.code === 'not_found' ? 'Такого события нет' : 'Событие удалено'}
            actions={
              <Button variant="secondary" to="/me?tab=organizing">
                К моим событиям
              </Button>
            }
          >
            {error.message}
          </GoneState>
        ) : (
          <ErrorState layout="page" onRetry={() => void query.refetch()}>
            Не удалось загрузить событие. Проверьте интернет и нажмите «Повторить».
          </ErrorState>
        )}
      </div>
    );
  }

  if (!event.isOrganizer) {
    return (
      <div className="container">
        <NoAccessState
          title="Управлять событием может только организатор"
          actions={
            <Button variant="primary" to={`/events/${event.id}`}>
              Открыть событие
            </Button>
          }
        >
          Вы вошли как {me?.name}. Заявки и список участников видит автор события или представитель
          организации, от имени которой оно опубликовано.
        </NoAccessState>
      </div>
    );
  }

  if (event.state === 'deleted') return <Deleted event={event} />;

  return <Manage event={event} />;
}

/** Удалённым не управляют, но организатор должен видеть, по какому правилу и почему. */
function Deleted({ event }: { event: EventDetails }) {
  const { result: rule } = useOne<PlatformRule>({
    resource: 'rules',
    id: event.moderation?.ruleId ?? '',
    queryOptions: { enabled: Boolean(event.moderation?.ruleId) },
  });
  return (
    <div className="container">
      <GoneState
        title={event.moderation ? 'Событие удалено модератором' : 'Событие удалено'}
        actions={
          <Button variant="secondary" to="/me?tab=organizing">
            К моим событиям
          </Button>
        }
      >
        {[
          rule ? `Нарушено правило ${rule.number}: ${rule.title}.` : null,
          event.moderation?.comment ? `Комментарий: ${sentence(event.moderation.comment)}` : null,
          'Записаться на него нельзя, управлять им тоже.',
        ]
          .filter(Boolean)
          .join(' ')}
      </GoneState>
    </div>
  );
}

function Manage({ event }: { event: EventDetails }) {
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<'reschedule' | 'cancel' | null>(null);
  const { messages, query: messagesQuery } = useEventMessages(event.id);
  const manage = event.manage!;
  const pending = manage.pending;

  const { result: rule } = useOne<PlatformRule>({
    resource: 'rules',
    id: event.moderation?.ruleId ?? '',
    queryOptions: { enabled: Boolean(event.moderation?.ruleId) },
  });
  const { result: profiles } = useMany<UserView>({
    resource: 'users',
    ids: pending.map((p) => p.userId),
    queryOptions: { enabled: pending.length > 0 },
  });
  const profileById = new Map((profiles?.data ?? []).map((u) => [u.id, u]));

  // Заявки, пришедшие после открытия страницы, подсвечиваются: так организатор замечает живое обновление.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(pending.map((p) => p.id));
  const freshIds = pending.filter((p) => !seen.current!.has(p.id)).map((p) => p.id);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (freshIds.length)
      setAnnounce(`Новая заявка: ${pending.find((p) => p.id === freshIds.at(-1))?.user.name}`);
  }, [freshIds.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Стопка «По одной» живёт в адресе: «Назад» в браузере закрывает её
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const reviewing = params.get('review') === 'cards';
  const openReview = () =>
    navigate({ search: '?tab=requests&review=cards' }, { state: { fromManage: true } });
  const closeReview = () => {
    if ((location.state as { fromManage?: boolean } | null)?.fromManage) navigate(-1);
    else setParams({ tab: 'requests' }, { replace: true });
  };
  if (reviewing) {
    return (
      <div className="container">
        <ReviewDeck
          eventId={event.id}
          exitLabel="К списку заявок"
          summaryExitLabel="Назад к событию"
          participantsTo={`/events/${event.id}/manage?tab=participants`}
          onExit={closeReview}
        />
      </div>
    );
  }
  const canReview =
    !settings.simple && pending.length >= 2 && (event.state === 'upcoming' || event.state === 'live');

  const upcoming = event.state === 'upcoming';
  const editable = event.can.edit;
  const appeal = event.moderation?.appeal ?? null;
  const editLink = `/events/${event.id}/edit`;
  const full = event.capacity !== null && event.counts.spotsLeft === 0;
  const open = unansweredQuestions(messages);
  const showRequests = event.joinMode === 'approval' || pending.length > 0;
  const showAck = event.changes.length > 0;

  const tabs = TABS.filter((t) => (t === 'requests' ? showRequests : t === 'ack' ? showAck : true)).map(
    (key) => ({
      key,
      label: {
        requests: 'Заявки',
        participants: 'Участники',
        waitlist: 'Лист ожидания',
        discussion: 'Обсуждение',
        ack: 'Кто в курсе изменений',
      }[key],
      count: {
        requests: pending.length,
        participants: event.counts.confirmed,
        waitlist: event.counts.waitlist,
        discussion: open.length || undefined,
        ack: undefined,
      }[key],
      attention: (key === 'requests' && pending.length > 0) || (key === 'discussion' && open.length > 0),
    }),
  );
  const tabParam = params.get('tab') as ManageTab | null;
  const fallback: ManageTab = showRequests && pending.length ? 'requests' : 'participants';
  const tab: ManageTab = tabParam && tabs.some((t) => t.key === tabParam) ? tabParam : fallback;
  const setTab = (next: ManageTab) => setParams({ tab: next }, { replace: true, preventScrollReset: true });

  const actionsLockedNote =
    event.state === 'past'
      ? 'Встреча прошла, менять её нельзя.'
      : event.state === 'live'
        ? 'Встреча уже идёт, менять её нельзя.'
        : event.state === 'cancelled'
          ? 'Встреча отменена.'
          : event.state === 'removed'
            ? 'Пока событие снято, переносить его нельзя. Исправить карточку можно.'
            : null;

  return (
    <PersonalPage
      title="Управление встречей"
      eyebrow={event.sport.name}
      description={
        <>
          <strong>{event.title}</strong>
          <br />
          {formatEventDate(event.startsAt)}
        </>
      }
      icon={<CalendarCheckIcon size={28} />}
      value={event.counts.confirmed}
      summary={
        <>
          <strong>Участников в составе</strong>Ниже заявки, список участников и вопросы к встрече.
        </>
      }
      actions={
        <Button variant="quiet" to={`/events/${event.id}`} icon={<EyeIcon size={18} aria-hidden />}>
          К карточке события
        </Button>
      }
    >
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <EventStateBanner
        state={event.state}
        cancelReason={event.cancelReason}
        moderation={event.moderation}
        rule={rule ?? null}
        isOrganizer
      />

      {event.state === 'removed' &&
        (appeal ? (
          <p className={styles.appealSent} role="status">
            <ClockCountdownIcon size={20} weight="fill" aria-hidden />
            <span>
              Вы попросили вернуть событие {formatAgo(appeal.at)}. Администратор посмотрит исправления,
              решение придёт в уведомлениях.
            </span>
          </p>
        ) : (
          event.can.appeal && (
            <div className={styles.appeal}>
              <Button variant="primary" to={`${editLink}?appeal=1`}>
                Исправить и попросить вернуть
              </Button>
            </div>
          )
        ))}

      <section className={styles.board} aria-label="Состояние события">
        <div className={styles.boardMain}>
          <div className={styles.stateLine}>
            <StatusBadge kind="event" status={event.state} size="lg" />
            <span className={styles.mode}>{JOIN_MODE[event.joinMode].label}</span>
          </div>
          <CollectProgress
            counts={event.counts}
            capacity={event.capacity}
            minParticipants={event.minParticipants}
            seats={event.seats}
            variant="full"
          />
        </div>
        <div className={styles.boardActions}>
          <Button
            variant="secondary"
            to={editLink}
            disabled={!editable}
            icon={<PencilSimpleIcon size={20} aria-hidden />}
          >
            Изменить
          </Button>
          <Button
            variant="secondary"
            disabled={!upcoming}
            icon={<ClockClockwiseIcon size={20} aria-hidden />}
            onClick={() => setDialog('reschedule')}
          >
            Перенести
          </Button>
          {/* В5: удобное место для всей компании */}
          <BestPlaceButton event={event} />
          <Button
            variant="quiet"
            to={`/events/${event.id}/poster`}
            icon={<PrinterIcon size={20} aria-hidden />}
          >
            Распечатать афишу
          </Button>
          <Button variant="quiet" to={`/events/${event.id}`} icon={<EyeIcon size={20} aria-hidden />}>
            Посмотреть как участник
          </Button>
          {/* С11, С14 */}
          <CreateSimilarButton eventId={event.id} variant="quiet" />
          <ExportParticipants event={event} />
          {upcoming && (
            <Button
              variant="quiet"
              icon={<CalendarXIcon size={20} aria-hidden />}
              onClick={() => setDialog('cancel')}
            >
              Отменить встречу
            </Button>
          )}
          {actionsLockedNote && <p className={styles.actionsNote}>{actionsLockedNote}</p>}
        </div>
      </section>

      <EventMoneyPanel event={event} />

      <PillTabs tabs={tabs} active={tab} onChange={setTab} label="Управление событием">
        {tab === 'requests' ? (
          pending.length ? (
            <div className={styles.cards}>
              {canReview && (
                <div>
                  <Button variant="secondary" icon={<CardsIcon size={20} aria-hidden />} onClick={openReview}>
                    Разобрать по одной ({pending.length})
                  </Button>
                </div>
              )}
              {pending.map((p) => (
                <ApplicationCard
                  key={p.id}
                  application={p}
                  profile={profileById.get(p.userId)}
                  full={full}
                  fresh={freshIds.includes(p.id)}
                  editLink={editLink}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="Новых заявок нет">
              Когда кто-то отправит заявку, она появится здесь сразу, без обновления страницы, и придёт
              уведомление.
            </EmptyState>
          )
        ) : tab === 'participants' ? (
          <ParticipantsPanel event={event} />
        ) : tab === 'waitlist' ? (
          <WaitlistPanel event={event} editLink={editLink} />
        ) : tab === 'discussion' ? (
          <DiscussionPanel
            eventId={event.id}
            messages={messages}
            isLoading={messagesQuery.isLoading}
            isError={messagesQuery.isError}
            onRetry={() => void messagesQuery.refetch()}
          />
        ) : (
          <AckPanel event={event} />
        )}
      </PillTabs>

      {/* С1, С3, Н2: кто встретит новичков, срочный добор, программа поддержки ветеранов */}
      <InvitePanel event={event} />
      <OrganizerTeams event={event} />
      <GatherAgain event={event} />
      <ManageCommunity event={event} />

      {dialog === 'reschedule' && <RescheduleDialog event={event} open onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelDialog event={event} open onClose={() => setDialog(null)} />}
    </PersonalPage>
  );
}
