import {
  CalendarPlusIcon,
  CheckIcon,
  GearIcon,
  ArrowsLeftRightIcon,
  MagnifyingGlassIcon,
  MapTrifoldIcon,
  PlusIcon,
  CalendarBlankIcon,
  ProhibitIcon,
} from '@phosphor-icons/react';
import { WalletIcon } from '@phosphor-icons/react'; // оплата на сайте: «Мои деньги»
import { useList } from '@refinedev/core';
import { App, Segmented } from 'antd';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import {
  Button,
  EmptyState,
  ErrorState,
  NoAccessState,
  Section,
  SkeletonBlock,
  useStopList,
} from '@/components';
import { API, useAction, useMe } from '@/lib/api';
import { formatEventDate } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import type { EventView } from '@/types/api';

import {
  collectTried,
  groupByMonth,
  groupUpcoming,
  MY_TABS,
  organizerStatus,
  participantStatus,
  participationTab,
  type DateGroup,
  type MyTab,
  type RowStatus,
} from './parts/groups';
import { downloadIcs } from './parts/ics';
import { CabinetOverview } from './parts/CabinetOverview';
import { MyEventRow } from './parts/MyEventRow';
import { PillTabs } from './parts/PillTabs';
import { TriedCollection } from './parts/TriedCollection';
import styles from './MyPage.module.css';
import { PersonalPage } from '../shared/PersonalPage';
// С4, С6, С9, С10: место из листа ожидания, «Не смогу в новое время», календарь, серия
import { OfferActions } from '../events/event/participation/OfferNote';
import { RescheduleDecline } from '../events/event/participation/RescheduleDecline';
import { MyCalendar } from './calendar/MyCalendar';
import { groupSeries } from './calendar/series';
import { SeriesMore } from './calendar/SeriesMore';
// С8, С11, С15, Н5: вкладка «Избранное», «Создать похожее», «Встреча состоялась?», занятия без сети
import { FavoritesTab } from './favorites/FavoritesTab';
import { OfflineGate } from './offline/OfflinePanel';
import { CreateSimilarButton } from '../events/create/templates/CreateSimilar';
import { HeldQuestion } from '../orgs/managers/Reliability';
// Заявки «По одной» по всем своим событиям
import { PendingReviewBlock } from '../events/manage/review/PendingReviewBlock';
import { ReviewDeck } from '../events/manage/review/ReviewDeck';

const TAB_LABEL: Record<MyTab, string> = {
  upcoming: 'Предстоящие',
  requests: 'Заявки',
  organizing: 'Организую',
  past: 'Прошедшие',
};

