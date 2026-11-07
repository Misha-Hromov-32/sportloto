import type { PersonShort } from './api';
import type { ID, ISODate, OrganizerRef } from './domain';

/**
 * Оплата на сайте (ЮKassa): платежи за участие во встречах и за вещи с полки, сбор сервиса,
 * балансы организаторов и продавцов, выплаты. Схема и правила — docs/features/payments.md.
 * Сервер — источник правды по суммам и статусам; интерфейс только показывает.
 */

/** Как платят за встречу: на месте или переводом (как раньше) либо на сайте. */
export type PaymentMode = 'offline' | 'online';

/** Способ оплаты, который человек выбирает на сайте. */
export type PayMethod = 'sbp' | 'bank_card';

/** За что платёж: доля во встрече или заказ вещи с полки. */
export type PaymentKind = 'event_share' | 'item_order';

export type PaymentProvider = 'disabled' | 'yookassa' | 'fake';

/**
 * - `pending` — человек на странице оплаты, деньги ещё не пришли;
 * - `held` — деньги на карте заморожены (складчина), спишем в момент сбора;
 * - `paid` — оплачено;
 * - `canceled` — оплата не прошла или заморозку сняли, денег не списали;
 * - `refunded`, `partially_refunded` — вернули всё или часть;
 * - `expired` — человек не завершил оплату вовремя.
 */
export type PaymentStatus =
  'pending' | 'held' | 'paid' | 'canceled' | 'refunded' | 'partially_refunded' | 'expired';

/** Из чего сложился сбор сервиса, в рублях с копейками. */
export interface FeeParts {
  /** Комиссия ЮKassa за приём выбранным способом. */
  bank: number;
  /** Комиссия за выплату получателю. */
  payout: number;
  /** Наценка платформы (5% с продажи вещей, у встреч 0). */
  platform: number;
  /** Остаток от округления до рубля: резерв на возвраты. */
  reserve: number;
}

// ---------- Настройки (админка «Оплата → Ставки») ----------

export interface PaymentSettings {
  /** Комиссия ЮKassa за приём, доля: 0.007 = 0,7%. */
  rates: Record<PayMethod, number>;
  /** Какие способы предлагать. */
  methods: PayMethod[];
  /** Выплата получателю: процент (доля) и фикс в рублях. */
  payoutPercent: number;
  payoutFixed: number;
  /** Наценка платформы с продажи вещей, доля: 0.05 = 5%. */
  goodsMarkup: number;
  /** Сколько минут держится место после записи на встречу с оплатой на сайте. */
  holdMinutes: number;
  /** Сколько часов на оплату после одобрения заявки. */
  approvalHours: number;
  /** За сколько дней до начала открывается оплата складчины (холд по карте живёт до 7 дней). */
  splitOpenDays: number;
  /** За сколько часов до начала собираем складчину: списываем итоговую долю. */
  collectHoursBefore: number;
  /** Через сколько дней после оплаты вещи деньги уходят продавцу, если покупатель не нажал «Получил». */
  autoCompleteDays: number;
  /** Сколько минут ждём завершения оплаты на странице ЮKassa. */
  pendingMinutes: number;
  /** Наименьшая сумма выплаты, ₽. */
  minPayout: number;
}

export type PaymentSettingsInput = Partial<PaymentSettings>;

// ---------- Расчёт суммы ----------

/** Сумма для одного способа: что получит организатор или продавец, сбор и итого к оплате. */
export interface QuoteLine {
  method: PayMethod;
  /** Получит организатор или продавец, ₽. */
  base: number;
  /** Сбор сервиса, ₽ (целые рубли). */
  fee: number;
  /** Итого к оплате, ₽. */
  total: number;
  feeParts: FeeParts;
  /**
   * Складчина: `hold` — по карте сумма замораживается, спишется итоговая доля;
   * `refund_diff` — по СБП списывается сразу, разница вернётся после сбора; `charge` — обычная оплата.
   */
  flow: 'charge' | 'hold' | 'refund_diff';
}

export interface QuoteView {
  kind: PaymentKind;
  /** Событие или вещь, для которой считали. */
  targetId: ID;
  /** Количество (для вещей), у встреч 1. */
  quantity: number;
  /** Наценка платформы: 0 у встреч, 0.05 у вещей. */
  markup: number;
  /** Складчина до сбора: платят наибольшую долю, итоговая будет не больше. */
  maxShare: number | null;
  lines: QuoteLine[];
}

// ---------- Платёж ----------

