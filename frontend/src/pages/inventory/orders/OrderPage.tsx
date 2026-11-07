import { useParams } from 'react-router';

import { Button, ErrorState, GoneState, PageHeader, SkeletonBlock } from '@/components';
import { useLiveGet } from '@/lib/api';
import { PAYMENTS_API, PAYMENTS_LIVE } from '@/lib/payments';
import type { OrderView } from '@/types/payments';

import { OrderCard } from './OrderCard';
import styles from './orders.module.css';

/** Покупка или продажа вещи: сюда ведут уведомления и возврат из банка. */
export default function OrderPage() {
  const { id = '' } = useParams();
  const { data, isLoading, isError, error, refetch } = useLiveGet<OrderView>(
    PAYMENTS_API.order(id),
    PAYMENTS_LIVE,
    Boolean(id),
  );
  const role = data?.isSeller && !data.isBuyer ? 'seller' : 'buyer';

  return (
    <div className={['container', styles.page].join(' ')}>
      <PageHeader
        title={role === 'seller' ? 'Продажа' : 'Покупка'}
        subtitle={
          role === 'seller'
            ? 'Передайте вещь покупателю. Деньги придут, когда он подтвердит получение.'
            : 'Договоритесь с продавцом о передаче и нажмите «Получил», когда заберёте вещь.'
        }
        back={{ to: '/inventory?tab=mine', label: 'Моя полка' }}
      />
      {isLoading ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Загружаем покупку…</span>
          <SkeletonBlock height={220} radius="media" />
        </div>
      ) : error?.statusCode === 404 || error?.statusCode === 403 ? (
        <GoneState
          layout="inline"
          title="Покупка не найдена"
          actions={
            <Button variant="primary" to="/inventory">
              Открыть полку
            </Button>
          }
        >
          Её видят только покупатель и продавец. Возможно, вы вошли под другим аккаунтом.
        </GoneState>
      ) : isError || !data ? (
        <ErrorState title="Не удалось загрузить покупку" onRetry={() => void refetch()} />
      ) : (
        <OrderCard order={data} />
      )}
    </div>
  );
}