function useEvents(scope: 'participating' | 'organizing', enabled: boolean) {
  const { result, query } = useList<EventView>({
    resource: 'events',
    filters: [{ field: 'scope', operator: 'eq', value: scope }],
    pagination: { mode: 'off' },
    liveMode: 'auto',
    queryOptions: { enabled },
  });
  return {
    items: result.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}

export default function MyPage() {
  const { me, role } = useMe();
  const isAdmin = role === 'admin';
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  // С8: «Избранное» — отдельная вкладка рядом с вкладками записей
  const tab: MyTab | 'favorites' =
    tabParam === 'favorites'
      ? 'favorites'
      : tabParam && MY_TABS.includes(tabParam as MyTab)
        ? (tabParam as MyTab)
        : 'upcoming';
  // С9: вид «Список» или «Календарь» тоже живёт в адресе
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list';
  const setView = (next: 'list' | 'calendar') =>
    setParams(next === 'calendar' ? { view: next } : tab === 'upcoming' ? {} : { tab }, {
      replace: true,
      preventScrollReset: true,
    });
  const setTab = (next: MyTab | 'favorites') =>
    setParams(next === 'upcoming' ? {} : { tab: next }, { replace: true, preventScrollReset: true });

  const navigate = useNavigate();
  const location = useLocation();
  const reviewing = params.get('review') === 'cards';
  const openReview = () =>
    navigate({ search: '?tab=organizing&review=cards' }, { state: { fromCabinet: true } });
  const closeReview = () => {
    if ((location.state as { fromCabinet?: boolean } | null)?.fromCabinet) navigate(-1);
    else setParams({ tab: 'organizing' }, { replace: true });
  };

  const participating = useEvents('participating', !isAdmin && !reviewing);
  const organizing = useEvents('organizing', !isAdmin && !reviewing);

  const buckets = useMemo(() => {
    const by: Record<MyTab, EventView[]> = { upcoming: [], requests: [], organizing: [], past: [] };
    for (const e of participating.items) {
      const t = participationTab(e);
      if (t) by[t].push(e);
    }
    const organizedPast: EventView[] = [];
    for (const e of organizing.items) {
      if (e.state === 'past') organizedPast.push(e);
      else by.organizing.push(e);
    }
    return { ...by, organizedPast };
  }, [participating.items, organizing.items]);

  if (isAdmin) {
    return (
      <div className="container">
        <NoAccessState
          title="У администратора нет своих занятий"
          actions={
            <Button variant="primary" to="/admin">
              К администрированию
            </Button>
          }
        >
          Администратор не записывается на события и не проводит их. Этот раздел для участников и
          организаторов.
        </NoAccessState>
      </div>
    );
  }

  if (reviewing) {
    return (
      <div className="container">
        <ReviewDeck exitLabel="К моим событиям" summaryExitLabel="К событиям" onExit={closeReview} />
      </div>
    );
  }

  const isLoading = participating.isLoading || organizing.isLoading;
  const isError = participating.isError || organizing.isError;
  const calendarEvents = buckets.upcoming.filter(
    (e) => e.my?.status === 'confirmed' && (e.state === 'upcoming' || e.state === 'live'),
  );
  const needsAck = buckets.upcoming.some(
    (e) => (e.my?.unackedChangeIds.length ?? 0) > 0 || Boolean(e.my?.offerUntil), // С4: ждёт ответа «Иду»
  );
  const waitingDecisions = buckets.organizing.reduce((sum, e) => sum + e.counts.pending, 0);

  const tabs = [
    ...MY_TABS.map((key) => ({
      key: key as MyTab | 'favorites',
      label: TAB_LABEL[key],
      count: isLoading ? undefined : key === 'past' ? undefined : buckets[key].length,
      attention: (key === 'upcoming' && needsAck) || (key === 'organizing' && waitingDecisions > 0),
    })),
    { key: 'favorites' as const, label: 'Избранное', count: undefined, attention: false }, // С8
  ];

  return (
    <PersonalPage
      title="Мои занятия"
      description={subtitle(calendarEvents.length, waitingDecisions)}
      icon={<CalendarBlankIcon size={28} />}
      summary={
        <>
          <strong>Работает и без интернета</strong>Ближайшие записи сохраняются на этом устройстве.
        </>
      }
      actions={
        <>
          <Button to="/events" variant="primary" icon={<MagnifyingGlassIcon size={20} aria-hidden />}>
            Найти встречу
          </Button>
          <Button to="/me/money" variant="secondary" icon={<WalletIcon size={20} aria-hidden />}>
            Мои деньги
          </Button>
          {calendarEvents.length > 0 && (
            <Button
              variant="secondary"
              className={styles.calendarExport}
              aria-label="Добавить занятия в календарь"
              icon={<CalendarPlusIcon size={20} aria-hidden />}
              onClick={() => downloadIcs(calendarEvents)}
            >
              В календарь
            </Button>
          )}
        </>
      }
    >
      {/* Н5: без связи — сохранённые ближайшие записи */}
      <OfflineGate userId={me?.id} failed={isError}>
        {me && (
          <CabinetOverview
            me={me}
            upcoming={buckets.upcoming}
            organizing={buckets.organizing}
            waiting={waitingDecisions}
            loading={isLoading}
            onTab={setTab}
          />
        )}

        <div className={styles.activity}>
          <div className={styles.activityHead}>
            <h2 className={styles.activityTitle}>Ваши занятия</h2>
            <Segmented<'list' | 'calendar'>
              aria-label="Как показать занятия"
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'Списком' },
                { value: 'calendar', label: 'Календарём' },
              ]}
            />
          </div>
          {view === 'calendar' ? (
            isError ? (
              <ErrorState
                onRetry={() => {
                  participating.refetch();
                  organizing.refetch();
                }}
              >
                Не удалось загрузить ваши занятия. Проверьте интернет и нажмите «Повторить».
              </ErrorState>
            ) : isLoading ? (
              <RowsSkeleton />
            ) : (
              <MyCalendar participating={participating.items} organizing={organizing.items} />
            )
          ) : (
            <PillTabs tabs={tabs} active={tab} onChange={setTab} label="Мои занятия">
              {tab === 'favorites' ? (
                <FavoritesTab />
              ) : isError ? (
                <ErrorState
                  onRetry={() => {
                    participating.refetch();
                    organizing.refetch();
                  }}
                >
                  Не удалось загрузить ваши занятия. Проверьте интернет и нажмите «Повторить».
                </ErrorState>
              ) : isLoading ? (
                <RowsSkeleton />
              ) : tab === 'upcoming' ? (
                <UpcomingTab events={buckets.upcoming} />
              ) : tab === 'requests' ? (
                <RequestsTab events={buckets.requests} />
              ) : tab === 'organizing' ? (
                <OrganizingTab events={buckets.organizing} onReview={openReview} />
              ) : (
                <PastTab attended={buckets.past} organized={buckets.organizedPast} />
              )}
            </PillTabs>
          )}
        </div>
      </OfflineGate>
    </PersonalPage>
  );
}

