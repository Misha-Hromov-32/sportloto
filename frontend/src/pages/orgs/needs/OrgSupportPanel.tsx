import { ArrowRightIcon, PackageIcon, PlusIcon } from '@phosphor-icons/react';
import { useList, type CrudFilter } from '@refinedev/core';
import { useState } from 'react';
import { Link } from 'react-router';

import { Button, EmptyState, ErrorState, Section, SkeletonBlock } from '@/components';
import { useInventoryLive } from '@/lib/api';
import type { OrganizationView } from '@/types/api';
import type { ShelfItemView, SupportNeedView } from '@/types/inventory';

import { NeedCard } from './NeedCard';
import { NeedDialog, type NeedPreset } from './NeedDialog';
import styles from './needs.module.css';
import { OfferDialog } from './OfferDialog';

/**
 * Кабинет допущенной организации: у клуба — просьбы о помощи и отклики партнёров,
 * у партнёра — просьбы клубов и свои отклики. И там и там — вещи организации на полке.
 */
export function OrgSupportPanel({ org }: { org: OrganizationView }) {
  const sponsor = org.type === 'sponsor';
  const filters: CrudFilter[] = sponsor
    ? [{ field: 'mine', operator: 'eq', value: true }, { field: 'status', operator: 'eq', value: 'all' }]
    : [{ field: 'orgId', operator: 'eq', value: org.id }, { field: 'status', operator: 'eq', value: 'all' }];
  const needs = useList<SupportNeedView>({
    resource: 'support-needs',
    filters,
    pagination: { mode: 'off' },
    errorNotification: false,
  });
  const open = useList<SupportNeedView>({
    resource: 'support-needs',
    filters: [{ field: 'status', operator: 'eq', value: 'open' }],
    pagination: { mode: 'off' },
    queryOptions: { enabled: sponsor },
    errorNotification: false,
  });
  const shelf = useList<ShelfItemView>({
    resource: 'shelf',
    filters: [{ field: 'ownerOrgId', operator: 'eq', value: org.id }],
    pagination: { mode: 'off' },
    errorNotification: false,
  });
  useInventoryLive(() => {
    void needs.query.refetch();
    void shelf.query.refetch();
    if (sponsor) void open.query.refetch();
  });
  const [preset, setPreset] = useState<NeedPreset | null>(null);
  const [offering, setOffering] = useState<SupportNeedView | null>(null);

  const list = (needs.result.data ?? []).filter((n) => (sponsor ? n.myOffer : true));
  const items = shelf.result.data ?? [];
  const requests = items.reduce((s, i) => s + i.pendingRequests, 0);
  const waiting = (open.result.data ?? []).filter((n) => n.offerAs.length > 0);

  return (
    <Section
      id="support"
      title={sponsor ? 'Помощь клубам' : 'Помощь от партнёров'}
      actions={
        sponsor ? undefined : (
          <Button
            size="sm"
            variant="secondary"
            icon={<PlusIcon size={18} aria-hidden />}
            onClick={() => setPreset({ orgId: org.id })}
          >
            Попросить о помощи
          </Button>
        )
      }
    >
      <div className={styles.panel}>
        <p className={styles.muted}>
          {sponsor
            ? 'Клубы просят мячи, сетки, место в зале. Откликнитесь «Поможем», клуб подтвердит, и на его странице появится «При поддержке» с вашим названием.'
            : 'Не хватает мячей, сетки или места в зале? Опубликуйте просьбу о помощи.'}
        </p>

        {sponsor && (
          <div className={styles.summaryRow}>
            <span>
              Сейчас ждут помощи: <b className="tabular">{waiting.length}</b>
            </span>
            <Button size="sm" variant="secondary" to="/inventory?tab=needs" iconAfter={<ArrowRightIcon size={18} aria-hidden />}>
              Открыть просьбы клубов
            </Button>
          </div>
        )}

        {needs.query.isLoading ? (
          <SkeletonBlock height={160} radius="media" />
        ) : needs.query.isError ? (
          <ErrorState title="Не удалось загрузить просьбы" onRetry={() => void needs.query.refetch()} />
        ) : list.length === 0 ? (
          sponsor ? (
            <p className={styles.muted}>Вы ещё не откликались. Ваши отклики и ответы клубов появятся здесь.</p>
          ) : (
            <EmptyState title="Просьб о помощи пока нет">
              Например: «Нужны 2 мяча и 10 мест в зале для детской группы до 30 октября».
            </EmptyState>
          )
        ) : (
          <div className={styles.list}>
            {list.map((n) => (
              <NeedCard key={n.id} need={n} showOrg={sponsor} onOffer={sponsor ? setOffering : undefined} />
            ))}
          </div>
        )}

        <div className={styles.shelfRow}>
          <PackageIcon size={24} aria-hidden className={styles.boardIcon} />
          <span>
            {items.length
              ? `Вещи на общей полке: ${items.length}${requests ? `. Просят: ${requests}` : ''}`
              : 'Можно выложить на общую полку мячи, манишки или сетки, которые вы даёте на время.'}
          </span>
          <Link to="/inventory?tab=mine" className={styles.shelfLink}>
            {items.length ? 'Открыть полку организации' : 'Поделиться вещью'}
          </Link>
        </div>
      </div>

      <NeedDialog
        open={Boolean(preset)}
        clubs={[{ id: org.id, name: org.name, type: org.type, status: org.status }]}
        preset={preset}
        onClose={() => setPreset(null)}
      />
      <OfferDialog need={offering} onClose={() => setOffering(null)} />
    </Section>
  );
}
