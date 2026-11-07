import { type CrudFilter, type CrudSort } from '@refinedev/core';

import type { EventView, Identity } from '@/types/api';
import type { District } from '@/types/domain';

import { toCrudFilters, type FeedFilters } from '../filters';
import { orderEvents, type EventOrder } from '../ranking';
import { usePagedEvents } from '../usePagedEvents';

const TAKEN = ['confirmed', 'pending', 'waitlist', 'rejected'];

/** В стопку не попадают свои события, те, куда человек уже записан или подал заявку, прошедшие и отменённые. */
export const fitsDeck = (e: EventView) =>
  e.state === 'upcoming' && !e.isOrganizer && !(e.my && TAKEN.includes(e.my.status));

function useFeedEvents(filters: CrudFilter[], enabled = true, sorters: CrudSort[] = []) {
  return usePagedEvents(filters, { enabled, sorters });
}

interface DeckEventsArgs {
  /** Как в списке: с фильтрами или выбранным порядком — одна выдача, без них — «Для вас», потом остальные. */
  results: boolean;
  filters: FeedFilters;
  order: EventOrder;
  districts: District[];
  me: Identity | null;
}

/** События для стопки — те же запросы, что у списка, чтобы стопка совпадала с выдачей. */
export function useDeckEvents({ results, filters, order, districts, me }: DeckEventsArgs) {
  const personal = Boolean(me && me.role !== 'admin');
  const found = useFeedEvents(
    toCrudFilters(filters, districts),
    results,
    order === 'time' ? [{ field: 'startsAt', order: 'asc' }] : [],
  );
  const forYou = useFeedEvents([{ field: 'forYou', operator: 'eq', value: true }], !results && personal);
  const all = useFeedEvents([], !results);

  const queries = results ? [found.query] : personal ? [forYou.query, all.query] : [all.query];
  // Пока грузится новая выдача, прежняя не должна попасть в стопку
  const isLoading = queries.some((q) => q.isLoading || q.isPlaceholderData);
  const isError = queries.some((q) => q.isError);
  const refetch = () => queries.forEach((q) => void q.refetch());

  let ordered: EventView[];
  if (results) {
    ordered = orderEvents(
      found.events,
      order,
      filters.q,
      me?.interests.map((s) => s.id),
    );
  } else {
    const first = personal ? forYou.events : [];
    const seen = new Set(first.map((e) => e.id));
    const rest = all.events
      .filter((e) => !seen.has(e.id))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
    ordered = [...first, ...rest];
  }

  const page = results ? found : all;
  return {
    events: ordered,
    isLoading,
    isError,
    refetch,
    hasMore: page.hasMore,
    loadMore: page.loadMore,
    loadingMore: page.loadingMore,
  };
}
