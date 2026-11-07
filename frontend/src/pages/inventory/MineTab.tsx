import { CaretDownIcon, PlusIcon } from '@phosphor-icons/react';
import { useDelete, useList, type CrudFilter } from '@refinedev/core';
import { App } from 'antd';
import { useState } from 'react';

import { Button, EmptyState, ErrorState, ListSkeleton, Section } from '@/components';
import { errorMessage, useInventoryLive } from '@/lib/api';
import type { InventoryMe, LoanView, ShelfItemView } from '@/types/inventory';

import styles from './inventory.module.css';
import { LoanCard } from './LoanCard';
import { ShelfCard } from './ShelfCard';
import { ShelfItemDialog } from './ShelfItemDialog';
import { OrdersSection } from './orders/OrdersSection';

function useLoans(role: 'incoming' | 'outgoing') {
  const filters: CrudFilter[] = [{ field: 'role', operator: 'eq', value: role }];
  const { result, query } = useList<LoanView>({
    resource: 'gear-loans',
    filters,
    pagination: { mode: 'off' },
    errorNotification: false,
  });
  return { loans: result.data ?? [], query };
}

/** «Моя полка»: кто просит мои вещи, что я выложил и что попросил сам. */
export function MineTab({ me, onShare }: { me: InventoryMe | null; onShare: () => void }) {
  const incoming = useLoans('incoming');
  const outgoing = useLoans('outgoing');
  const items = useList<ShelfItemView>({
    resource: 'shelf',
    filters: [{ field: 'mine', operator: 'eq', value: true }],
    pagination: { mode: 'off' },
    errorNotification: false,
  });
  useInventoryLive(() => {
    void incoming.query.refetch();
    void outgoing.query.refetch();
    void items.query.refetch();
  });
  const [editing, setEditing] = useState<ShelfItemView | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const { mutateAsync: remove } = useDelete();
  const { message, modal } = App.useApp();

  const askRemove = (item: ShelfItemView) =>
    modal.confirm({
      title: `Убрать «${item.name}» с полки?`,
      content: item.pendingRequests
        ? 'Тем, кто сейчас просит эту вещь, придёт отказ с пояснением.'
        : 'Вещь перестанут видеть на полке.',
      okText: 'Убрать с полки',
      cancelText: 'Оставить',
      onOk: async () => {
        setRemovingId(item.id);
        try {
          await remove({ resource: 'shelf', id: item.id, successNotification: false, errorNotification: false });
          message.success('Вещь убрана с полки');
        } catch (e) {
          message.error(errorMessage(e));
        } finally {
          setRemovingId(null);
        }
      },
    });

  const active = incoming.loans.filter((l) => l.status === 'pending' || l.status === 'accepted');
  const history = incoming.loans.filter((l) => !active.includes(l));
  const myItems = items.result.data ?? [];

  return (
    <div className={styles.tab}>
      <Section title="Просят у вас" aside={active.length || undefined}>
        {incoming.query.isLoading ? (
          <ListSkeleton count={2} />
        ) : incoming.query.isError ? (
          <ErrorState title="Не удалось загрузить просьбы" onRetry={() => void incoming.query.refetch()} />
        ) : active.length === 0 ? (
          <p className={styles.muted}>
            Новых просьб нет. Когда кто-то попросит вашу вещь на игру, просьба появится здесь и в уведомлениях.
          </p>
        ) : (
          <div className={styles.loans}>
            {active.map((l) => (
              <LoanCard key={l.id} loan={l} audience="owner" />
            ))}
          </div>
        )}
        {history.length > 0 && (
          <details className={styles.history}>
            <summary>
              <CaretDownIcon size={18} weight="bold" aria-hidden className={styles.caret} />
              Прошлые просьбы: {history.length}
            </summary>
            <div className={styles.loans}>
              {history.map((l) => (
                <LoanCard key={l.id} loan={l} audience="owner" />
              ))}
            </div>
          </details>
        )}
      </Section>

      <OrdersSection role="seller" />

      <Section
        title="Мои вещи на полке"
        aside={myItems.length || undefined}
        actions={
          <Button size="sm" variant="secondary" icon={<PlusIcon size={18} aria-hidden />} onClick={onShare}>
            Поделиться вещью
          </Button>
        }
      >
        {items.query.isLoading ? (
          <ListSkeleton count={2} />
        ) : items.query.isError ? (
          <ErrorState title="Не удалось загрузить ваши вещи" onRetry={() => void items.query.refetch()} />
        ) : myItems.length === 0 ? (
          <EmptyState title="Вы ещё ничем не поделились">
            Лишний мяч, запасная ракетка или палки для ходьбы помогут соседям собрать игру.
            {me && me.shareAs.length > 0 && ' Можно выложить вещь от себя или от имени вашей организации.'}
          </EmptyState>
        ) : (
          <div className={styles.grid}>
            {myItems.map((item) => (
              <ShelfCard
                key={item.id}
                item={item}
                onEdit={setEditing}
                onRemove={askRemove}
                removing={removingId === item.id}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Вы попросили" aside={outgoing.loans.length || undefined}>
        {outgoing.query.isLoading ? (
          <ListSkeleton count={2} />
        ) : outgoing.query.isError ? (
          <ErrorState title="Не удалось загрузить ваши просьбы" onRetry={() => void outgoing.query.refetch()} />
        ) : outgoing.loans.length === 0 ? (
          <p className={styles.muted}>
            Вы пока ничего не просили. Попросить вещь можно на вкладке «Полка» или из карточки события.
          </p>
        ) : (
          <div className={styles.loans}>
            {outgoing.loans.map((l) => (
              <LoanCard key={l.id} loan={l} audience="requester" />
            ))}
          </div>
        )}
      </Section>

      <OrdersSection role="buyer" />

      <ShelfItemDialog open={Boolean(editing)} item={editing} me={me} onClose={() => setEditing(null)} />
    </div>
  );
}
