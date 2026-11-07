import {
  ArrowLeftIcon,
  BuildingsIcon,
  CalendarBlankIcon,
  CalendarPlusIcon,
  GearSixIcon,
  HandWavingIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  MegaphoneSimpleIcon,
  PencilSimpleIcon,
  PlusIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { useList, useOne } from '@refinedev/core';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  GoneState,
  PageSkeleton,
  PriceInfo,
  SportIcon,
  StatusBadge,
} from '@/components';
import { useMe, type ApiError } from '@/lib/api';
import { formatShortDate, formatTime } from '@/lib/dates';
import { READINESS } from '@/lib/labels';
import { boxedImageAttrs, COVER_RATIO, imageAttrs } from '@/lib/images';
import { count, WORDS } from '@/lib/plural';
import type { EventView, UserView } from '@/types/api';
import type { OrgStatus } from '@/types/domain';

import { SportsPattern } from '../landing/parts/SportsPattern';
import { collectTried } from '../me/parts/groups';
import { TriedCollection } from '../me/parts/TriedCollection';
import { AdminStopList } from './parts/AdminStopList';
import { LEVEL_WORDS } from './parts/levels';
import { ProfileEditForm } from './parts/ProfileEditForm';
import styles from './ProfilePage.module.css';
import { FollowButton } from '@/components/FollowButton';

const YEAR_WORDS = ['год', 'года', 'лет'] as const;

const SPORT_BOXES = [
  { media: '(max-width: 639px)', width: 330, height: 192 },
  { media: '(max-width: 1023px)', width: 263, height: 256 },
  { media: '(max-width: 1599px)', width: 363, height: 281 },
  { width: 400, height: 320 },
];

/** Блок фиксированной высоты, картинка растягивается по ширине: фото не обрезаем. */
const EVENT_IMAGE = {
  width: 360,
  height: 240,
  crop: false,
  sizes: '(max-width: 639px) calc(100vw - 48px), 360px',
  widths: [320, 360, 480, 640, 720],
};

