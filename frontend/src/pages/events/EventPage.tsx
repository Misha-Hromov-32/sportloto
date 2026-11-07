import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  CalendarBlankIcon,
  MapPinIcon,
  LockIcon,
  SealCheckIcon,
  SunIcon,
  UserIcon,
} from '@phosphor-icons/react';
import { useList, useOne, type CrudFilter } from '@refinedev/core';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import {
  Avatar,
  AvatarStack,
  Button,
  ChangeBanner,
  ErrorState,
  EventStateBanner,
  FirstStepPassport,
  GoneState,
  SkeletonBlock,
  SkeletonText,
  SportIcon,
} from '@/components';
import { API, useAction, useMe, type ApiError } from '@/lib/api';
import { cityOfPoint, defaultCity } from '@/lib/cities';
import { dayjs, dayLabel, formatDuration, formatEventDate, formatTimeRange } from '@/lib/dates';
import { formatDistance } from '@/lib/geo';
import { EVENT_LEVEL, EVENT_STATE, JOIN_MODE, ORG_TYPE, PARTICIPATION_STATUS } from '@/lib/labels';
import {
  cancelPolicyText,
  ONLINE_CANCEL_NOTE,
  ORGANIZER_CANCEL_NOTE,
  PAYMENT_NOTE_ONLINE,
  priceSummary,
} from '@/lib/money';
import { boxedImageAttrs, COVER_RATIO } from '@/lib/images';
import { count, WORDS } from '@/lib/plural';
import type { EventDetails, EventView } from '@/types/api';
import type { PlatformRule } from '@/types/domain';

import { EventPhotos } from './event/EventPhotos';
import { EventCountdown } from './event/EventCountdown';
import { Discussion } from './event/Discussion';
import { EventInventory } from './event/inventory/EventInventory'; // В3 + С7
import styles from './event/EventPage.module.css';
import { JoinBox, WhatNext } from './event/JoinBox';
// В7, С6, С10: состав, похожие встречи, серия
import { CompositionTag } from './event/participation/Composition';
import { PlanB } from './event/participation/PlanB';
import { RescheduleDecline } from './event/participation/RescheduleDecline';
import { SeriesBlock } from './event/participation/SeriesBlock';
import { placeTimeNote } from './event/time';
import { FeedCard, ModeTag, Tag } from './feed/FeedCard';
import { LazyEventMap } from './feed/LazyMap';
import { DESKTOP, useMediaQuery } from './feed/useMediaQuery';
import { EventVenueBlock } from './venues/EventVenueBlock'; // В4, Н1
import { NewcomerNote } from './manage/greeter/FirstVisit'; // С1, Н2
// С8, С15, Н5: избранное, «Встреча состоялась?», сохранённая карточка без сети; ссылка близкому
import { FavoriteButton } from '../me/favorites/FavoriteButton';
import { EventOffline } from '../me/offline/OfflinePanel';
import { HeldQuestion, ReliabilityNote } from '../orgs/managers/Reliability';
import { ShareWithClose } from '../share/ShareWithClose';
import { ImportedSource } from './event/imported/ImportedSource'; // В8
import { ReportEventButton } from './event/report/Report'; // С16
import { FamilyParticipation } from './event/company/Family';
import { familyLabel } from './event/company/labels';
import { TeamPanel } from './event/company/TeamPanel';
import { GatherAgain } from './event/company/GatherAgain';
import { InvitePanel } from './event/company/InvitePanel';
import { SportsPattern } from '../landing/parts/SportsPattern';

const ACTIVE = ['confirmed', 'pending', 'waitlist'];

/** Размеры обложки из EventPage.module.css; пропорции фото заранее неизвестны, поэтому без обрезки. */
const COVER_BOXES = [
  { media: '(max-width: 640px)', width: 307, height: 238 },
  { media: '(max-width: 1023px)', width: 281, height: 302 },
  { media: '(max-width: 1300px)', width: 430, height: 390 },
  { width: 486, height: 442 },
];

