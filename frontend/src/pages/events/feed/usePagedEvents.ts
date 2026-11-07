import { useInfiniteList, type CrudFilter, type CrudSort } from '@refinedev/core';

import { cityLocationFilters } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { EventView } from '@/types/api';

/** Следующая порция запрашивается только по действию пользователя. Смена условий начинает новую выдачу. */
export function usePagedEvents(
  filters: CrudFilter[],
  {
    enabled = true,
    pageSize = 24,
    sorters = [],
  }: { enabled?: boolean; pageSize?: number; sorters?: CrudSort[] } = {},
) {
  const city = useSelectedCity();
  const { result, query } = useInfiniteList<EventView>({
    resource: 'events',
    filters: [...filters, ...cityLocationFilters(city)],
    sorters,
    pagination: { currentPage: 1, pageSize, mode: 'server' },
    queryOptions: { enabled },
  });
  const pages = result.data?.pages ?? [];
  const byId = new Map<string, EventView>();
  for (const page of pages) {
    for (const event of page.data) byId.set(event.id, event);
  }
  return {
    events: [...byId.values()],
    total: pages[0]?.total ?? 0,
    hasMore: Boolean(result.hasNextPage),
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    query,
  };
}