function subtitle(upcoming: number, waiting: number): string {
  if (waiting > 0) return `${count(waiting, WORDS.application)} на ваши события ждут решения.`;
  if (upcoming > 0)
    return `Впереди ${count(upcoming, WORDS.event)}. Всё, на что вы записаны и что проводите.`;
  return 'Всё, на что вы записаны и что проводите.';
}

function RowsSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-live="polite">
      <span className="sr-only">Загружаем ваши занятия…</span>
      <SkeletonBlock width={160} height={28} />
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.skeletonRow} aria-hidden>
          <SkeletonBlock width={64} height={32} />
          <div className={styles.skeletonBody}>
            <SkeletonBlock width={120} height={14} />
            <SkeletonBlock width="70%" height={22} />
            <SkeletonBlock width="50%" height={14} />
            <SkeletonBlock width={180} height={32} radius="pill" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Groups({ groups, render }: { groups: DateGroup<EventView>[]; render: (e: EventView) => ReactNode }) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className={styles.group} aria-labelledby={`group-${g.key}`}>
          <h2 id={`group-${g.key}`} className={styles.groupTitle}>
            {g.label}
            {g.hint && <span className={styles.groupHint}>{g.hint}</span>}
          </h2>
          <ul className={styles.rows}>{g.items.map(render)}</ul>
        </section>
      ))}
    </>
  );
}

