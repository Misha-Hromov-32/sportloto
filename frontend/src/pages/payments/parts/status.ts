import type { StatusMeta } from '@/lib/labels';
import {
  MY_PAYMENT_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYOUT_STATUS_LABEL,
} from '@/lib/payments';
import type { MyPaymentStatus, OrderStatus, PaymentStatus, PayoutStatus } from '@/types/payments';

export const PAYMENT_STATUS: Record<PaymentStatus, StatusMeta> = {
  pending: { label: PAYMENT_STATUS_LABEL.pending, tone: 'wait', icon: 'clock' },
  held: { label: PAYMENT_STATUS_LABEL.held, tone: 'wait', icon: 'lock' },
  paid: { label: PAYMENT_STATUS_LABEL.paid, tone: 'ok', icon: 'check' },
  canceled: { label: PAYMENT_STATUS_LABEL.canceled, tone: 'off', icon: 'cross' },
  refunded: { label: PAYMENT_STATUS_LABEL.refunded, tone: 'off', icon: 'arrowUUpLeft' },
  partially_refunded: { label: PAYMENT_STATUS_LABEL.partially_refunded, tone: 'off', icon: 'arrowUUpLeft' },
  expired: { label: PAYMENT_STATUS_LABEL.expired, tone: 'off', icon: 'history' },
};

export const MY_PAYMENT_STATUS: Record<MyPaymentStatus, StatusMeta> = {
  not_yet: { label: MY_PAYMENT_STATUS_LABEL.not_yet, tone: 'off', icon: 'clock' },
  required: { label: MY_PAYMENT_STATUS_LABEL.required, tone: 'wait', icon: 'clock' },
  pending: { label: MY_PAYMENT_STATUS_LABEL.pending, tone: 'wait', icon: 'clock' },
  held: { label: MY_PAYMENT_STATUS_LABEL.held, tone: 'wait', icon: 'lock' },
  paid: { label: MY_PAYMENT_STATUS_LABEL.paid, tone: 'ok', icon: 'check' },
  refunded: { label: MY_PAYMENT_STATUS_LABEL.refunded, tone: 'off', icon: 'arrowUUpLeft' },
  canceled: { label: MY_PAYMENT_STATUS_LABEL.canceled, tone: 'off', icon: 'cross' },
  expired: { label: MY_PAYMENT_STATUS_LABEL.expired, tone: 'off', icon: 'history' },
};

export const ORDER_STATUS: Record<OrderStatus, StatusMeta> = {
  awaiting_payment: { label: ORDER_STATUS_LABEL.awaiting_payment, tone: 'wait', icon: 'clock' },
  paid: { label: 'Оплачено', tone: 'ok', icon: 'check' },
  received: { label: ORDER_STATUS_LABEL.received, tone: 'ok', icon: 'check' },
  canceled: { label: ORDER_STATUS_LABEL.canceled, tone: 'off', icon: 'cross' },
  refunded: { label: ORDER_STATUS_LABEL.refunded, tone: 'off', icon: 'arrowUUpLeft' },
};

export const PAYOUT_STATUS: Record<PayoutStatus, StatusMeta> = {
  requested: { label: PAYOUT_STATUS_LABEL.requested, tone: 'wait', icon: 'clock' },
  processing: { label: PAYOUT_STATUS_LABEL.processing, tone: 'wait', icon: 'clock' },
  done: { label: PAYOUT_STATUS_LABEL.done, tone: 'ok', icon: 'check' },
  failed: { label: PAYOUT_STATUS_LABEL.failed, tone: 'danger', icon: 'cross' },
};

/** Текст сервера как предложение: с точкой в конце. */
export function sentence(text: string): string {
  const t = text.trim();
  return !t || /[.!?…]$/.test(t) ? t : `${t}.`;
}
