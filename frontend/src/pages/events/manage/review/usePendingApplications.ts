import { useList } from '@refinedev/core';
import { useMemo } from 'react';

import { useLiveRefetch } from '@/lib/api';
import type { OrganizerPendingView } from '@/types/api';

/** Новые заявки по всем событиям организатора; с eventId — только по одному событию. */
export function usePendingApplications(opts: { eventId?: string; enabled?: boolean } = {}) {
  const { result, query } = useList<OrganizerPendingView>({
    resource: 'participations',
    filters: [{ field: 'scope', operator: 'eq', value: 'organizer_pending' }],
    pagination: { mode: 'off' },
    liveMode: 'auto',
    queryOptions: { enabled: opts.enabled ?? true },
  });
  // Места в заявках зависят от события: лимит поменяли — список перечитывается
  const enabled = opts.enabled ?? true;
  useLiveRefetch(['events'], () => enabled && void query.refetch());
  const all = result.data;
  const items = useMemo(
    () => (opts.eventId ? all.filter((p) => p.event.id === opts.eventId) : all),
    [all, opts.eventId],
  );
  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
