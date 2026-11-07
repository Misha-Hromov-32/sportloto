import { CaretDownIcon } from '@phosphor-icons/react';

import { ErrorState, ListSkeleton, Section } from '@/components';
import { listOf, useOrders } from '@/pages/payments/parts/usePayments';
import type { OrderView } from '@/types/payments';

import styles from './orders.module.css';
import inv from '../inventory.module.css';
import { OrderCard } from './OrderCard';

const ACTIVE: OrderView['status'][] = ['awaiting_payment', 'paid'];

/** Покупки или продажи вещей с полки: сначала то, где нужно действие, потом история. */
export function OrdersSection({ role, hideEmpty = true }: { role: 'buyer' | 'seller'; hideEmpty?: boolean }) {
  const { data, isLoading, isError, refetch } = useOrders(role);
  const orders = listOf(data);
  const active = orders.filter((o) => ACTIVE.includes(o.status));
  const history = orders.filter((o) => !ACTIVE.includes(o.status));
  const title = role === 'buyer' ? 'Мои покупки' : 'Продажи';

  if (!isLoading && !isError && !orders.length) {
    if (hideEmpty) return null;
    return (
      <Section title={title}>
        <p className={inv.muted}>
          {role === 'buyer'
            ? 'Вы пока ничего не покупали. Вещи с ценой есть на вкладке «Полка».'
            : 'Продаж пока нет. Чтобы продать вещь, выложите её на полку и выберите «Продаю».'}
        </p>
      </Section>
    );
  }

  return (
    <Section title={title} aside={active.length || undefined}>
      {isLoading ? (
        <ListSkeleton count={2} />
      ) : isError ? (
        <ErrorState
          title={role === 'buyer' ? 'Не удалось загрузить покупки' : 'Не удалось загрузить продажи'}
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          {active.length > 0 && (
            <div className={styles.list}>
              {active.map((o) => (
                <OrderCard key={o.id} order={o} />
              ))}
            </div>
          )}
          {history.length > 0 && (
            <details className={inv.history} open={!active.length && history.length <= 3}>
              <summary>
                <CaretDownIcon size={18} weight="bold" aria-hidden className={inv.caret} />
                {role === 'buyer' ? 'Прошлые покупки' : 'Прошлые продажи'}: {history.length}
              </summary>
              <div className={styles.list}>
                {history.map((o) => (
                  <OrderCard key={o.id} order={o} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </Section>
  );
}
