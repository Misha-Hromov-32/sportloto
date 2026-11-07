import { CalendarPlusIcon, EyeSlashIcon, GearIcon } from '@phosphor-icons/react';
import { useList, useOne } from '@refinedev/core';
import { useState } from 'react';
import { useParams } from 'react-router';

import {
  Button,
  EmptyState,
  ErrorState,
  EventCard,
  EventMap,
  GoneState,
  ListSkeleton,
  PageSkeleton,
  Section,
  StatusBadge,
} from '@/components';
import { dayjs } from '@/lib/dates';
import { useMe, type ApiError } from '@/lib/api';
import { plural } from '@/lib/plural';
import type { EventView, OrganizationView } from '@/types/api';
import type { District } from '@/types/domain';

import { OrgHero, type HeroFact } from './parts/OrgHero';
import { OrgContacts, OrgDescription, OrgPlace, OrgSports } from './parts/OrgInfo';
import styles from './parts/OrgPages.module.css';
import { SupportedBy } from './needs/SupportedBy'; // В3 + С7
import { SuspensionNotice } from './suspension/SuspensionNotice'; // С17
import { FollowButton } from '@/components/FollowButton';

const PAST_STEP = 5;
const HELD = ['встречу провели', 'встречи провели', 'встреч провели'] as const;

/** «с октября 2025»: месяц в родительном падеже даёт только формат с числом. */
function sinceLabel(org: OrganizationView): string {
  const approved = [...org.reviews].reverse().find((r) => r.decision === 'approved');
  return `с ${dayjs(approved?.at ?? org.createdAt)
    .format('D MMMM YYYY')
    .replace(/^\d+\s/, '')}`;
}

