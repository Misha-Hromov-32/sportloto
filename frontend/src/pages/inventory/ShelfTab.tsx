import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useList, type CrudFilter } from '@refinedev/core';
import { Input, Select } from 'antd';
import { useDeferredValue, useId, useState } from 'react';

import { Button, EmptyState, ErrorState, SkeletonBlock } from '@/components';
import { useInventoryLive } from '@/lib/api';
import { cityLocationFilters } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { District } from '@/types/domain';
import type { GearKind, InventoryMe, ShelfItemView } from '@/types/inventory';

import styles from './inventory.module.css';
import { GEAR_KIND, GEAR_KIND_ORDER } from './labels';
import { RentHints } from './RentHints';
import { RequestDialog, type RequestContext } from './RequestDialog';
import { ShelfCard } from './ShelfCard';
import { BuyDialog } from './orders/BuyDialog';

export function ShelfTab({
  me,
  isGuest,
  loginTo,
  context,
  initialKind,
  sportId,
  onShare,
}: {
  me: InventoryMe | null;
  isGuest: boolean;
  loginTo: string;
  context: RequestContext | null;
  initialKind: GearKind | null;
  sportId: string | null;
  onShare: (() => void) | null;
}) {
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const [kind, setKind] = useState<GearKind | null>(initialKind);
  const [districtId, setDistrictId] = useState<string | null>(null);
  const [asking, setAsking] = useState<ShelfItemView | null>(null);
  const [buying, setBuying] = useState<ShelfItemView | null>(null);
  const searchId = useId();
  const kindId = useId();
  const districtFieldId = useId();

  const city = useSelectedCity();
  const filters: CrudFilter[] = [
    { field: 'city', operator: 'eq', value: city.name },
    { field: 'q', operator: 'eq', value: query },
    { field: 'kind', operator: 'eq', value: kind },
    { field: 'districtId', operator: 'eq', value: districtId },
    { field: 'eventId', operator: 'eq', value: context?.eventId },
    { field: 'sportId', operator: 'eq', value: context ? sportId : undefined },
  ];
  const { result, query: listQuery } = useList<ShelfItemView>({
    resource: 'shelf',
    filters,
    pagination: { mode: 'off' },
    errorNotification: false,
  });
  useInventoryLive(() => void listQuery.refetch());
  const { result: districts } = useList<District>({
    resource: 'districts',
    filters: cityLocationFilters(city, ''),
    pagination: { mode: 'off' },
  });
  const items = (result.data ?? []).filter((i) => !(context && i.isMine));
  const filtered = Boolean(query || kind || districtId);

  return (
    <div className={styles.tab}>
      <div className={styles.filters} role="search">
        <div className={styles.filterSearch}>
          <label htmlFor={searchId} className="sr-only">
            Что ищете
          </label>
          <Input
            id={searchId}
            size="large"
            allowClear
            prefix={<MagnifyingGlassIcon size={20} aria-hidden />}
            placeholder="Мяч, ракетка, палки"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={kindId} className="sr-only">
            Тип вещи
          </label>
          <Select
            id={kindId}
            size="large"
            allowClear
            placeholder="Любой тип"
            className={styles.filterSelect}
            value={kind ?? undefined}
            onChange={(v) => setKind((v as GearKind | undefined) ?? null)}
            options={GEAR_KIND_ORDER.map((k) => ({ value: k, label: GEAR_KIND[k].label }))}
          />
        </div>
        <div>
          <label htmlFor={districtFieldId} className="sr-only">
            Район
          </label>
          <Select
            id={districtFieldId}
            size="large"
            allowClear
            placeholder="Любой район"
            className={styles.filterSelect}
            value={districtId ?? undefined}
            onChange={(v) => setDistrictId((v as string | undefined) ?? null)}
            options={(districts.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>
      </div>

      {listQuery.isLoading ? (
        <div className={styles.grid} role="status" aria-live="polite">
          <span className="sr-only">Загружаем полку…</span>
          {[0, 1, 2].map((i) => (
            <SkeletonBlock key={i} height={360} radius="media" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <ErrorState title="Не удалось загрузить полку" onRetry={() => void listQuery.refetch()} />
      ) : items.length === 0 ? (
        <>
          <EmptyState
            title={filtered ? 'Под эти условия ничего нет' : 'На полке пока пусто'}
            actions={
              filtered ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQ('');
                    setKind(null);
                    setDistrictId(null);
                  }}
                >
                  Сбросить фильтры
                </Button>
              ) : onShare ? (
                <Button variant="primary" onClick={onShare}>
                  Поделиться вещью
                </Button>
              ) : undefined
            }
          >
            {filtered
              ? 'Попробуйте другой тип вещи или уберите район.'
              : 'Здесь появятся вещи, которые клубы, партнёры и соседи дают на время.'}
          </EmptyState>
          <RentHints />
        </>
      ) : (
        <>
          <p className={styles.count} aria-live="polite">
            Найдено: {items.length}
          </p>
          <div className={styles.grid}>
            {items.map((item) => (
              <ShelfCard
                key={item.id}
                item={item}
                loginTo={isGuest ? loginTo : undefined}
                requestLabel={context ? 'Попросить на это событие' : undefined}
                onRequest={me?.userId ? setAsking : undefined}
                onBuy={me?.userId ? setBuying : undefined}
              />
            ))}
          </div>
          {context && <RentHints title="Не нашли нужное" />}
        </>
      )}

      <RequestDialog item={asking} context={context} me={me} onClose={() => setAsking(null)} />
      <BuyDialog item={buying} onClose={() => setBuying(null)} />
    </div>
  );
}