/** Хранимый платёж (коллекция `payments`). */
export interface Payment {
  id: ID;
  userId: ID;
  kind: PaymentKind;
  /** Событие (`event_share`) или заказ (`item_order`). */
  targetId: ID;
  method: PayMethod;
  base: number;
  fee: number;
  total: number;
  feeParts: FeeParts;
  /** Сколько заплатили или заморозили сначала (у складчины после сбора `total` меньше). */
  initialTotal: number;
  /** false — двухстадийный платёж (холд по карте). */
  capture: boolean;
  provider: PaymentProvider;
  providerPaymentId: string | null;
  status: PaymentStatus;
  capturedAmount: number;
  refundedAmount: number;
  confirmationUrl: string | null;
  /** Участник отменил запись позже срока: деньги остаются организатору. */
  forfeited: boolean;
  /** Когда доля зачислена получателю. */
  creditedAt: ISODate | null;
  /** Магазин ЮKassa тестовый: деньги не настоящие. */
  test: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
  paidAt: ISODate | null;
  /** Почему отменён или возвращён — понятный текст. */
  reason: string;
}

export type PaymentOpKind = 'capture' | 'cancel' | 'refund' | 'payout';
export type PaymentOpStatus = 'queued' | 'sending' | 'done' | 'failed';

/** Операция к ЮKassa в очереди (коллекция `paymentOps`): правила ставят, исполнитель выполняет. */
export interface PaymentOp {
  id: ID;
  kind: PaymentOpKind;
  paymentId: ID | null;
  payoutId: ID | null;
  /** Сумма списания или возврата, ₽; у отмены холда null. */
  amount: number | null;
  status: PaymentOpStatus;
  attempts: number;
  idempotenceKey: string;
  /** id возврата или выплаты в ЮKassa. */
  providerId: string | null;
  error: string;
  reason: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Требование оплатить участие (коллекция `paymentDues`). */
export interface PaymentDue {
  id: ID;
  eventId: ID;
  participationId: ID;
  userId: ID;
  /** Оплатить до. */
  dueAt: ISODate;
  /** Складчина: с какого момента можно платить. */
  opensAt: ISODate | null;
  notifiedAt: ISODate | null;
  status: 'open' | 'paid' | 'closed' | 'expired';
  createdAt: ISODate;
}

export interface PaymentOpView {
  id: ID;
  kind: PaymentOpKind;
  amount: number | null;
  status: PaymentOpStatus;
  attempts: number;
  error: string;
  reason: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Платёж для владельца: без служебных полей провайдера. */
export interface PaymentView {
  id: ID;
  kind: PaymentKind;
  targetId: ID;
  /** Что оплачивали: название встречи или вещи. */
  title: string;
  /** Куда вернуться после оплаты: карточка встречи или заказ. */
  link: string;
  method: PayMethod;
  base: number;
  fee: number;
  total: number;
  initialTotal: number;
  feeParts: FeeParts;
  capture: boolean;
  provider: PaymentProvider;
  status: PaymentStatus;
  capturedAmount: number;
  refundedAmount: number;
  /** Адрес страницы оплаты, пока платёж ждёт (`pending`). Провайдер fake: `/pay/fake/<id>`. */
  confirmationUrl: string | null;
  forfeited: boolean;
  test: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
  paidAt: ISODate | null;
  reason: string;
  /** Идут операции: списание, возврат, снятие холда (ЮKassa отвечает не сразу). */
  processing: boolean;
}

export interface AdminPaymentView extends PaymentView {
  user: PersonShort;
  providerPaymentId: string | null;
  creditedAt: ISODate | null;
  ops: PaymentOpView[];
  /** Сколько ещё можно вернуть, ₽. */
  refundable: number;
}

export interface PaymentInput {
  kind: PaymentKind;
  /** Событие для `event_share`, заказ для `item_order`. */
  targetId: ID;
  method: PayMethod;
}

/** Тестовая оплата (только провайдер fake): «Оплатить» или «Отказаться». */
export interface FakeOutcomeInput {
  outcome: 'succeeded' | 'canceled';
}

// ---------- Оплата участия: в карточке встречи (`my.payment`) ----------

/**
 * - `not_yet` — складчина, оплата откроется `opensAt`;
 * - `required` — нужно оплатить до `dueAt`;
 * - `pending` — оплата начата, `confirmationUrl` — продолжить;
 * - `held` — деньги заморожены, спишем итоговую долю в момент сбора;
 * - `paid` — оплачено;
 * - `refunded` — деньги вернули (полностью или долю);
 * - `canceled` — заморозку сняли, денег не списали;
 * - `expired` — срок оплаты вышел, запись отменена.
 */
export type MyPaymentStatus =
  'not_yet' | 'required' | 'pending' | 'held' | 'paid' | 'refunded' | 'canceled' | 'expired';

export interface MyPayment {
  status: MyPaymentStatus;
  priceKind: 'fixed' | 'split';
  /** Сколько получит организатор с этого человека сейчас: цена или доля. */
  base: number;
  /** Складчина до сбора: наибольшая доля (её и платят); после сбора — итоговая. */
  maxShare: number | null;
  finalShare: number | null;
  opensAt: ISODate | null;
  dueAt: ISODate | null;
  /** Момент сбора складчины. */
  collectAt: ISODate | null;
  /** Последний платёж человека за эту встречу. */
  payment: PaymentView | null;
  /** Можно нажать «Оплатить». */
  canPay: boolean;
  /** Почему платить нельзя или что будет дальше — готовый текст. */
  hint: string;
}

// ---------- Деньги встречи: для организатора и администратора ----------

export interface EventMoneyRow {
  participationId: ID;
  user: PersonShort;
  participationStatus: string;
  status: MyPaymentStatus;
  method: PayMethod | null;
  /** Сколько с этого человека получит организатор, ₽. */
  base: number;
  paidAt: ISODate | null;
  dueAt: ISODate | null;
}

export interface EventMoneyView {
  eventId: ID;
  title: string;
  paymentMode: PaymentMode;
  priceKind: 'free' | 'fixed' | 'split';
  /** Цена с человека или сумма складчины. */
  price: number;
  /** Сколько оплачено и заморожено (без сбора сервиса), ₽. */
  collected: number;
  /** Сколько ждём всего: цена × участники или сумма складчины. */
  expected: number;
  paidCount: number;
  heldCount: number;
  unpaidCount: number;
  /** Получит организатор после встречи, ₽. */
  toCredit: number;
  /** Уже зачислено, ₽. */
  credited: number;
  refunded: number;
  /** Складчина: когда открывается оплата и когда сбор. */
  opensAt: ISODate | null;
  collectAt: ISODate | null;
  collect: EventPayCollect | null;
  rows: EventMoneyRow[];
}

/** Итог сбора складчины (поле события `payCollect`). */
export interface EventPayCollect {
  at: ISODate;
  outcome: 'collected' | 'failed';
  /** Итоговая доля, ₽ (у неудачного сбора null). */
  share: number | null;
  paidCount: number;
}

// ---------- Покупка вещей с полки ----------

/** Вещь на полке продаётся: поле `sale` у ShelfItem. */
export interface ShelfSale {
  /** Цена за штуку, ₽ (получит продавец). */
  price: number;
}

export type OrderStatus = 'awaiting_payment' | 'paid' | 'received' | 'canceled' | 'refunded';

export interface Order {
  id: ID;
  itemId: ID;
  /** Название на момент покупки: вещь могут убрать с полки. */
  itemName: string;
  buyerId: ID;
  seller: OrganizerRef;
  quantity: number;
  /** Цена за штуку, ₽. */
  price: number;
  /** Получит продавец: цена × количество, ₽. */
  amount: number;
  paymentId: ID | null;
  status: OrderStatus;
  /** Оплатить до (потом заказ отменится и вещь вернётся на полку). */
  payDueAt: ISODate;
  /** Когда деньги уйдут продавцу, если покупатель не нажал «Получил». */
  autoCompleteAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  paidAt: ISODate | null;
  receivedAt: ISODate | null;
  canceledAt: ISODate | null;
  canceledBy: 'buyer' | 'seller' | 'admin' | 'system' | null;
  reason: string;
}

export interface OrderCounterpart {
  name: string;
  /** Телефон или почта — после оплаты, чтобы договориться о передаче. */
  contact: string | null;
  link: string;
}

export interface OrderView extends Order {
  buyer: PersonShort;
  sellerView: { kind: 'user' | 'org'; id: ID; name: string; link: string };
  payment: PaymentView | null;
  isBuyer: boolean;
  isSeller: boolean;
  /** С кем договариваться о передаче: покупателю — продавец, продавцу — покупатель. */
  counterpart: OrderCounterpart | null;
  can: { pay: boolean; received: boolean; cancel: boolean };
}

export interface BuyInput {
  quantity: number;
}

export interface OrderCancelInput {
  reason?: string;
}

// ---------- Балансы и выплаты ----------

/** Чей баланс: `user:u-1` или `org:o-1`. */
export type OwnerKey = string;

export interface Credit {
  id: ID;
  recipient: OrganizerRef;
  /** Сколько зачислено, ₽. */
  amount: number;
  source: 'event' | 'order';
  targetId: ID;
  title: string;
  at: ISODate;
}

export type PayoutStatus = 'requested' | 'processing' | 'done' | 'failed';

export interface Payout {
  id: ID;
  recipient: OrganizerRef;
  amount: number;
  status: PayoutStatus;
  method: 'sbp';
  /** Телефон, привязанный к СБП: +7XXXXXXXXXX. */
  phone: string;
  bankId: string;
  bankName: string;
  providerPayoutId: string | null;
  requestedBy: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
  doneAt: ISODate | null;
  /** Администратор, отметивший «Переведено» (ручной путь). */
  doneBy: ID | null;
  reason: string;
}

export interface PayoutView extends Payout {
  owner: BalanceOwner;
  /** Номер в виде «+7 912 ***-**-89». */
  phoneMasked: string;
}

export interface BalanceOwner {
  key: OwnerKey;
  kind: 'user' | 'org';
  id: ID;
  name: string;
}

/** Деньги, которые ещё не зачислены: встреча не прошла или вещь не получена. */
export interface PendingMoney {
  source: 'event' | 'order';
  targetId: ID;
  title: string;
  amount: number;
  /** Когда ожидается зачисление (конец встречи или автозавершение заказа). */
  availableAt: ISODate | null;
  link: string;
}

export interface BalanceSummary {
  owner: BalanceOwner;
  /** Можно вывести, ₽. */
  available: number;
  /** Ожидает зачисления, ₽. */
  pending: number;
}

export interface BalanceView extends BalanceSummary {
  /** Всего зачислено и всего выплачено (с выплатами в работе), ₽. */
  credited: number;
  paidOut: number;
  /** Выплаты в работе (запрошены или отправляются), ₽. */
  inPayout: number;
  credits: Credit[];
  pendingItems: PendingMoney[];
  payouts: PayoutView[];
  canPayout: boolean;
  /** Почему вывести нельзя — готовый текст. */
  payoutHint: string;
  minPayout: number;
  /** `auto` — выплата через ЮKassa «Выплаты», `manual` — переводит администратор. */
  payoutMode: 'auto' | 'manual';
}

export interface PayoutInput {
  owner: OwnerKey;
  /** Без суммы — весь доступный остаток. */
  amount?: number;
  phone: string;
  bankId: string;
}

export interface SbpBank {
  id: string;
  name: string;
}

// ---------- Администратор ----------

export interface ProviderStatus {
  provider: PaymentProvider;
  /** Тестовый магазин (ключ `test_…`) или провайдер fake: деньги не настоящие. */
  test: boolean;
  /** Ключи магазина заданы. */
  shopConfigured: boolean;
  /** Чеки от ЮKassa (54-ФЗ) прикладываются к платежам. */
  receipts: boolean;
  payouts: 'auto' | 'manual';
  /** Уведомления принимаются только с адресов ЮKassa. */
  checkIp: boolean;
}

export interface PaymentsOverview {
  provider: ProviderStatus;
  /** Оборот: всё, что заплатили люди, за вычетом возвратов, ₽. */
  turnover: number;
  /** Комиссия ЮKassa (оценка по ставкам), ₽. */
  bankFees: number;
  /** Сбор сервиса всего, ₽. */
  serviceFees: number;
  /** Наценка платформы с вещей, ₽. */
  platformIncome: number;
  /** Резерв от округления, ₽. */
  reserve: number;
  refunded: number;
  /** Сколько должны получателям: доступно к выводу у всех, ₽. */
  balancesDue: number;
  /** Ожидает зачисления у всех, ₽. */
  pendingCredits: number;
  /** Выплаты, ждущие перевода, ₽ и штук. */
  payoutsWaiting: number;
  payoutsWaitingCount: number;
  counts: { payments: number; paid: number; held: number; refunds: number; failedOps: number };
}

export interface AdminPaymentQuery {
  status?: PaymentStatus;
  kind?: PaymentKind;
  /** Поиск по названию, имени плательщика, номеру платежа. */
  q?: string;
}

export interface AdminRefundInput {
  /** Без суммы — всё, что можно вернуть. */
  amount?: number;
  reason: string;
}

export interface PayoutDoneInput {
  note?: string;
}

export interface PayoutFailInput {
  reason: string;
}
