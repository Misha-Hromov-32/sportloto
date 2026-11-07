import { useList } from '@refinedev/core';
import { useMemo } from 'react';

import { dayjs } from '@/lib/dates';
import { cityLocationFilters } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { EventView, OrganizationView, SportView } from '@/types/api';

/** Всё живое на лендинге берётся из ленты, каталога направлений и списка допущенных организаций. */
export function useLandingData() {
  const city = useSelectedCity();
  const events = useList<EventView>({
    resource: 'events',
    filters: [
      { field: 'aiFlag', operator: 'eq', value: 'none' },
      { field: 'state', operator: 'eq', value: 'upcoming' },
      ...cityLocationFilters(city),
    ],
    sorters: [{ field: 'startsAt', order: 'asc' }],
    pagination: { mode: 'server', currentPage: 1, pageSize: 48 },
  });
  const sports = useList<SportView>({ resource: 'sports', pagination: { mode: 'off' } });
  const orgs = useList<OrganizationView>({
    resource: 'organizations',
    filters: [{ field: 'city', operator: 'eq', value: city.name }],
    pagination: { mode: 'off' },
  });

  const upcoming = useMemo(
    () => (events.result.data ?? []).filter((e) => e.state === 'upcoming'),
    [events.result.data],
  );

  const week = useMemo(() => {
    const until = dayjs().add(7, 'day');
    const list = upcoming.filter((e) => dayjs(e.startsAt).isBefore(until));
    return list;
  }, [upcoming]);

  return {
    city,
    upcoming,
    eventsTotal: events.result.total ?? 0,
    week,
    eventsLoading: events.query.isLoading,
    eventsError: events.query.isError,
    refetchEvents: () => void events.query.refetch(),
    sports: sports.result.data ?? [],
    sportsLoading: sports.query.isLoading,
    orgs: (orgs.result.data ?? []).filter((o) => o.status === 'approved'),
    orgsLoading: orgs.query.isLoading,
  };
}

export type LandingData = ReturnType<typeof useLandingData>;
