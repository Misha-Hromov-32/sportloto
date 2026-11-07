import type {
  FeeParts,
  MyPaymentStatus,
  OrderStatus,
  PayMethod,
  PaymentSettings,
  PaymentStatus,
  PayoutStatus,
  QuoteLine,
} from '@/types/payments';
import { useLiveGet } from './api';

export function usePaymentAvailability() {
  return useLiveGet<{ enabled: boolean }>('/payments/settings', ['payments']);
}

/**
 * Оплата на сайте: адреса API, расчёт сбора сервиса и подписи. Сервер считает суммы сам и сверяет их,
 * здесь та же формула — для мгновенной подсказки в форме (docs/features/payments.md, «Сбор сервиса»).
 */

export const PAYMENTS_API = {
  /** GET `?kind=event_share&targetId=<событие>` или `?kind=item_order&targetId=<вещь>&quantity=N` → `QuoteView`. */
  quote: '/payments/quote',
  /** POST `PaymentInput` → `PaymentView` с `confirmationUrl`: открыть страницу оплаты. */
  create: '/payments',
  /** GET → `PaymentView` (сервер дообновит статус из ЮKassa, если уведомление не дошло). */
  payment: (id: string) => `/payments/${id}`,
  /** POST `FakeOutcomeInput` — тестовая страница оплаты (только провайдер fake). */
  fakeOutcome: (id: string) => `/payments/${id}/fake`,
  /** GET → `PaymentView[]`: мои платежи, новые сверху. */
  mine: '/me/payments',
  /** GET → `SbpBank[]`: банки для выплаты по СБП. */
  sbpBanks: '/payments/sbp-banks',
  /** GET → `PaymentSettings`: ставки и сроки для мгновенной подсказки `quote()` (всем, без входа). */
  settings: '/payments/settings',
  /** GET → `EventMoneyView`: деньги встречи (организатор и администратор). */
  eventMoney: (eventId: string) => `/events/${eventId}/money`,
  /** POST `BuyInput` → `OrderView`: купить вещь с полки (дальше — POST create с `item_order`). */
  buy: (itemId: string) => `/shelf/${itemId}/buy`,
  /** GET `?role=buyer|seller` → `OrderView[]`. */
  orders: '/orders',
  order: (id: string) => `/orders/${id}`,
  /** POST → `OrderView`: покупатель получил вещь, деньги уходят продавцу. */
  orderReceived: (id: string) => `/orders/${id}/received`,
  /** POST `OrderCancelInput` → `OrderView`: отмена до передачи, полный возврат. */
  orderCancel: (id: string) => `/orders/${id}/cancel`,
  /** GET → `BalanceSummary[]`: мой баланс и балансы моих организаций. */
  balances: '/me/balances',
  /** GET `?owner=user:u-1|org:o-1` → `BalanceView`. */
  balance: '/me/balance',
  /** POST `PayoutInput` → `PayoutView`: вывести деньги по СБП. */
  payouts: '/me/payouts',
  admin: {
    /** GET → `PaymentsOverview`. */
    overview: '/admin/payments/overview',
    /** GET `AdminPaymentQuery` → `AdminPaymentView[]`. */
    payments: '/admin/payments',
    payment: (id: string) => `/admin/payments/${id}`,
    /** POST `AdminRefundInput` → `AdminPaymentView`. */
    refund: (id: string) => `/admin/payments/${id}/refund`,
    /** GET `?status=` → `PayoutView[]`. */
    payouts: '/admin/payouts',
    /** POST `PayoutDoneInput` — «Переведено» (ручной путь). */
    payoutDone: (id: string) => `/admin/payouts/${id}/done`,
    /** POST `PayoutFailInput` — «Не получилось», деньги возвращаются на баланс. */
    payoutFail: (id: string) => `/admin/payouts/${id}/fail`,
    /** GET → `PaymentSettings`; PUT `PaymentSettingsInput` → `PaymentSettings`. */
    settings: '/admin/payments/settings',
  },
} as const;

/** Ресурсы живых обновлений, после которых экранам оплаты стоит перечитать данные. */
export const PAYMENTS_LIVE = ['payments', 'events', 'participations', 'inventory', 'notifications', 'demo'];

/** Страница после возврата из ЮKassa и тестовая страница оплаты. */
export const payReturnPath = (paymentId: string) => `/pay/return?payment=${encodeURIComponent(paymentId)}`;
export const fakePayPath = (paymentId: string) => `/pay/fake/${paymentId}`;

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  rates: { sbp: 0.007, bank_card: 0.038 },
  methods: ['sbp', 'bank_card'],
  payoutPercent: 0,
  payoutFixed: 0,
  goodsMarkup: 0.05,
  holdMinutes: 20,
  approvalHours: 24,
  splitOpenDays: 7,
  collectHoursBefore: 2,
  autoCompleteDays: 3,
  pendingMinutes: 60,
  minPayout: 100,
};