export default function EventPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const intent = params.get('intent') === 'join';
  const { me } = useMe();
  const navigate = useNavigate();

  const { result: event, query } = useOne<EventDetails>({
    resource: 'events',
    id,
    meta: { invite: params.get('invite') },
    queryOptions: { retry: false },
  });

  const status = event?.my?.status ?? null;
  const prevStatus = useRef<string | null | undefined>(undefined);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!event) return;
    if (prevStatus.current !== undefined && prevStatus.current !== status) setFlash(true);
    prevStatus.current = status;
  }, [event, status]);

  const clearIntent = () => {
    const p = new URLSearchParams(params);
    p.delete('intent');
    setParams(p, { replace: true });
  };
  // Кнопка в шапке карточки сразу открывает подтверждение записи у панели, а не только прокручивает к ней.
  const askJoin = () => {
    const p = new URLSearchParams(params);
    p.set('intent', 'join');
    if (me) setParams(p, { replace: true });
    else navigate(`/login?to=${encodeURIComponent(`/events/${id}?${p.toString()}`)}`);
  };

  if (query.isLoading) return <EventSkeleton />;

  if (query.isError || !event) {
    const error = query.error as ApiError | null;
    if (error?.code === 'event_deleted' || error?.statusCode === 410)
      return (
        <div className="container">
          <GoneState
            title="Событие удалено"
            actions={
              <Button variant="primary" to="/events">
                Найти другие события
              </Button>
            }
          >
            {error.message}
          </GoneState>
        </div>
      );
    if (error?.code === 'invite_required')
      return (
        <div className="container">
          <GoneState
            title="Встреча по приглашению"
            actions={
              <Button
                variant="primary"
                to={me ? '/events' : `/login?to=${encodeURIComponent(`/events/${id}?${params.toString()}`)}`}
              >
                {me ? 'К открытым встречам' : 'Войти и открыть приглашение'}
              </Button>
            }
          >
            {error.message} Попросите организатора прислать действующую ссылку.
          </GoneState>
        </div>
      );
    if (error?.statusCode === 404)
      return (
        <div className="container">
          <GoneState
            title="Такого события нет"
            actions={
              <Button variant="primary" to="/events">
                Найти событие
              </Button>
            }
          >
            Возможно, ссылка устарела или в ней опечатка. Посмотрите ближайшие события в поиске.
          </GoneState>
        </div>
      );
    return (
      <div className="container">
        <ErrorState layout="page" title="Не удалось открыть событие" onRetry={() => void query.refetch()}>
          Проверьте интернет и нажмите «Повторить».
        </ErrorState>
      </div>
    );
  }

  return (
    <EventContent
      key={event.id}
      event={event}
      intent={intent && Boolean(me)}
      onAskJoin={askJoin}
      onIntentDone={clearIntent}
      flash={flash}
    />
  );
}

