import { useList } from '@refinedev/core';

import type { CategoryView, SportView } from '@/types/api';

/** Каталог направлений и дерево категорий — данные, а не код. */
export function useSportsCatalog() {
  const sports = useList<SportView>({ resource: 'sports', pagination: { mode: 'off' } });
  const categories = useList<CategoryView>({ resource: 'categories', pagination: { mode: 'off' } });
  return {
    sports: sports.result.data,
    categories: categories.result.data,
    isLoading: sports.query.isLoading || categories.query.isLoading,
    isError: sports.query.isError || categories.query.isError,
    refetch: () => {
      void sports.query.refetch();
      void categories.query.refetch();
    },
  };
}
