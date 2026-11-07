import { Segmented } from 'antd';

import { PageHeader } from '@/components';
import { usePaymentAvailability } from '@/lib/payments';

import { useUrlParams } from '../parts/hooks';
import styles from '../parts/admin.module.css';
import { OverviewTab } from './OverviewTab';
import { PaymentsTab } from './PaymentsTab';
import { PayoutsTab } from './PayoutsTab';
import { SettingsTab } from './SettingsTab';

type Tab = 'overview' | 'payments' | 'payouts' | 'settings';

/** Оплата на сайте для администратора: сводка, платежи и возвраты, выплаты, ставки. */
export default function AdminPaymentsPage() {
  const availability = usePaymentAvailability();
  const [params, setParams] = useUrlParams({ tab: 'overview' });
  const tab = (['overview', 'payments', 'payouts', 'settings'] as Tab[]).includes(params.tab as Tab)
    ? (params.tab as Tab)
    : 'overview';

  if (availability.data?.enabled === false)
    return (
      <div className={styles.page}>
        <PageHeader
          title="Оплата отключена"
          subtitle="Создание платежей, возвраты и выплаты через сайт недоступны. Финансовая история сохранена. Ключей платёжного шлюза в конфигурации нет."
        />
      </div>
    );
  return (
    <div className={styles.page}>
      <PageHeader
        title="Оплата"
        subtitle="Деньги за встречи и вещи с полки: сколько прошло через сайт, возвраты, выплаты организаторам и ставки ЮKassa."
      />
      <Segmented<Tab>
        value={tab}
        onChange={(value) => setParams({ tab: value })}
        options={[
          { value: 'overview', label: 'Сводка' },
          { value: 'payments', label: 'Платежи' },
          { value: 'payouts', label: 'Выплаты' },
          { value: 'settings', label: 'Ставки' },
        ]}
      />
      {tab === 'overview' ? (
        <OverviewTab onTab={(t) => setParams({ tab: t })} />
      ) : tab === 'payments' ? (
        <PaymentsTab />
      ) : tab === 'payouts' ? (
        <PayoutsTab />
      ) : (
        <SettingsTab />
      )}
    </div>
  );
}
