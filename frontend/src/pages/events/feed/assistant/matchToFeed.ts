import type { MatchFilters } from '@/types/api';

import { activeKeys, fromAssistant, type FeedFilters, type FilterKey } from '../filters';

/** Фильтры подбора → фильтры ленты. «Возле района» в ленте — радиус от этого района. */
export function matchToFeed(f: MatchFilters): { filters: FeedFilters; keys: FilterKey[] } {
  const { aroundDistrictId, ...rest } = f;
  const { filters } = fromAssistant(rest);
  if (aroundDistrictId) {
    filters.near = true;
    filters.from = aroundDistrictId;
  }
  return { filters, keys: activeKeys(filters) };
}
