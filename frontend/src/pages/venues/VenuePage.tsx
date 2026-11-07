import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  EnvelopeSimpleIcon,
  EyeSlashIcon,
  GearIcon,
  GlobeIcon,
  PhoneIcon,
  PlusIcon,
  SealCheckIcon,
} from '@phosphor-icons/react';
import { useList, useOne } from '@refinedev/core';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { Button, ErrorState, GoneState, PageSkeleton, SportIcon } from '@/components';
import { useLiveRefetch, useMe, type ApiError } from '@/lib/api';
import { boxedImageAttrs, COVER_RATIO } from '@/lib/images';
import { updatedLabel, venuePriceLine } from '@/lib/venues';
import type { EventView, VenueDetails } from '@/types/api';

import { FeedCard } from '../events/feed/FeedCard';
import { FeatureList, FeatureTags } from './parts/features';
import { LazyVenueMap } from './parts/LazyVenueMap';
import { DayPicker, SlotList } from './parts/Schedule';
import { proposeLink } from './parts/links';
import styles from './VenuePage.module.css';
import { SportsPattern } from '../landing/parts/SportsPattern';

/** Размеры фото из VenuePage.module.css; пропорции снимка заранее неизвестны, поэтому без обрезки. */
const PHOTO_BOXES = [
  { media: '(max-width: 640px)', width: 343, height: 256 },
  { media: '(max-width: 900px)', width: 664, height: 336 },
  { media: '(max-width: 1300px)', width: 453, height: 504 },
  { width: 516, height: 555 },
];

export default function VenuePage() {
  const { id = '' } = useParams();
  const { result: venue, query } = useOne<VenueDetails>({
    resource: 'venues',
    id,
    errorNotification: false,
    queryOptions: { retry: false },
  });
  useLiveRefetch(['venues', 'events'], () => void query.refetch());

  if (query.isLoading)
    return (
      <div className="container">
        <PageSkeleton label="Загружаем площадку…" />
      </div>
    );

  if (query.isError || !venue) {
    const error = query.error as ApiError | null;
    if (error?.statusCode === 404)
      return (
        <div className="container">
          <GoneState
            title="Площадка недоступна"
            actions={
              <Button variant="primary" to="/events?view=venues">
                Посмотреть другие площадки
              </Button>
            }
          >
            {error.message || 'Возможно, ссылка устарела. Посмотрите другие площадки рядом.'}
          </GoneState>
        </div>
      );
    return (
      <div className="container">
        <ErrorState layout="page" title="Не удалось открыть площадку" onRetry={() => void query.refetch()}>
          Проверьте интернет и нажмите «Повторить».
        </ErrorState>
      </div>
    );
  }

  return <VenueContent venue={venue} />;
}

