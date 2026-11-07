import { CalendarBlankIcon, MapPinIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { Avatar, Button, SkeletonBlock, SportIcon } from '@/components';
import { formatEventDate } from '@/lib/dates';
import { boxedImageAttrs, COVER_RATIO } from '@/lib/images';
import type { EventView, Identity } from '@/types/api';

import type { MyTab } from './groups';
import styles from './CabinetOverview.module.css';

const NEXT_BOXES = [
  { media: '(max-width: 639px)', width: 310, height: 176 },
  { width: 300, height: 313 },
];

export function CabinetOverview({
  me,
  upcoming,
  organizing,
  waiting,
  loading,
  onTab,
}: {
  me: Identity;
  upcoming: EventView[];
  organizing: EventView[];
  waiting: number;
  loading: boolean;
  onTab: (tab: MyTab) => void;
}) {
  const meetings = [
    ...new Map(
      [...upcoming, ...organizing]
        .filter((event) => event.state === 'upcoming' || event.state === 'live')
        .map((event) => [event.id, event]),
    ).values(),
  ];
  const next = meetings.sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const stats = [
    {
      // Только встречи, которые действительно состоятся: отменённые и снятые видны во вкладке, но не считаются.
      label: 'Предстоящие занятия',
      value: upcoming.filter(
        (event) => event.my?.status === 'confirmed' && (event.state === 'upcoming' || event.state === 'live'),
      ).length,
      tab: 'upcoming' as const,
    },
    {
      label: 'Организую встречи',
      value: organizing.filter((event) => event.state === 'upcoming' || event.state === 'live').length,
      tab: 'organizing' as const,
    },
    { label: 'Заявки ждут решения', value: waiting, tab: 'organizing' as const },
  ];
  return (
    <>
      <div className={styles.stats} aria-label="Сводка">
        {stats.map((stat) => (
          <button key={stat.label} type="button" onClick={() => onTab(stat.tab)} className={styles.stat}>
            <span>{stat.label}</span>
            <strong>{loading ? '—' : stat.value}</strong>
          </button>
        ))}
      </div>
      <div className={styles.overview}>
        <section className={styles.next} aria-labelledby="cabinet-next-title">
          {loading ? (
            <SkeletonBlock height={232} />
          ) : next ? (
            <>
              <div className={styles.media}>
                {next.coverUrl ? (
                  <img
                    {...boxedImageAttrs(next.coverUrl, COVER_RATIO, NEXT_BOXES, { crop: false })}
                    alt=""
                    decoding="async"
                  />
                ) : (
                  <SportIcon sport={next.sport} size={64} aria-hidden />
                )}
                <span>{next.sport.name}</span>
              </div>
              <div className={styles.nextBody}>
                <p className={styles.eyebrow}>
                  {next.isOrganizer ? 'Ближайшая встреча, вы организатор' : 'Ваша ближайшая встреча'}
                </p>
                <h2 id="cabinet-next-title">{next.title}</h2>
                <p className={styles.date}>
                  <CalendarBlankIcon size={18} aria-hidden />
                  {formatEventDate(next.startsAt)}
                </p>
                <p className={styles.place}>
                  <MapPinIcon size={18} aria-hidden />
                  {next.place.address}
                </p>
                <Button
                  to={'/events/' + next.id + (next.isOrganizer ? '/manage' : '')}
                  variant="secondary"
                  size="sm"
                >
                  {next.isOrganizer ? 'Управлять встречей' : 'Открыть встречу'}
                </Button>
              </div>
            </>
          ) : (
            <div className={styles.welcome}>
              <div>
                <h2 id="cabinet-next-title">Вы пока никуда не записаны</h2>
                <p>Найдите занятие в каталоге или создайте свою встречу. Записи и заявки появятся здесь.</p>
              </div>
              <Button to="/events" variant="primary" size="sm">
                Найти встречу
              </Button>
            </div>
          )}
        </section>
        <aside className={styles.profile} aria-label="Ваш профиль">
          <div className={styles.identity}>
            <Avatar name={me.name} initials={me.initials} src={me.avatarUrl} size={48} />
            <div>
              <b>{me.name}</b>
              <span>{me.city}</span>
            </div>
            <Link to={'/profile/' + me.id} className={styles.edit} aria-label="Открыть мой профиль">
              <PencilSimpleIcon size={20} aria-hidden />
            </Link>
          </div>
          <div className={styles.interests}>
            {me.interests.length ? (
              me.interests.slice(0, 3).map((sport) => (
                <span key={sport.id}>
                  <SportIcon sport={sport} size={16} aria-hidden />
                  {sport.name}
                </span>
              ))
            ) : (
              <p>Добавьте интересы в профиль, и подходящие занятия будут в ленте первыми.</p>
            )}
          </div>
          <Link className={styles.profileLink} to={'/profile/' + me.id}>
            Мой профиль
          </Link>
          <Link className={styles.profileLink} to="/companions">
            Найти партнёра
          </Link>
          <Link className={styles.profileLink} to="/inventory?tab=mine">
            Моя полка инвентаря
          </Link>
        </aside>
      </div>
    </>
  );
}
