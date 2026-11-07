import { formatRub } from '@/lib/money';
import { formatRate } from '@/lib/payments';
import type { FeeParts } from '@/types/payments';

import styles from './payments.module.css';

interface FeeTableProps {
  line: { base: number; fee: number; feeParts: FeeParts };
  forWhom: 'event' | 'item';
  total: number;
  totalLabel?: string;
  /** Наценка платформы, доля: 0.05. */
  markup?: number;
}

/** Из чего сложилась сумма: что получит организатор или продавец и сбор сервиса. */
export function FeeTable({ line, forWhom, total, totalLabel = 'Итого к оплате', markup = 0 }: FeeTableProps) {
  const platform = line.feeParts.platform > 0;
  return (
    <dl className={styles.fees}>
      <div>
        <dt>{forWhom === 'event' ? 'Доля организатору' : 'Цена продавцу'}</dt>
        <dd>{formatRub(line.base)}</dd>
      </div>
      <div>
        <dt>
          Сбор сервиса
          <span>
            {platform
              ? `Комиссия банка и ${markup ? formatRate(markup) : 'наценка'} сервису`
              : 'Покрывает комиссию банка'}
          </span>
        </dt>
        <dd>{formatRub(line.fee)}</dd>
      </div>
      <div className={styles.feesTotal}>
        <dt>{totalLabel}</dt>
        <dd>{formatRub(total)}</dd>
      </div>
    </dl>
  );
}