function EventContent({
  event: e,
  intent,
  onAskJoin,
  onIntentDone,
  flash,
}: {
  event: EventDetails;
  intent: boolean;
  onAskJoin: () => void;
  onIntentDone: () => void;
  flash: boolean;
}) {
  const { run, isPending: acking } = useAction();
  const navigate = useNavigate();
  const desktop = useMediaQuery(DESKTOP);
  const { result: rule } = useOne<PlatformRule>({
    resource: 'rules',
    id: e.moderation?.ruleId ?? '',
    queryOptions: { enabled: Boolean(e.moderation?.ruleId) },
  });

  const open = e.state === 'upcoming' || e.state === 'live';
  const my = e.my;
  const active = Boolean(my && ACTIVE.includes(my.status));
  const price = priceSummary(e.price, e.counts.confirmed, e.minParticipants, e.paymentMode === 'online');
  const tz = placeTimeNote(e.startsAt, e.durationMin, e.place);
  const extra = e.sport.fields.filter((f) => e.extra[f.key]);
  const find = [e.place.landmark, e.firstStep.howToFind].filter(Boolean);
  const seeAll = e.isOrganizer || e.can.moderate || my?.status === 'confirmed';
  const statusText = my ? PARTICIPATION_STATUS[my.status].label : '';
  const joinAction =
    e.capacity !== null && e.counts.spotsLeft === 0 ? 'В лист ожидания' : JOIN_MODE[e.joinMode].action;

  const joinRef = useRef<HTMLDivElement>(null);
  const [joinVisible, setJoinVisible] = useState(true);
  useEffect(() => {
    const el = joinRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setJoinVisible(Boolean(entry?.isIntersecting)), {
      threshold: 0.1,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (intent) joinRef.current?.scrollIntoView({ block: 'center' });
  }, [intent]);
  const showBar = !desktop && !joinVisible && e.can.join && !e.isOrganizer && !active;

  const osm = `https://www.openstreetmap.org/?mlat=${e.place.lat}&mlon=${e.place.lng}#map=17/${e.place.lat}/${e.place.lng}`;

  return (
    <div className={['container', styles.page].join(' ')}>
      <p className="sr-only" aria-live="polite">
        {statusText ? `Статус записи: ${statusText}` : ''}
      </p>

      <Link to="/events" className={styles.back}>
        <ArrowLeftIcon size={20} aria-hidden />
        Все события
      </Link>

      {my?.status === 'confirmed' && <EventOffline eventId={e.id} />}

      {(e.state !== 'upcoming' || (active && e.changes.length > 0)) && (
        <div className={styles.banners}>
          <EventStateBanner
            state={e.state}
            cancelReason={e.cancelReason}
            moderation={e.moderation}
            rule={rule ?? null}
            isOrganizer={e.isOrganizer}
            hadParticipation={e.state === 'removed' ? my?.status === 'event_removed' : Boolean(my)}
            actions={
              e.state === 'past' || e.state === 'cancelled' ? (
                <Button variant="secondary" size="sm" to={`/events?sport=${e.sportId}`}>
                  Найти похожие события
                </Button>
              ) : e.state === 'removed' ? (
                <Button variant="quiet" size="sm" to="/rules">
                  Правила платформы
                </Button>
              ) : undefined
            }
          />
          {active && (
            <ChangeBanner
              changes={e.changes}
              unackedIds={my!.unackedChangeIds}
              onAcknowledge={() =>
                void run(API.ackChanges(e.id), {}, { success: 'Организатор увидит, что вы в курсе' })
              }
              acknowledging={acking}
              secondaryAction={
                <RescheduleDecline event={e} onDone={() => navigate({ hash: 'plan-b' }, { replace: true })} />
              }
            />
          )}
        </div>
      )}

      {/* С6: похожие встречи взамен отменённой или перенесённой */}
      <PlanB event={e} />

      <article className={styles.sheet}>
        <header className={styles.hero}>
          <SportsPattern />
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <div className={styles.tags}>
                <ModeTag mode={e.joinMode} />
                <Tag icon={<SportIcon sport={e.sport} size={16} />}>{e.sport.name}</Tag>
                <Tag>{EVENT_LEVEL[e.level]}</Tag>
                <CompositionTag composition={e.composition} />
                {e.visibility === 'invite' && <Tag>По приглашению</Tag>}
                {e.family && <Tag>{familyLabel(e.family)}</Tag>}
                {e.beginnersWelcome && (
                  <Tag icon={<SunIcon size={14} weight="fill" aria-hidden />}>Рады новичкам</Tag>
                )}
                {e.state !== 'upcoming' && (
                  <Tag tone={e.state === 'live' || e.state === 'removed' ? 'danger' : 'off'}>
                    {EVENT_STATE[e.state].label}
                  </Tag>
                )}
              </div>
              <h1 className={styles.title}>
                {e.title}
                <span>.</span>
              </h1>
              <div className={styles.heroMeta}>
                <p>
                  <CalendarBlankIcon size={19} aria-hidden />
                  <span>{formatEventDate(e.startsAt)}</span>
                  <EventCountdown event={e} />
                </p>
                <a href="#where">
                  <MapPinIcon size={19} aria-hidden />
                  <span>{addressWithCity(e)}</span>
                </a>
              </div>
              <div className={styles.heroPeople}>
                {e.seats.length > 0 && <AvatarStack people={e.seats} max={4} size={32} />}
                <span>
                  {e.counts.confirmed
                    ? count(e.counts.confirmed, WORDS.participant)
                    : 'Компания ещё собирается'}
                </span>
              </div>
              {open && (
                <div className={styles.heroActions}>
                  {e.isOrganizer ? (
                    <Button to={`/events/${e.id}/manage`} variant="primary">
                      Управлять встречей
                    </Button>
                  ) : active || !e.can.join ? (
                    <a
                      href="#join"
                      className={[styles.heroCta, active && styles.heroCtaQuiet].filter(Boolean).join(' ')}
                    >
                      {active ? statusText : joinAction}
                    </a>
                  ) : (
                    <button type="button" className={styles.heroCta} onClick={onAskJoin}>
                      {joinAction}
                    </button>
                  )}
                  <span className={styles.heroPrice}>{price.main}</span>
                  <FavoriteButton event={e} />
                </div>
              )}
            </div>
            <div className={styles.cover}>
              {e.coverUrl ? (
                <img
                  {...boxedImageAttrs(e.coverUrl, COVER_RATIO, COVER_BOXES, { crop: false })}
                  alt=""
                  fetchPriority="high"
                  decoding="async"
                />
              ) : (
                <span className={styles.coverFallback} aria-hidden>
                  <SportIcon sport={e.sport} size={96} weight="regular" />
                  <span>{e.sport.name}</span>
                </span>
              )}
              <time dateTime={e.startsAt} className={styles.coverDate}>
                <span>{dayjs(e.startsAt).format('D')}</span>
                <span>
                  {dayjs(e.startsAt).format('MMMM')}
                  <b>{dayjs(e.startsAt).format('HH:mm')}</b>
                </span>
              </time>
            </div>
          </div>
        </header>

        <div className={styles.content}>
          <div className={styles.main}>
            <section className={styles.about} aria-labelledby="event-about-title">
              <h2 id="event-about-title" className={styles.sectionTitle}>
                О встрече
              </h2>
              <p className={styles.desc}>{e.description}</p>
              {e.coverUrl?.includes('/media/calendar/') && <p>Обложка — тематическая иллюстрация.</p>}
            </section>

            <EventPhotos event={e} />
            <section id="where" className={styles.details} aria-labelledby="event-details-title">
              <h2 id="event-details-title" className={styles.sectionTitle}>
                Детали встречи
              </h2>
              <div className={styles.info}>
                <div>
                  <small>Когда</small>
                  <b>
                    {dayLabel(e.startsAt)}, {dayjs(e.startsAt).format('D MMMM')}
                  </b>
                  <b className="tabular">{formatTimeRange(e.startsAt, e.durationMin)}</b>
                  {tz && <span className={styles.sub}>{tz}</span>}
                </div>
                <div>
                  <small>Длительность</small>
                  <b>{formatDuration(e.durationMin)}</b>
                  {e.series && (
                    <span className={styles.sub}>
                      Каждую неделю до {dayjs(e.series.until).format('D MMMM')}
                    </span>
                  )}
                </div>
                <div className={styles.wide}>
                  <small>Где</small>
                  <b>{addressWithCity(e)}</b>
                  {(e.districtName || e.distanceKm !== null) && (
                    <span className={styles.sub}>
                      {[
                        e.districtName && `Район: ${e.districtName}`,
                        e.distanceKm !== null && `${formatDistance(e.distanceKm)} от вас`,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  )}
                </div>
                {find.length > 0 && (
                  <div className={styles.wide}>
                    <small>Как найти на месте</small>
                    <b>{find.join('. ')}</b>
                  </div>
                )}
                {e.firstStep.bring && (
                  <div className={styles.wide}>
                    <small>Что взять с собой</small>
                    <b>{e.firstStep.bring}</b>
                  </div>
                )}
                <div className={styles.wide}>
                  <small>Как записаться</small>
                  <b>{open ? JOIN_MODE[e.joinMode].label : 'Запись закрыта'}</b>
                  <span className={styles.sub}>
                    {open
                      ? JOIN_MODE[e.joinMode].hint
                      : `${EVENT_STATE[e.state].label}. Новые записи не принимаются.`}
                  </span>
                </div>
                <div>
                  <small>Цена</small>
                  <b>{price.main}</b>
                  {price.details.map((d) => (
                    <span key={d} className={styles.sub}>
                      {d}
                    </span>
                  ))}
                  {!price.free && (
                    <span className={styles.sub}>
                      {e.paymentMode === 'online' ? PAYMENT_NOTE_ONLINE : e.paymentNote || 'Оплата на месте, организатору'}
                    </span>
                  )}
                </div>
                <div>
                  <small>Отмена записи</small>
                  <b>{cancelPolicyText(e.cancelPolicy, e.startsAt)}</b>
                  {!price.free && <span className={styles.sub}>{ORGANIZER_CANCEL_NOTE}</span>}
                  {!price.free && e.paymentMode === 'online' && (
                    <span className={styles.sub}>{ONLINE_CANCEL_NOTE}</span>
                  )}
                </div>
                {extra.map((f) => (
                  <div key={f.key}>
                    <small>{f.label}</small>
                    <b>{e.extra[f.key]}</b>
                  </div>
                ))}
                {e.privateInfo ? (
                  <div className={[styles.wide, styles.private].join(' ')}>
                    <small>Только для участников</small>
                    <b>{e.privateInfo}</b>
                  </div>
                ) : (
                  e.state === 'upcoming' &&
                  !e.isOrganizer &&
                  e.hasPrivateInfo && (
                    <div className={[styles.wide, styles.locked].join(' ')}>
                      <small>
                        <LockIcon size={14} weight="bold" aria-hidden /> Только для участников
                      </small>
                      <b>Точка сбора и контакты организатора откроются, когда вы станете участником.</b>
                    </div>
                  )
                )}
              </div>
            </section>
            <div className={styles.map}>
              <LazyEventMap events={[e]} height={220} zoom={15} />
              <a href={osm} target="_blank" rel="noreferrer" className={styles.mapLink}>
                Открыть на карте
                <ArrowSquareOutIcon size={16} aria-hidden />
                <span className="sr-only">(в новой вкладке)</span>
              </a>
            </div>

            {/* В4, Н1: площадка и доступная среда */}
            <EventVenueBlock event={e} />

            {/* С1, Н2: кто встречает новичков, программа поддержки ветеранов */}
            <NewcomerNote event={e} />

            <FirstStepPassport
              level={e.level}
              beginnersWelcome={e.beginnersWelcome}
              firstStep={{ ...e.firstStep, bring: '', howToFind: '' }}
            />

            {/* В3 + С7: что нужно для игры */}
            <EventInventory eventId={e.id} orgId={e.organizer.kind === 'org' ? e.organizer.id : null} />

            <section className={styles.people} aria-labelledby="people-title">
              <h2 id="people-title" className={styles.sectionTitle}>
                Кто идёт
                <span className={styles.sectionCount}>
                  {e.capacity ? `${e.counts.confirmed} из ${e.capacity}` : e.counts.confirmed}
                </span>
              </h2>
              {e.counts.confirmed === 0 ? (
                <p className={styles.muted}>
                  {open ? 'Пока никто не записался. Можно стать первым.' : 'На событие никто не записался.'}
                </p>
              ) : (
                <>
                  <div className={styles.avatars}>
                    <AvatarStack
                      people={e.seats.map((p) => ({
                        name: p.name,
                        initials: p.initials,
                        avatarUrl: p.avatarUrl,
                      }))}
                      max={10}
                      size={40}
                    />
                    <span className={styles.muted}>{count(e.counts.confirmed, WORDS.participant)}</span>
                  </div>
                  {seeAll ? (
                    <details className={styles.names}>
                      <summary>Показать всех участников</summary>
                      <ul>
                        {e.participants.map((p) => (
                          <li key={p.id}>
                            <Avatar name={p.name} initials={p.initials} src={p.avatarUrl} size={32} />
                            {p.name}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <p className={styles.muted}>Полный список видят участники и организатор.</p>
                  )}
                </>
              )}
              {(e.counts.pending > 0 || e.counts.waitlist > 0) && (
                <p className={styles.muted}>
                  {[
                    e.counts.pending > 0 && `Ждут решения: ${count(e.counts.pending, WORDS.application)}`,
                    e.counts.waitlist > 0 && `В листе ожидания: ${count(e.counts.waitlist, WORDS.person)}`,
                  ]
                    .filter(Boolean)
                    .join('. ')}
                </p>
              )}
            </section>

            <OrganizerCard event={e} />
            {/* В8, С16: источник из сообщества и жалоба на событие */}
            <ImportedSource eventId={e.id} />
            <ReportEventButton event={e} />

            {!open && <MoreFromOrganizer event={e} />}
          </div>

          <aside className={styles.side}>
            {(e.heldCheck?.canAnswer || e.heldCheck?.answer) && (
              <div className={styles.nextWrap}>
                <HeldQuestion event={e} />
              </div>
            )}
            <div ref={joinRef} id="join" className={styles.joinWrap}>
              <div className={styles.bookingHead}>
                <span className={styles.priceLabel}>Стоимость участия</span>
                <strong>{price.main}</strong>
                <p>
                  <CalendarBlankIcon size={17} aria-hidden />
                  {formatEventDate(e.startsAt)}
                </p>
              </div>
              <JoinBox event={e} intent={intent} onIntentDone={onIntentDone} flash={flash} />
            </div>
            <FamilyParticipation event={e} />
            <TeamPanel event={e} />
            <GatherAgain event={e} />
            <InvitePanel event={e} />
            <SeriesBlock event={e} className={styles.nextWrap} />
            {my?.status === 'confirmed' && open && (
              <div className={styles.nextWrap}>
                <WhatNext event={e} />
              </div>
            )}
            {my?.status === 'confirmed' && open && (
              <div className={styles.nextWrap}>
                <ShareWithClose event={e} />
              </div>
            )}
            <div className={styles.chatWrap}>
              <Discussion event={e} />
            </div>
          </aside>
        </div>
      </article>

      {showBar && (
        <div className={styles.bar}>
          <div className={styles.barText}>
            <b>{price.free ? 'Бесплатно' : price.main}</b>
            <span>{formatEventDate(e.startsAt)}</span>
          </div>
          <Button variant="primary" onClick={onAskJoin}>
            {joinAction}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Город — по точке на карте; без точки районы демо-данных относятся к городу по умолчанию. */
function addressWithCity(e: EventView): string {
  const city = cityOfPoint(e.place) ?? (e.districtName ? defaultCity() : null);
  if (!city || e.place.address.includes(city.name)) return e.place.address;
  return `${e.place.address}, ${city.name}`;
}

function OrganizerCard({ event: e }: { event: EventView }) {
  const o = e.organizerView;
  const facts =
    o.facts.held === 0 && o.facts.cancelled === 0
      ? 'Первая встреча этого организатора на платформе'
      : `Проведено встреч: ${o.facts.held}, отменено: ${o.facts.cancelled}`;
  return (
    <section className={styles.org} aria-label="Организатор">
      <Avatar name={o.name} src={o.avatarUrl} size={48} shape={o.kind === 'org' ? 'org' : 'person'} />
      <div className={styles.orgBody}>
        <small className={styles.orgCaption}>Организатор</small>
        <Link to={o.link} className={styles.orgName}>
          {o.name}
        </Link>
        {o.verified ? (
          <span className={styles.verified}>
            <SealCheckIcon size={18} weight="fill" aria-hidden />
            Организация проверена
            {o.orgType && <span className={styles.orgType}>{ORG_TYPE[o.orgType]}</span>}
          </span>
        ) : (
          <span className={styles.privateOrg}>
            <UserIcon size={18} aria-hidden />
            Встреча частного лица
          </span>
        )}
        <span className={styles.facts}>
          {facts}
          {o.facts.upcoming > 0 && `. Запланировано: ${o.facts.upcoming}`}
        </span>
        <ReliabilityNote facts={o.facts} />
      </div>
    </section>
  );
}

/** Для прошедшего, отменённого и снятого события — что ещё есть у этого организатора. */
function MoreFromOrganizer({ event: e }: { event: EventView }) {
  const filters: CrudFilter[] =
    e.organizer.kind === 'org'
      ? [
          { field: 'scope', operator: 'eq', value: 'org' },
          { field: 'orgId', operator: 'eq', value: e.organizer.id },
        ]
      : [
          { field: 'scope', operator: 'eq', value: 'user' },
          { field: 'organizerUserId', operator: 'eq', value: e.organizer.id },
        ];
  const { result } = useList<EventView>({ resource: 'events', filters, pagination: { mode: 'off' } });
  const next = (result.data ?? []).filter((x) => x.id !== e.id && x.state === 'upcoming').slice(0, 2);
  if (!next.length) return null;
  return (
    <section className={styles.more} aria-labelledby="more-title">
      <h2 id="more-title" className={styles.sectionTitle}>
        Ещё у организатора
      </h2>
      <div className={styles.moreGrid}>
        {next.map((x) => (
          <FeedCard key={x.id} event={x} />
        ))}
      </div>
    </section>
  );
}

function EventSkeleton() {
  return (
    <div className={['container', styles.page].join(' ')} role="status" aria-live="polite">
      <span className="sr-only">Загружаем событие…</span>
      <SkeletonBlock width={140} height={20} style={{ marginBottom: 24 }} />
      <SkeletonBlock height={240} radius="media" />
      <div className={styles.skelGrid}>
        <div className={styles.skelCol}>
          <SkeletonBlock width={260} height={28} radius="pill" />
          <SkeletonBlock width="80%" height={40} />
          <SkeletonText lines={3} />
          <div className={styles.info}>
            <SkeletonBlock height={72} />
            <SkeletonBlock height={72} />
          </div>
        </div>
        <div className={styles.skelCol}>
          <SkeletonBlock height={200} radius="media" />
          <SkeletonBlock height={160} radius="media" />
        </div>
      </div>
    </div>
  );
}