/** Настройки администратора поверх значений по умолчанию. */
export function paymentSettings(stored?: Partial<PaymentSettings> | null): PaymentSettings {
  const s = { ...DEFAULT_PAYMENT_SETTINGS, ...(stored ?? {}) };
  return { ...s, rates: { ...DEFAULT_PAYMENT_SETTINGS.rates, ...(stored?.rates ?? {}) } };
}

/** До копеек: Math.round, а не к чётному — так же на сервере. */
export const kop = (value: number) => Math.round(value * 100) / 100;

/**
 * Итого к оплате: `T = ceil_руб((B·(1 + p) + f + m·B) / (1 − r))`, сбор = T − B.
 * `markup` — наценка платформы `m` (0 у встреч, `goodsMarkup` у вещей).
 * Перед округлением до рубля сумма приводится к копейкам: ошибка двоичной дроби не добавит рубль.
 */
export function quote(
  base: number,
  method: PayMethod,
  settings: PaymentSettings,
  markup = 0,
): Omit<QuoteLine, 'flow'> {
  const r = settings.rates[method];
  const p = settings.payoutPercent;
  const f = settings.payoutFixed;
  const raw = (base * (1 + p) + f + markup * base) / (1 - r);
  const total = Math.ceil(kop(raw));
  const feeParts: FeeParts = {
    bank: kop(total * r),
    payout: kop(base * p + f),
    platform: kop(markup * base),
    reserve: 0,
  };
  feeParts.reserve = kop(total - base - feeParts.bank - feeParts.payout - feeParts.platform);
  return { method, base, fee: total - base, total, feeParts };
}

/** Наибольшая доля складчины: при пороге сбора (меньше людей — встреча не состоится). */
export const splitMaxShare = (total: number, minParticipants: number) =>
  Math.ceil(total / Math.max(minParticipants, 1));

/** Итоговая доля: сумма делится на всех, кто оплатил. */
export const splitFinalShare = (total: number, paidCount: number) =>
  Math.ceil(total / Math.max(paidCount, 1));

// ---------- Подписи ----------

const NB = ' ';

/** «312 ₽», «8,40 ₽» — с копейками, только если они есть. */
export function formatMoney(amount: number): string {
  const whole = Number.isInteger(amount);
  return `${amount.toLocaleString('ru-RU', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}${NB}₽`;
}

/** «0,7%». */
export const formatRate = (rate: number) =>
  `${(Math.round(rate * 10_000) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  sbp: 'СБП',
  bank_card: 'Банковская карта',
};

export const PAY_METHOD_HINT: Record<PayMethod, string> = {
  sbp: 'Через приложение вашего банка. Сбор меньше',
  bank_card: 'Мир, Visa или Mastercard',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Ждём оплату',
  held: 'Деньги заморожены',
  paid: 'Оплачено',
  canceled: 'Не списано',
  refunded: 'Деньги вернули',
  partially_refunded: 'Часть вернули',
  expired: 'Срок оплаты вышел',
};

export const MY_PAYMENT_STATUS_LABEL: Record<MyPaymentStatus, string> = {
  not_yet: 'Оплата ещё не открыта',
  required: 'Нужно оплатить',
  pending: 'Ждём оплату',
  held: 'Деньги заморожены',
  paid: 'Оплачено',
  refunded: 'Деньги вернули',
  canceled: 'Не списано',
  expired: 'Срок оплаты вышел',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: 'Ждёт оплаты',
  paid: 'Оплачено, договоритесь о передаче',
  received: 'Получено',
  canceled: 'Отменён',
  refunded: 'Деньги вернули',
};

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  requested: 'Ждёт перевода',
  processing: 'Отправляем',
  done: 'Переведено',
  failed: 'Не получилось',
};

/** Строки «из чего сумма» для подсказки под кнопкой оплаты. */
export function feeBreakdown(
  line: Pick<QuoteLine, 'base' | 'fee' | 'total' | 'feeParts'>,
  forWhom: 'event' | 'item',
) {
  const rows = [
    { label: forWhom === 'event' ? 'Организатору' : 'Продавцу', amount: line.base },
    { label: 'Комиссия банка и выплаты', amount: kop(line.feeParts.bank + line.feeParts.payout) },
  ];
  if (line.feeParts.platform > 0) rows.push({ label: 'Сервису', amount: line.feeParts.platform });
  if (line.feeParts.reserve > 0) rows.push({ label: 'Округление', amount: line.feeParts.reserve });
  return { rows, fee: line.fee, total: line.total };
}

/** Телефон для СБП: `+7XXXXXXXXXX` или null. Принимает «8 912…», «+7 (912)…», «912…». */
export function normalizeSbpPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 11 && (digits[0] === '7' || digits[0] === '8') ? digits.slice(1) : digits;
  return ten.length === 10 && ten[0] === '9' ? `+7${ten}` : null;
}