function VenueContent({ venue: v }: { venue: VenueDetails }) {
  const { me } = useMe();
  const firstFree = v.days.find((d) => d.freeCount > 0)?.date ?? v.days[0]?.date ?? '';
  const [date, setDate] = useState(firstFree);
  const day = v.days.find((d) => d.date === date);
  const osm = `https://www.openstreetmap.org/?mlat=${v.lat}&mlon=${v.lng}#map=17/${v.lat}/${v.lng}`;
  const toCreate = (link: string) => (me ? link : `/login?to=${encodeURIComponent(link)}`);
  const sportId = v.sports.length === 1 ? v.sports[0]!.id : undefined;
  const canPropose = !me || me.role !== 'admin';

  const events = useList<EventView>({
    resource: 'events',
    filters: [{ field: 'venueId', operator: 'eq', value: v.id }],
    pagination: { mode: 'off' },
  });
  const upcoming = (events.result.data ?? []).filter((e) => e.state === 'upcoming' || e.state === 'live');

  return (
    <div className={['container', styles.page].join(' ')}>
      <Link to="/events?view=venues" className={styles.back}>
        <ArrowLeftIcon size={20} aria-hidden />
        Все площадки
      </Link>

      {v.isOwner && (
        <div className={styles.owner} role="status">
          <p>
            {v.status === 'hidden' ? (
              <>
                <EyeSlashIcon size={20} aria-hidden /> Площадка скрыта: в поиске её не видно. Открыть её снова
                можно в кабинете.
              </>
            ) : (
              'Это ваша площадка. Так её видят люди. Окна, цены и условия меняются в кабинете.'
            )}
          </p>
          <Button
            variant="secondary"
            size="sm"
            to={`/org/${v.org.id}?venue=${v.id}`}
            icon={<GearIcon size={18} aria-hidden />}
          >
            Управлять окнами
          </Button>
        </div>
      )}

      <article className={styles.head}>
        <SportsPattern />
        <div className={styles.photo}>
          {v.photoUrl ? (
            <img
              {...boxedImageAttrs(v.photoUrl, COVER_RATIO, PHOTO_BOXES, { crop: false })}
              alt=""
              fetchPriority="high"
              decoding="async"
            />
          ) : (
            <span className={styles.photoFallback} aria-hidden>
              {v.sports[0] && <SportIcon sport={v.sports[0]} size={56} weight="regular" />}
            </span>
          )}
        </div>
        <div className={styles.info}>
          <p className={styles.kind}>
            {v.kindLabel}, {v.indoor ? 'крытая' : 'открытая'}
          </p>
          <h1 className={styles.title}>
            {v.name}
            <span>.</span>
          </h1>
          <p className={styles.address}>
            {v.address}
            {v.districtName && <span className={styles.muted}>Район {v.districtName}</span>}
          </p>
          {v.landmark && <p className={styles.muted}>Как найти: {v.landmark}</p>}
          <p className={styles.sports}>
            {v.sports.map((s) => (
              <span key={s.id} className={styles.sport}>
                <SportIcon sport={s} size={18} />
                {s.name}
              </span>
            ))}
          </p>
          <p className={styles.price}>{venuePriceLine(v)}</p>
          <FeatureTags features={v.features} onlyAccess />
          <div className={styles.actions}>
            {canPropose && (
              <Button
                variant="primary"
                icon={<PlusIcon size={20} weight="bold" aria-hidden />}
                to={toCreate(proposeLink(v.id, null, v.timeZone, sportId))}
              >
                Предложить встречу здесь
              </Button>
            )}
            {v.contacts.phone && (
              <a className={styles.contact} href={`tel:${v.contacts.phone.replace(/[^\d+]/g, '')}`}>
                <PhoneIcon size={20} aria-hidden />
                Позвонить: {v.contacts.phone}
              </a>
            )}
          </div>
          <p className={styles.org}>
            Расписание ведёт <Link to={`/orgs/${v.org.id}`}>{v.org.name}</Link>
            {v.org.verified && (
              <span className={styles.verified}>
                <SealCheckIcon size={18} weight="fill" aria-hidden />
                Организация проверена
              </span>
            )}
          </p>
          <p className={styles.updated}>{updatedLabel(v.ownerUpdatedDays)}</p>
        </div>
      </article>

      <section className={styles.section} aria-labelledby="windows-title">
        <div className={styles.sectionHead}>
          <h2 id="windows-title" className={styles.sectionTitle}>
            Отмеченные свободные окна
          </h2>
          <p className={styles.muted}>
            Время местное. Площадка отмечает доступность вручную. Бронирования на платформе нет: выберите окно и подтвердите доступность с площадкой по телефону.
          </p>
        </div>
        <DayPicker days={v.days} value={date} onChange={setDate} timeZone={v.timeZone} />
        <SlotList
          day={day}
          timeZone={v.timeZone}
          action={(slot) =>
            slot.status === 'free' && canPropose ? (
              <Button
                size="sm"
                variant="secondary"
                to={toCreate(proposeLink(v.id, slot, v.timeZone, sportId))}
              >
                Предложить встречу
              </Button>
            ) : null
          }
        />
      </section>

      <div className={styles.columns}>
        <section className={styles.section} aria-labelledby="features-title">
          <h2 id="features-title" className={styles.sectionTitle}>
            Условия на площадке
          </h2>
          {v.description && <p className={styles.description}>{v.description}</p>}
          <FeatureList features={v.features} />
        </section>

        <section className={styles.section} aria-labelledby="contacts-title">
          <h2 id="contacts-title" className={styles.sectionTitle}>
            Связаться с площадкой
          </h2>
          <ul className={styles.contacts}>
            {v.contacts.phone && (
              <li>
                <a href={`tel:${v.contacts.phone.replace(/[^\d+]/g, '')}`}>
                  <PhoneIcon size={20} aria-hidden />
                  {v.contacts.phone}
                </a>
              </li>
            )}
            {v.contacts.email && (
              <li>
                <a href={`mailto:${v.contacts.email}`}>
                  <EnvelopeSimpleIcon size={20} aria-hidden />
                  {v.contacts.email}
                </a>
              </li>
            )}
            {v.contacts.site && (
              <li>
                <a
                  href={`https://${v.contacts.site.replace(/^https?:\/\//, '')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <GlobeIcon size={20} aria-hidden />
                  {v.contacts.site}
                  <span className="sr-only">(в новой вкладке)</span>
                </a>
              </li>
            )}
          </ul>
          <div className={styles.mapBox}>
            <LazyVenueMap venues={[v]} height={220} zoom={15} links={false} />
            <a href={osm} target="_blank" rel="noreferrer" className={styles.mapLink}>
              Открыть на карте
              <ArrowSquareOutIcon size={16} aria-hidden />
              <span className="sr-only">(в новой вкладке)</span>
            </a>
          </div>
        </section>
      </div>

      <section className={styles.section} aria-labelledby="events-title">
        <h2 id="events-title" className={styles.sectionTitle}>
          Ближайшие встречи здесь
        </h2>
        {events.query.isLoading ? (
          <p className={styles.muted}>Загружаем встречи…</p>
        ) : events.query.isError ? (
          <ErrorState onRetry={() => void events.query.refetch()}>
            Не удалось загрузить встречи на площадке.
          </ErrorState>
        ) : upcoming.length ? (
          <ul className={styles.events}>
            {upcoming.map((e) => (
              <li key={e.id}>
                <FeedCard event={e} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            Пока здесь никто не собирается. Выберите свободное окно выше и предложите встречу первым.
          </p>
        )}
      </section>
    </div>
  );
}