export default function ProfilePage() {
  const { id = '' } = useParams();
  const { me, role } = useMe();
  const isMe = me?.id === id;
  const adminView = role === 'admin' && !isMe;
  const [editing, setEditing] = useState(false);
  const [expandedEventsFor, setExpandedEventsFor] = useState<string | null>(null);

  useEffect(() => {
    if (editing) document.getElementById('edit-profile-title')?.focus();
  }, [editing]);

  const { result: user, query } = useOne<UserView>({ resource: 'users', id, liveMode: 'auto' });
  const organized = useList<EventView>({
    resource: 'events',
    filters: [
      { field: 'scope', operator: 'eq', value: 'user' },
      { field: 'organizerUserId', operator: 'eq', value: id },
    ],
    pagination: { mode: 'off' },
    liveMode: 'auto',
  });
  const participating = useList<EventView>({
    resource: 'events',
    filters: [{ field: 'scope', operator: 'eq', value: 'participating' }],
    pagination: { mode: 'off' },
    liveMode: 'auto',
    queryOptions: { enabled: isMe },
  });

  if (query.isLoading) {
    return (
      <div className="container">
        <PageSkeleton label="Загружаем профиль…" />
      </div>
    );
  }
  if (query.isError || !user) {
    const code = (query.error as ApiError | null)?.code;
    return (
      <div className="container">
        {code === 'not_found' ? (
          <GoneState
            title="Профиль недоступен"
            actions={
              <Button variant="secondary" to="/events">
                Перейти к событиям
              </Button>
            }
          >
            Такого профиля нет или он закрыт.
          </GoneState>
        ) : (
          <ErrorState layout="page" onRetry={() => void query.refetch()}>
            Не удалось загрузить профиль. Проверьте интернет и нажмите «Повторить».
          </ErrorState>
        )}
      </div>
    );
  }

  const upcoming = organized.result.data
    .filter((e) => e.state === 'upcoming' || e.state === 'live')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const pastOwn = organized.result.data.filter((e) => e.state === 'past');
  const tried = isMe
    ? collectTried([
        ...participating.result.data.filter((e) => e.state === 'past' && e.my?.status === 'confirmed'),
        ...pastOwn,
      ])
    : [];
  const { facts } = user;
  const place = [user.city, user.districtName].filter(Boolean).join(', ');
  const firstSport = user.interests[0];
  const coverEvent =
    [...upcoming, ...pastOwn].find((e) => e.coverUrl && e.sport.id === firstSport?.id) ??
    [...upcoming, ...pastOwn].find((e) => e.coverUrl);
  const cover = coverEvent?.coverUrl;
  const coverSport = coverEvent?.sport ?? firstSport;

  return (
    <div className={styles.page}>
      <section className={styles.hero} id="profile-top" aria-labelledby="profile-name">
        <SportsPattern />
        <div className={styles.container}>
          <div className={styles.heroTop}>
            <span className={styles.eyebrow}>{isMe ? 'Ваш профиль' : 'Профиль участника'}</span>
            {isMe && (
              <Link className={styles.settingsLink} to="/settings">
                <GearSixIcon size={18} aria-hidden />
                Настройки
              </Link>
            )}
          </div>

          <div className={styles.heroGrid}>
            <div className={styles.heroText}>
              <div className={styles.identity}>
                <Avatar name={user.name} initials={user.initials} src={user.avatarUrl} size={48} />
                <p className={styles.meta}>
                  <MapPinIcon size={16} aria-hidden />
                  {[place, user.age ? count(user.age, YEAR_WORDS) : null].filter(Boolean).join(', ') ||
                    'Город не указан'}
                </p>
              </div>
              <h1 id="profile-name" className={styles.name}>
                {user.name}
                <span>.</span>
              </h1>
              {user.about ? (
                <div className={styles.about}>
                  <span className={styles.aboutLabel}>О себе</span>
                  <p>{user.about}</p>
                </div>
              ) : isMe ? (
                <p className={styles.intro}>
                  Добавьте пару слов о себе: чем любите заниматься и как давно. Это увидят организаторы и
                  участники встреч.
                </p>
              ) : (
                <p className={styles.intro}>Участник пока ничего не рассказал о себе.</p>
              )}
              {isMe ? (
                <div className={styles.heroActions}>
                  <Button variant="primary" to="/events" icon={<MagnifyingGlassIcon size={20} aria-hidden />}>
                    Найти встречу
                  </Button>
                  {!editing && (
                    <Button
                      variant="secondary"
                      icon={<PencilSimpleIcon size={18} aria-hidden />}
                      onClick={() => setEditing(true)}
                    >
                      Изменить профиль
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <FollowButton kind="user" id={id} />
                  <a className={styles.textLink} href="#profile-events">
                    Посмотреть встречи
                  </a>
                </>
              )}
            </div>

            <div className={styles.sportCard}>
              <div className={styles.sportVisual}>
                {cover ? (
                  <img
                    {...boxedImageAttrs(cover, COVER_RATIO, SPORT_BOXES, { crop: false })}
                    alt=""
                    decoding="async"
                  />
                ) : (
                  <div className={styles.sportPlaceholder}>
                    {firstSport ? (
                      <SportIcon sport={firstSport} size={144} weight="regular" />
                    ) : (
                      <UsersThreeIcon size={144} weight="thin" aria-hidden />
                    )}
                  </div>
                )}
                {coverSport && <span className={styles.sportTag}>{coverSport.name}</span>}
              </div>
              <div className={styles.readiness}>
                <span className={styles.readinessIcon}>
                  {user.readiness === 'organize' ? (
                    <MegaphoneSimpleIcon size={25} aria-hidden />
                  ) : (
                    <HandWavingIcon size={25} aria-hidden />
                  )}
                </span>
                <div>
                  <strong>
                    {user.readiness ? READINESS[user.readiness].label : 'Готовность не указана'}
                  </strong>
                  <p>
                    {user.readiness
                      ? READINESS[user.readiness].hint
                      : isMe
                        ? 'Отметьте в профиле, хотите ли вы присоединиться к встрече или собрать свою'
                        : 'Можно позвать на встречу или написать в обсуждении события'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <dl className={styles.stats} aria-label="Встречи в цифрах">
            <div>
              <dt>встреч организовано</dt>
              <dd>{facts.held.toLocaleString('ru-RU')}</dd>
            </div>
            <div>
              <dt>встреч как участник</dt>
              <dd>{facts.attended.toLocaleString('ru-RU')}</dd>
            </div>
            <div>
              <dt>направлений попробовано</dt>
              <dd>{facts.sportsTried.toLocaleString('ru-RU')}</dd>
            </div>
            <div>
              <dt>предстоящих встреч организатора</dt>
              <dd>{facts.upcoming.toLocaleString('ru-RU')}</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className={styles.container}>
        {isMe && editing ? (
          <nav className={styles.navigation} aria-label="Редактирование профиля">
            <button className={styles.editLink} onClick={() => setEditing(false)}>
              <ArrowLeftIcon size={18} aria-hidden />
              Вернуться к профилю
            </button>
          </nav>
        ) : (
          <nav className={styles.navigation} aria-label="Разделы профиля">
            <a href="#profile-interests">
              Интересы<span>{user.interests.length}</span>
            </a>
            <a href="#profile-events">
              {isMe ? 'Мои встречи' : 'Встречи'}
              <span>{upcoming.length}</span>
            </a>
            <a href="#profile-tried">Попробовано</a>
            {isMe && (
              <Link to="/me" className={styles.cabinetLink}>
                Календарь занятий
              </Link>
            )}
            {isMe && me?.role !== 'admin' && (
              <Link to="/inventory?tab=mine" className={styles.cabinetLink}>
                Моя полка
              </Link>
            )}
          </nav>
        )}

        {isMe && editing && me ? (
          <section className={styles.editPanel} aria-labelledby="edit-profile-title">
            <div className={styles.sectionHead}>
              <h2 id="edit-profile-title" tabIndex={-1}>
                Изменить профиль
              </h2>
            </div>
            <p className={styles.sectionIntro}>Расскажите о себе и выберите, чем любите заниматься.</p>
            <ProfileEditForm me={me} onDone={() => setEditing(false)} />
          </section>
        ) : (
          <div className={styles.layout}>
            <div className={styles.main}>
              {adminView && <AdminStopList userId={user.id} />}
              <section id="profile-interests" aria-labelledby="interests-title">
                <header className={styles.sectionHead}>
                  <h2 id="interests-title">{isMe ? 'Мой спорт' : 'Спортивные интересы'}</h2>
                  {isMe && (
                    <button className={styles.editLink} onClick={() => setEditing(true)}>
                      <PencilSimpleIcon size={18} aria-hidden />
                      Изменить
                    </button>
                  )}
                </header>
                {user.interests.length ? (
                  <ul className={styles.interests}>
                    {user.interests.map((sport) => {
                      const level = user.levels[sport.id];
                      return (
                        <li key={sport.id} className={styles.interest}>
                          <span className={styles.interestIcon}>
                            <SportIcon sport={sport} size={34} weight="regular" />
                          </span>
                          <span className={styles.interestName}>{sport.name}</span>
                          <span className={styles.level}>
                            {level ? LEVEL_WORDS[level].label : 'Уровень не указан'}
                          </span>
                          {level && <span className={styles.levelHint}>{LEVEL_WORDS[level].hint}</span>}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className={styles.emptyPanel}>
                    <p className={styles.muted}>
                      {isMe
                        ? 'Добавьте направления, и подходящие занятия будут в ленте первыми.'
                        : 'Спортивные интересы пока не указаны.'}
                    </p>
                    {isMe && (
                      <Button
                        variant="secondary"
                        onClick={() => setEditing(true)}
                        icon={<PlusIcon size={18} aria-hidden />}
                      >
                        Добавить интересы
                      </Button>
                    )}
                  </div>
                )}
              </section>

              <section id="profile-events" aria-labelledby="events-title">
                <header className={styles.sectionHead}>
                  <h2 id="events-title">
                    {isMe ? 'Вы организуете' : 'Ближайшие встречи'}
                    <span className={styles.headingCount}>{upcoming.length}</span>
                  </h2>
                  {isMe && (
                    <Link className={styles.textLink} to="/events/new">
                      <PlusIcon size={18} aria-hidden />
                      Создать
                    </Link>
                  )}
                </header>
                {organized.query.isLoading ? (
                  <PageSkeleton label="Загружаем встречи…" />
                ) : organized.query.isError ? (
                  <ErrorState onRetry={() => void organized.query.refetch()}>
                    Не удалось загрузить события. Нажмите «Повторить».
                  </ErrorState>
                ) : upcoming.length ? (
                  <>
                    <div className={styles.events}>
                      {(expandedEventsFor === id ? upcoming : upcoming.slice(0, 4)).map((event) => (
                        <ProfileEventCard key={event.id} event={event} isMe={isMe} />
                      ))}
                    </div>
                    {upcoming.length > 4 && (
                      <Button
                        variant="secondary"
                        className={styles.showEvents}
                        aria-expanded={expandedEventsFor === id}
                        onClick={() => setExpandedEventsFor(expandedEventsFor === id ? null : id)}
                      >
                        {expandedEventsFor === id ? 'Свернуть' : `Все встречи (${upcoming.length})`}
                      </Button>
                    )}
                  </>
                ) : (
                  <div className={styles.emptyPanel}>
                    <EmptyState
                      title={isMe ? 'Вы пока не проводите встреч' : 'Открытых встреч нет'}
                      icon={<CalendarPlusIcon size={32} aria-hidden />}
                      actions={
                        isMe ? (
                          <Button
                            variant="primary"
                            to="/events/new"
                            icon={<PlusIcon size={18} aria-hidden />}
                          >
                            Создать встречу
                          </Button>
                        ) : undefined
                      }
                    >
                      {isMe
                        ? 'Выберите вид спорта, место и время, и встреча появится в каталоге.'
                        : `Сейчас ${user.name.split(' ')[0]} не проводит открытых встреч.`}
                    </EmptyState>
                  </div>
                )}
              </section>

              <section id="profile-tried" className={styles.triedSection} aria-labelledby="tried-title">
                <header className={styles.sectionHead}>
                  <h2 id="tried-title">
                    Попробовано<span className={styles.headingCount}>{facts.sportsTried}</span>
                  </h2>
                </header>
                {isMe && participating.query.isError ? (
                  <ErrorState onRetry={() => void participating.query.refetch()}>
                    Не удалось загрузить историю занятий.
                  </ErrorState>
                ) : isMe && participating.query.isLoading ? (
                  <p className={styles.muted}>Загружаем историю занятий…</p>
                ) : isMe && tried.length ? (
                  <TriedCollection items={tried} />
                ) : (
                  <p className={styles.muted}>
                    {facts.sportsTried
                      ? `На встречах сервиса: ${count(facts.sportsTried, WORDS.sport)}, ${count(facts.attended, WORDS.meeting)} как участник.`
                      : isMe
                        ? 'После первого занятия здесь появятся виды спорта, которые вы попробовали.'
                        : 'Прошедших занятий пока нет.'}
                  </p>
                )}
              </section>
            </div>

            <aside className={styles.side}>
              <section className={styles.invite} aria-labelledby="invite-title">
                <h2 id="invite-title">{isMe ? 'Соберите свою встречу' : 'Найдите занятие рядом'}</h2>
                <p>
                  {isMe
                    ? 'Укажите вид спорта, место и время. Записаться смогут все, кто ищет компанию.'
                    : 'В каталоге можно выбрать вид спорта, день и район.'}
                </p>
                <Button
                  variant="primary"
                  to={isMe ? '/events/new' : '/events'}
                  icon={
                    isMe ? <PlusIcon size={20} aria-hidden /> : <MagnifyingGlassIcon size={20} aria-hidden />
                  }
                >
                  {isMe ? 'Создать встречу' : 'Найти встречу'}
                </Button>
              </section>

              <section className={styles.facts} aria-labelledby="facts-title">
                <h2 id="facts-title">Как организатор</h2>
                <dl className={styles.factsList}>
                  <div>
                    <dt>
                      <span className={styles.statusDot} />
                      Встреч проведено
                    </dt>
                    <dd>{facts.held}</dd>
                  </div>
                  <div>
                    <dt>
                      <span className={styles.upcomingDot} />
                      Впереди
                    </dt>
                    <dd>{facts.upcoming}</dd>
                  </div>
                  <div>
                    <dt>
                      <span className={styles.cancelledDot} />
                      Отменено
                    </dt>
                    <dd>{facts.cancelled}</dd>
                  </div>
                </dl>
                <p className={styles.factsNote}>
                  {facts.held === 0 && facts.cancelled === 0
                    ? 'Встреч пока не было.'
                    : 'По всем встречам в сервисе'}
                </p>
              </section>

              {isMe && me && me.role !== 'admin' && (
                <section className={styles.orgs} aria-labelledby="orgs-title">
                  <BuildingsIcon size={26} aria-hidden />
                  <h2 id="orgs-title">Мои организации</h2>
                  {me.orgs.length ? (
                    <ul className={styles.orgList}>
                      {me.orgs.map((org) => (
                        <li key={org.id}>
                          <Link to={`/org/${org.id}`} className={styles.orgLink}>
                            <span className={styles.orgName}>{org.name}</span>
                            <StatusBadge kind="org" status={org.status as OrgStatus} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.muted}>
                      Если вы клуб, секция или тренер, встречи можно проводить от имени организации.
                    </p>
                  )}
                  <Link className={styles.textLink} to="/org/new">
                    Зарегистрировать организацию
                  </Link>
                </section>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileEventCard({ event, isMe }: { event: EventView; isMe: boolean }) {
  return (
    <article className={styles.eventCard}>
      <Link to={isMe ? `/events/${event.id}/manage` : `/events/${event.id}`} className={styles.eventLink}>
        <div className={styles.eventMedia}>
          {event.coverUrl ? (
            <img {...imageAttrs(event.coverUrl, EVENT_IMAGE)} alt="" loading="lazy" decoding="async" />
          ) : (
            <SportIcon sport={event.sport} size={64} weight="regular" />
          )}
          <span className={styles.eventSport}>
            <SportIcon sport={event.sport} size={15} />
            {event.sport.name}
          </span>
          {event.state === 'live' && <span className={styles.liveBadge}>Уже идёт</span>}
        </div>
        <div className={styles.eventBody}>
          <time dateTime={event.startsAt} className={styles.eventDate}>
            <CalendarBlankIcon size={17} aria-hidden />
            {formatShortDate(event.startsAt)}
            <span>{formatTime(event.startsAt)}</span>
          </time>
          <h3>{event.title}</h3>
          <p className={styles.eventPlace}>
            <MapPinIcon size={16} aria-hidden />
            <span>{event.place.address}</span>
          </p>
          <div className={styles.eventDetails}>
            <PriceInfo
              compact
              price={event.price}
              confirmed={event.counts.confirmed}
              minParticipants={event.minParticipants}
            />
            <span>
              {event.counts.spotsLeft === 0
                ? 'Мест нет'
                : event.counts.spotsLeft === null
                  ? event.joinMode === 'open'
                    ? 'Свободная запись'
                    : 'По заявке'
                  : `Ещё ${count(event.counts.spotsLeft, WORDS.place)}`}
            </span>
          </div>
          <div className={styles.eventFoot}>
            <span>
              <UsersThreeIcon size={17} aria-hidden />
              {count(event.counts.confirmed, WORDS.participant)}
            </span>
            <span className={styles.eventAction}>{isMe ? 'Управлять' : 'Открыть встречу'}</span>
          </div>
        </div>
      </Link>
    </article>
  );
}
