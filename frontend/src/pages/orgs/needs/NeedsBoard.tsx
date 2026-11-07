import { HandHeartIcon, PlusIcon } from '@phosphor-icons/react';
import { useList, type CrudFilter } from '@refinedev/core';
import { useState } from 'react';

import { Button, Chip, EmptyState, ErrorState, SkeletonBlock } from '@/components';
import { useInventoryLive } from '@/lib/api';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { InventoryMe, SupportNeedView } from '@/types/inventory';

import { NeedCard } from './NeedCard';
import { NeedDialog, type NeedPreset } from './NeedDialog';
import styles from './needs.module.css';
import { OfferDialog } from './OfferDialog';

/** «Нужна помощь»: просьбы клубов, на которые откликаются партнёры. */
export function NeedsBoard({ me }: { me: InventoryMe | null }) {
  const city = useSelectedCity();
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [offering, setOffering] = useState<SupportNeedView | null>(null);
  const [preset, setPreset] = useState<NeedPreset | null>(null);
  const filters: CrudFilter[] = [{ field: 'status', operator: 'eq', value: status }, { field: 'city', operator: 'eq', value: city.name }];
  const { result, query } = useList<SupportNeedView>({
    resource: 'support-needs',
    filters,
    pagination: { mode: 'off' },
    errorNotification: false,
  });
  useInventoryLive(() => void query.refetch());
  const needs = result.data ?? [];
  const clubs = me?.clubs ?? [];
  const sponsor = (me?.sponsors.length ?? 0) > 0;

  return (
    <div className={styles.board}>
      <div className={styles.boardIntro}>
        <HandHeartIcon size={28} aria-hidden className={styles.boardIcon} />
        <p>
          Клубы и сообщества в {city.in} просят то, чего не хватает: мячи, сетки, место в зале.
        </p>
        <div className={styles.actions}>
          {clubs.length > 0 && (
            <Button
              variant="secondary"
              icon={<PlusIcon size={18} aria-hidden />}
              onClick={() => setPreset({ orgId: clubs[0]!.id })}
            >
              Попросить о помощи
            </Button>
          )}
          {me?.userId && !sponsor && clubs.length === 0 && (
            <Button variant="quiet" to="/org/new">
              Стать партнёром
            </Button>
          )}
        </div>
      </div>

      <div className={styles.statusChips} role="group" aria-label="Какие просьбы показать">
        <Chip selected={status === 'open'} onClick={() => setStatus('open')}>
          Нужна помощь
        </Chip>
        <Chip selected={status === 'closed'} onClick={() => setStatus('closed')}>
          Уже помогли
        </Chip>
      </div>

      {query.isLoading ? (
        <div className={styles.list} role="status">
          <span className="sr-only">Загружаем просьбы…</span>
          <SkeletonBlock height={180} radius="media" />
          <SkeletonBlock height={180} radius="media" />
        </div>
      ) : query.isError ? (
        <ErrorState title="Не удалось загрузить просьбы" onRetry={() => void query.refetch()} />
      ) : needs.length === 0 ? (
        <EmptyState title={status === 'open' ? 'Сейчас никто не просит помощи' : 'Закрытых просьб пока нет'}>
          {status === 'open'
            ? 'Когда клуб попросит о помощи, просьба появится здесь, а партнёры получат уведомление.'
            : 'Сюда попадают просьбы, которые закрыли партнёры.'}
        </EmptyState>
      ) : (
        <div className={styles.list}>
          {needs.map((n) => (
            <NeedCard key={n.id} need={n} onOffer={sponsor ? setOffering : undefined} />
          ))}
        </div>
      )}

      <OfferDialog need={offering} onClose={() => setOffering(null)} />
      <NeedDialog open={Boolean(preset)} clubs={clubs} preset={preset} onClose={() => setPreset(null)} />
    </div>
  );
}
