import type { CrudFilter } from '@refinedev/core';

/** Список направлений вместе со скрытыми администратором: нужен, чтобы показать уже выбранные. */
export const WITH_HIDDEN: CrudFilter[] = [{ field: 'includeHidden', operator: 'eq', value: true }];

/** Что можно выбрать: скрытые направления не предлагаются, но уже выбранные остаются в списке. */
export function choosable<T extends { id: string; hidden?: boolean }>(
  list: T[],
  keep: readonly (string | null | undefined)[] = [],
): T[] {
  const kept = new Set(keep.filter(Boolean));
  return list.filter((s) => !s.hidden || kept.has(s.id));
}