/** Действия строки участника: одно на строку, с подтверждением для необратимых. */
function useParticipantActions() {
  const { run } = useAction();
  const { modal } = App.useApp();
  const [busy, setBusy] = useState<string | null>(null);

  const go = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch {
      /* текст ошибки уже показан */
    } finally {
      setBusy(null);
    }
  };

  const confirmLeave = (e: EventView, kind: 'withdraw' | 'leaveQueue') => {
    const withdraw = kind === 'withdraw';
    modal.confirm({
      title: withdraw ? 'Отозвать заявку?' : 'Выйти из листа ожидания?',
      content: withdraw
        ? `Заявка на «${e.title}» пропадёт у организатора. Подать её снова можно в карточке события.`
        : `Вы потеряете место в очереди на «${e.title}». Встать снова можно в карточке события, но уже в конец очереди.`,
      okText: withdraw ? 'Отозвать заявку' : 'Выйти из очереди',
      cancelText: withdraw ? 'Оставить заявку' : 'Остаться в очереди',
      okButtonProps: { danger: true },
      onOk: () =>
        go(`leave-${e.id}`, () =>
          run(API.leaveEvent(e.id), {}, { success: withdraw ? 'Заявка отозвана' : 'Вы вышли из очереди' }),
        ),
    });
  };

  const navigate = useNavigate();
  const render = (e: EventView, status: RowStatus): ReactNode => {
    switch (status.action.kind) {
      case 'route':
        return (
          <Button
            size="sm"
            variant="secondary"
            to={`/events/${e.id}#where`}
            icon={<MapTrifoldIcon size={20} aria-hidden />}
          >
            Как добраться
          </Button>
        );
      case 'ack':
        return (
          <>
            <Button
              size="sm"
              variant="primary"
              icon={<CheckIcon size={20} weight="bold" aria-hidden />}
              loading={busy === `ack-${e.id}`}
              loadingText="Отмечаем…"
              onClick={() =>
                go(`ack-${e.id}`, () =>
                  run(API.ackChanges(e.id), {}, { success: 'Организатор увидит, что вы в курсе' }),
                )
              }
            >
              Я в курсе
            </Button>
            {/* С6: перенос не подошёл — отмена и похожие встречи */}
            <RescheduleDecline event={e} size="sm" onDone={() => navigate(`/events/${e.id}#plan-b`)} />
          </>
        );
      case 'offer':
        return <OfferActions event={e} size="sm" />;
      case 'planB':
        return (
          <Button
            size="sm"
            variant="secondary"
            to={`/events/${e.id}#plan-b`}
            icon={<ArrowsLeftRightIcon size={20} aria-hidden />}
          >
            Похожие встречи
          </Button>
        );
      case 'withdraw':
        return (
          <Button
            size="sm"
            variant="secondary"
            loading={busy === `leave-${e.id}`}
            loadingText="Отзываем…"
            onClick={() => confirmLeave(e, 'withdraw')}
          >
            Отозвать заявку
          </Button>
        );
      case 'leaveQueue':
        return (
          <Button
            size="sm"
            variant="quiet"
            loading={busy === `leave-${e.id}`}
            loadingText="Выходим…"
            onClick={() => confirmLeave(e, 'leaveQueue')}
          >
            Выйти из очереди
          </Button>
        );
      case 'findOther':
        return (
          <Button size="sm" variant="quiet" to="/events" icon={<MagnifyingGlassIcon size={20} aria-hidden />}>
            Найти другое занятие
          </Button>
        );
      default:
        return null;
    }
  };

  return render;
}

function organizerCaption(e: EventView): string | undefined {
  return e.organizerView.kind === 'org'
    ? `От имени «${e.organizerView.name.replace(/[«»]/g, '')}»`
    : undefined;
}

function UpcomingTab({ events }: { events: EventView[] }) {
  const actions = useParticipantActions();
  if (!events.length) {
    return (
      <EmptyState
        title="Здесь появятся занятия, на которые вы записались"
        actions={
          <Button variant="primary" to="/events" icon={<MagnifyingGlassIcon size={20} aria-hidden />}>
            Найти встречу
          </Button>
        }
      >
        У каждой записи вы увидите время, место и что взять с собой.
      </EmptyState>
    );
  }
  // С10: встречи одной серии — под ближайшей
  const { visible, rest } = groupSeries(events);
  return (
    <Groups
      groups={groupUpcoming(visible)}
      render={(e) => {
        const status = participantStatus(e);
        const more = rest.get(e.id);
        return (
          <Fragment key={e.id}>
            <MyEventRow event={e} status={status} action={actions(e, status)} />
            {more && <SeriesMore events={more} />}
          </Fragment>
        );
      }}
    />
  );
}

function RequestsTab({ events }: { events: EventView[] }) {
  const actions = useParticipantActions();
  if (!events.length) {
    return (
      <EmptyState
        title="Заявок нет"
        actions={
          <Button variant="primary" to="/events" icon={<MagnifyingGlassIcon size={20} aria-hidden />}>
            Найти встречу
          </Button>
        }
      >
        Заявку отправляют на события, где организатор сам выбирает участников. Здесь видно, что он решил, и
        место в листе ожидания.
      </EmptyState>
    );
  }
  const order = { pending: 0, waitlist: 1, rejected: 2 } as Record<string, number>;
  const sorted = [...events].sort(
    (a, b) => (order[a.my!.status] ?? 3) - (order[b.my!.status] ?? 3) || a.startsAt.localeCompare(b.startsAt),
  );
  return (
    <section className={styles.group} aria-label="Заявки и лист ожидания">
      <ul className={styles.rows}>
        {sorted.map((e) => {
          const status = participantStatus(e);
          return (
            <MyEventRow
              key={e.id}
              event={e}
              status={status}
              caption={formatEventDate(e.startsAt)}
              action={actions(e, status)}
            />
          );
        })}
      </ul>
    </section>
  );
}

