import { CurrencyRub, ArrowCounterClockwise } from '@phosphor-icons/react';

import {
  cancelPolicyText,
  ONLINE_CANCEL_NOTE,
  ORGANIZER_CANCEL_NOTE,
  PAYMENT_NOTE_ONLINE,
  priceSummary,
} from '@/lib/money';
import type { CancelPolicy, Price } from '@/types/domain';

import styles from './PriceInfo.module.css';

interface PriceInfoProps {
  price: Price;
  confirmed: number;
  minParticipants: number | null;
  /** Только сумма — для карточки в ленте. */
  compact?: boolean;
  cancelPolicy?: CancelPolicy;
  startsAt?: string;
  paymentNote?: string;
  /** Оплата на сайте вместо «на месте». */
  online?: boolean;
}

/** Цена, доля при «скидываемся», как платить и правило отмены — до записи. */
export function PriceInfo({
  price,
  confirmed,
  minParticipants,
  compact,
  cancelPolicy,
  startsAt,
  paymentNote,
  online,
}: PriceInfoProps) {
  const summary = priceSummary(price, confirmed, minParticipants, online);
  if (compact)
    return (
      <span className={[styles.compact, summary.free && styles.free].filter(Boolean).join(' ')}>
        {summary.main}
      </span>
    );

  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <CurrencyRub size={22} aria-hidden className={styles.icon} />
        <div>
          <p className={styles.main}>{summary.main}</p>
          {summary.details.map((d) => (
            <p key={d} className={styles.detail}>
              {d}
            </p>
          ))}
          {!summary.free && (
            <p className={styles.detail}>
              {online
                ? PAYMENT_NOTE_ONLINE
                : paymentNote || 'Оплата на месте, организатору. Платформа деньги не принимает'}
            </p>
          )}
        </div>
      </div>
      {cancelPolicy && startsAt && (
        <div className={styles.row}>
          <ArrowCounterClockwise size={22} aria-hidden className={styles.icon} />
          <div>
            <p className={styles.mainSmall}>{cancelPolicyText(cancelPolicy, startsAt)}</p>
            {!summary.free && <p className={styles.detail}>{ORGANIZER_CANCEL_NOTE}</p>}
            {!summary.free && online && <p className={styles.detail}>{ONLINE_CANCEL_NOTE}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