export default function OrgPublicPage() {
  const { id = '' } = useParams();
  const { me } = useMe();
  const [pastShown, setPastShown] = useState(PAST_STEP);

  const { query, result: org } = useOne<OrganizationView>({
    resource: 'organizations',
    id,
    errorNotification: false,
    queryOptions: { retry: false },
  });
  const eventsQuery = useList<EventView>({
    resource: 'events',
    filters: [
      { field: 'scope', operator: 'eq', value: 'org' },
      { field: 'orgId', operator: 'eq', value: id },
    ],
    pagination: { mode: 'off' },
    queryOptions: { enabled: Boolean(org) },
    errorNotification: false,
  });
  const districtsQuery = useList<District>({ resource: 'districts', pagination: { mode: 'off' } });

  if (query.isLoading)
    return (
      <div className="container">
        <PageSkeleton label="Загружаем страницу организации…" />
      </div>
    );

  if (query.isError || !org) {
    const code = (query.error as ApiError | null)?.code;
    return (
      <div className="container">
        {code === 'not_found' ? (
          <GoneState
            title="Страница пока недоступна"
            actions={
              <>
                <Button variant="primary" to="/events">
                  Найти встречу
                </Button>
                <Button variant="secondary" to="/">
                  На главную
                </Button>
              </>
            }
          >
            Такой страницы организации нет или она ещё не открыта. Посмотрите встречи других клубов и
            сообществ.
          </GoneState>
        ) : (
          <ErrorState
            title="Не удалось загрузить страницу организации"
            layout="page"
            onRetry={() => void query.refetch()}
          />
        )}
      </div>
    );
  }

  const events = eventsQuery.result.data ?? [];
  const upcoming = events.filter((e) => e.state === 'upcoming' || e.state === 'live');
  const past = events.filter((e) => e.state === 'past').sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const district = (districtsQuery.result.data ?? []).find((d) => d.id === org.districtId)?.name ?? null;
  const published = org.status === 'approved';
  const isAdmin = me?.role === 'admin';
  const mapEvents = upcoming.length ? upcoming : past.slice(0, 3);

  const facts: HeroFact[] = [
    { value: String(org.facts.held), label: plural(org.facts.held, HELD) },
    { value: String(org.facts.upcoming), label: 'впереди' },
  ];
  if (published) facts.push({ value: sinceLabel(org), label: 'в сервисе' });

  return (
    <div className={['container', styles.page, styles.publicPage].join(' ')}>
      {!published && (
        <div className={styles.unpublished} role="note">
          <EyeSlashIcon size={24} aria-hidden />
          <div className={styles.unpublishedBody}>
            <p className={styles.unpublishedTitle}>Страница не опубликована</p>
            <p>
              {org.isOwner
                ? 'Её видите только вы и администратор. Для остальных она откроется после допуска.'
                : 'Её видят только администраторы и представитель организации. Для остальных она откроется после допуска.'}
            </p>
            <div className={styles.unpublishedRow}>
              <StatusBadge kind="org" status={org.status} />
              {org.isOwner && (
                <Button variant="secondary" size="sm" to={`/org/${org.id}`}>
                  Открыть кабинет
                </Button>
              )}
              {isAdmin && (
                <Button variant="secondary" size="sm" to={`/admin/organizations/${org.id}`}>
                  Открыть заявку
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {published && org.isOwner && (
        <div className={styles.ownerBar}>
          <p>Это страница вашей организации. Так её видят все.</p>
          <div className={styles.ownerActions}>
            <Button
              variant="secondary"
              size="sm"
              to={`/events/new?org=${org.id}`}
              icon={<CalendarPlusIcon size={18} aria-hidden />}
            >
              Создать встречу
            </Button>
            <Button variant="quiet" size="sm" to={`/org/${org.id}`} icon={<GearIcon size={18} aria-hidden />}>
              Кабинет
            </Button>
          </div>
        </div>
      )}

      {/* С17: допуск приостановлен */}
      <SuspensionNotice org={org} />

      <OrgHero
        name={org.name}
        typeLabel={org.typeLabel}
        logoUrl={org.logoUrl}
        coverUrl={org.coverUrl}
        city={org.city}
        districtName={district}
        verified={published}
        facts={facts}
        photos={[...new Set(events.map((e) => e.coverUrl).filter((u): u is string => Boolean(u)))]}
      />

      <div className={styles.publicGrid}>
        <div className={styles.publicAbout}>
          {published && <FollowButton kind="org" id={org.id} />}
          <OrgDescription title="О нас" text={org.description} />
          {/* В3 + С7: «При поддержке …» */}
          {published && <SupportedBy orgId={org.id} orgType={org.type} />}
        </div>

        <div className={styles.publicUpcoming}>
          <Section
            title="Ближайшие встречи"
            aside={eventsQuery.query.isLoading ? undefined : upcoming.length}
          >
            {eventsQuery.query.isError ? (
              <ErrorState
                title="Не удалось загрузить встречи"
                onRetry={() => void eventsQuery.query.refetch()}
              />
            ) : eventsQuery.query.isLoading ? (
              <ListSkeleton count={2} label="Загружаем встречи…" />
            ) : upcoming.length === 0 ? (
              <EmptyState
                title="Ближайших встреч пока нет"
                icon={<CalendarPlusIcon size={28} aria-hidden />}
                actions={
                  org.isOwner && published ? (
                    <Button variant="primary" to={`/events/new?org=${org.id}`}>
                      Создать встречу
                    </Button>
                  ) : (
                    <Button variant="secondary" to="/events">
                      Найти другие встречи
                    </Button>
                  )
                }
              >
                {!org.isOwner
                  ? 'Новые встречи появятся здесь. Пока можно посмотреть встречи других клубов.'
                  : published
                    ? 'Опубликуйте встречу, и она появится здесь и в поиске сразу.'
                    : 'После допуска здесь появятся встречи, которые вы опубликуете от имени организации.'}
              </EmptyState>
            ) : (
              <div className={styles.upcoming}>
                <div className={styles.featured}>
                  <EventCard event={upcoming[0]!} variant="poster" />
                </div>
                {upcoming.length > 1 && (
                  <ul className={styles.eventList}>
                    {upcoming.slice(1).map((e) => (
                      <li key={e.id}>
                        <EventCard event={e} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Section>
        </div>

        <aside className={styles.publicAside} aria-label="Сведения об организации">
          <OrgSports sports={org.sports} />
          <OrgPlace city={org.city} districtName={district} address={org.address}>
            {mapEvents.length > 0 && (
              <div className={styles.miniMap}>
                <EventMap events={mapEvents} height={240} zoom={13} />
                <p className={styles.mapNote}>
                  {upcoming.length ? 'На карте места ближайших встреч' : 'На карте места прошедших встреч'}
                </p>
              </div>
            )}
          </OrgPlace>
          <OrgContacts phone={org.contacts.phone} email={org.contacts.email} social={org.contacts.social} />
        </aside>

        <div className={styles.publicPast}>
          <Section title="Прошедшие встречи" aside={past.length || undefined}>
            {past.length === 0 ? (
              <p className={styles.muted}>Прошедших встреч пока нет.</p>
            ) : (
              <>
                <ul className={styles.eventList}>
                  {past.slice(0, pastShown).map((e) => (
                    <li key={e.id}>
                      <EventCard event={e} />
                    </li>
                  ))}
                </ul>
                {past.length > pastShown && (
                  <Button variant="secondary" onClick={() => setPastShown((n) => n + PAST_STEP)}>
                    Показать ещё {Math.min(PAST_STEP, past.length - pastShown)}
                  </Button>
                )}
              </>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