/** D-16: ненавязчивая ссылка на личный стоп-лист во вкладке «Организую». */
function StopListLink({ always }: { always: boolean }) {
  const { me } = useMe();
  const { data, active } = useStopList(me ? `user:${me.id}` : null);
  if (!data || (!always && !data.entries.length)) return null;
  return (
    <p className={styles.stopLink}>
      <Button size="sm" variant="quiet" to="/me/stop-list" icon={<ProhibitIcon size={20} aria-hidden />}>
        {active ? `Стоп-лист (${active})` : 'Стоп-лист'}
      </Button>
    </p>
  );
}

function OrganizingTab({ events, onReview }: { events: EventView[]; onReview: () => void }) {
  const { role } = useMe();
  if (!events.length) {
    return (
      <>
        <EmptyState
          title="Вы пока ничего не проводите"
          actions={
            <Button
              variant="primary"
              to="/events/new"
              icon={<PlusIcon size={20} weight="bold" aria-hidden />}
            >
              Создать встречу
            </Button>
          }
        >
          {role === 'org'
            ? 'Создайте встречу от себя или от имени организации. Заявки и участники появятся здесь.'
            : 'Создайте встречу, и здесь появятся заявки, участники и лист ожидания.'}
        </EmptyState>
        <StopListLink always={false} />
      </>
    );
  }
  return (
    <>
      <PendingReviewBlock onOpen={onReview} />
      <Groups
        groups={groupUpcoming(events)}
        render={(e) => {
          const status = organizerStatus(e);
          const attention = status.action.kind === 'manage' && status.action.attention;
          return (
            <MyEventRow
              key={e.id}
              event={e}
              status={status}
              caption={organizerCaption(e)}
              action={
                status.action.kind === 'open' ? (
                  <Button size="sm" variant="secondary" to={`/events/${e.id}`}>
                    Открыть
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={attention ? 'primary' : 'secondary'}
                    to={`/events/${e.id}/manage`}
                    icon={<GearIcon size={20} aria-hidden />}
                  >
                    Управлять
                  </Button>
                )
              }
            />
          );
        }}
      />
      <StopListLink always />
    </>
  );
}

function PastTab({ attended, organized }: { attended: EventView[]; organized: EventView[] }) {
  const all = [...attended, ...organized];
  const tried = collectTried(all.filter((e) => e.my?.status !== 'removed'));
  if (!all.length) {
    return (
      <EmptyState
        title="Прошедших занятий пока нет"
        actions={
          <Button variant="primary" to="/events" icon={<MagnifyingGlassIcon size={20} aria-hidden />}>
            Найти встречу
          </Button>
        }
      >
        После окончания встречи её запись появится здесь, а вид спорта — в коллекции «Попробовано».
      </EmptyState>
    );
  }
  return (
    <>
      <Section title="Попробовано" aside={count(tried.length, WORDS.sport)}>
        <TriedCollection items={tried} />
      </Section>
      <Groups
        groups={groupByMonth(all)}
        render={(e) => (
          <MyEventRow
            key={e.id}
            event={e}
            variant="history"
            status={
              e.isOrganizer
                ? { ...organizerStatus(e), meta: { label: 'Вы проводили', tone: 'off', icon: 'history' } }
                : participantStatus(e)
            }
            // С11, С15: повторить свою встречу; участнику — «Встреча состоялась?»
            action={
              e.isOrganizer ? (
                <CreateSimilarButton eventId={e.id} size="sm" />
              ) : e.my?.status === 'removed' ? (
                <Button
                  size="sm"
                  variant="quiet"
                  to="/events"
                  icon={<MagnifyingGlassIcon size={20} aria-hidden />}
                >
                  Найти другое занятие
                </Button>
              ) : (
                <HeldQuestion event={e} compact />
              )
            }
          />
        )}
      />
    </>
  );
}
