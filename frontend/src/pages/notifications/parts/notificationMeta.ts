import {
  ArrowFatLineUpIcon,
  ArrowUUpLeftIcon,
  BuildingsIcon,
  CalendarCheckIcon,
  CalendarXIcon,
  ChatCircleTextIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  EnvelopeSimpleIcon,
  EyeSlashIcon,
  HandWavingIcon,
  ProhibitIcon,
  QueueIcon,
  QuestionIcon,
  SealCheckIcon,
  TrashIcon,
  TrayIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XCircleIcon,
  type Icon,
} from '@phosphor-icons/react';
import { ArrowCounterClockwiseIcon, HandHeartIcon, HandshakeIcon, PackageIcon } from '@phosphor-icons/react';
import { WheelchairIcon } from '@phosphor-icons/react';
import { AlarmIcon, ArrowsLeftRightIcon, HourglassLowIcon, TicketIcon } from '@phosphor-icons/react';
import { HandWavingIcon as GreetIcon, LightningIcon, MegaphoneIcon, PlantIcon } from '@phosphor-icons/react'; // С1, С2, С3
import { FlagIcon, PauseCircleIcon, PlayCircleIcon, ShareFatIcon } from '@phosphor-icons/react'; // С16, С17, В8
import { HeartIcon, SealQuestionIcon, UserGearIcon } from '@phosphor-icons/react'; // С8, С14, С15
import { SparkleIcon } from '@phosphor-icons/react'; // подборка дня
import { ShieldCheckIcon, ShieldSlashIcon } from '@phosphor-icons/react'; // D-16 стоп-лист
import { BankIcon, CoinsIcon, CreditCardIcon, ReceiptXIcon, WalletIcon } from '@phosphor-icons/react'; // оплата

import { capitalize } from '@/lib/text';
import type { NotificationType } from '@/types/domain';

export type NoticeTone = 'ok' | 'wait' | 'off' | 'danger' | 'neutral' | 'accent';

export const NOTICE_META: Record<NotificationType, { icon: Icon; tone: NoticeTone; kind: string }> = {
  accepted: { icon: CheckCircleIcon, tone: 'ok', kind: 'Решение по заявке' },
  stop_listed: { icon: ShieldSlashIcon, tone: 'danger', kind: 'Организатор' }, // D-16
  removed_from_event: { icon: UserMinusIcon, tone: 'danger', kind: 'Ваша запись' },
  stop_lifted: { icon: ShieldCheckIcon, tone: 'ok', kind: 'Модерация' },
  rejected: { icon: XCircleIcon, tone: 'danger', kind: 'Решение по заявке' },
  waitlist_promoted: { icon: ArrowFatLineUpIcon, tone: 'ok', kind: 'Лист ожидания' },
  joined: { icon: UserPlusIcon, tone: 'ok', kind: 'Ваше событие' },
  left: { icon: UserMinusIcon, tone: 'off', kind: 'Ваше событие' },
  application: { icon: TrayIcon, tone: 'wait', kind: 'Ваше событие' },
  question: { icon: QuestionIcon, tone: 'neutral', kind: 'Обсуждение' },
  answer: { icon: ChatCircleTextIcon, tone: 'neutral', kind: 'Обсуждение' },
  changed: { icon: ClockCounterClockwiseIcon, tone: 'wait', kind: 'Изменения' },
  cancelled: { icon: CalendarXIcon, tone: 'off', kind: 'Изменения' },
  removed: { icon: ProhibitIcon, tone: 'danger', kind: 'Модерация' },
  restored: { icon: ArrowUUpLeftIcon, tone: 'ok', kind: 'Модерация' },
  deleted: { icon: TrashIcon, tone: 'off', kind: 'Модерация' },
  message_hidden: { icon: EyeSlashIcon, tone: 'off', kind: 'Модерация' },
  org_submitted: { icon: BuildingsIcon, tone: 'wait', kind: 'Организация' },
  org_approved: { icon: SealCheckIcon, tone: 'ok', kind: 'Организация' },
  org_rejected: { icon: XCircleIcon, tone: 'danger', kind: 'Организация' },
  org_returned: { icon: ArrowUUpLeftIcon, tone: 'wait', kind: 'Организация' },
  invite: { icon: EnvelopeSimpleIcon, tone: 'accent', kind: 'Приглашение' },
  metoo: { icon: HandWavingIcon, tone: 'neutral', kind: 'Ищу компанию' },
  gathered: { icon: UsersThreeIcon, tone: 'ok', kind: 'Ищу компанию' },
  threshold_reached: { icon: CalendarCheckIcon, tone: 'ok', kind: 'Сбор участников' },
  threshold_lost: { icon: WarningCircleIcon, tone: 'wait', kind: 'Сбор участников' },
  waitlist_joined: { icon: QueueIcon, tone: 'wait', kind: 'Лист ожидания' },
  appeal: { icon: ArrowUUpLeftIcon, tone: 'wait', kind: 'Модерация' },
  escort_needed: { icon: WheelchairIcon, tone: 'wait', kind: 'Ваше событие' }, // Н1
  // С4, С6, С9: место из листа ожидания, похожие встречи, напоминания
  waitlist_offer: { icon: TicketIcon, tone: 'accent', kind: 'Лист ожидания' },
  offer_expired: { icon: HourglassLowIcon, tone: 'off', kind: 'Лист ожидания' },
  reminder: { icon: AlarmIcon, tone: 'neutral', kind: 'Напоминание' },
  plan_b: { icon: ArrowsLeftRightIcon, tone: 'neutral', kind: 'Похожие встречи' },
  // В3 + С7: инвентарь и помощь партнёров
  gear_request: { icon: PackageIcon, tone: 'wait', kind: 'Инвентарь' },
  gear_accepted: { icon: CheckCircleIcon, tone: 'ok', kind: 'Инвентарь' },
  gear_rejected: { icon: XCircleIcon, tone: 'danger', kind: 'Инвентарь' },
  gear_cancelled: { icon: CalendarXIcon, tone: 'off', kind: 'Инвентарь' },
  gear_returned: { icon: ArrowCounterClockwiseIcon, tone: 'ok', kind: 'Инвентарь' },
  support_new: { icon: HandHeartIcon, tone: 'neutral', kind: 'Помощь клубам' },
  support_offer: { icon: HandshakeIcon, tone: 'wait', kind: 'Помощь клубам' },
  support_accepted: { icon: HandshakeIcon, tone: 'ok', kind: 'Помощь клубам' },
  support_declined: { icon: XCircleIcon, tone: 'off', kind: 'Помощь клубам' },
  // С1, С2, С3
  greeter: { icon: GreetIcon, tone: 'neutral', kind: 'Встреча новичков' },
  first_visit: { icon: PlantIcon, tone: 'accent', kind: 'Первый раз' },
  urgent: { icon: LightningIcon, tone: 'wait', kind: 'Срочно нужны игроки' },
  demand_offer: { icon: MegaphoneIcon, tone: 'accent', kind: 'Предложение клуба' },
  // С16, С17, В8: жалобы, приостановка допуска, страница сообщества
  report_upheld: { icon: FlagIcon, tone: 'ok', kind: 'Ваша жалоба' },
  report_dismissed: { icon: FlagIcon, tone: 'off', kind: 'Ваша жалоба' },
  org_suspended: { icon: PauseCircleIcon, tone: 'danger', kind: 'Организация' },
  org_resumed: { icon: PlayCircleIcon, tone: 'ok', kind: 'Организация' },
  import_transferred: { icon: ShareFatIcon, tone: 'ok', kind: 'Организация' },
  // С8, С14, С15: подписки, управляющие клуба, «Встреча состоялась?»
  new_match: { icon: HeartIcon, tone: 'accent', kind: 'Ваши подписки' },
  manager_added: { icon: UserGearIcon, tone: 'ok', kind: 'Организация' },
  manager_removed: { icon: UserGearIcon, tone: 'off', kind: 'Организация' },
  held_question: { icon: SealQuestionIcon, tone: 'wait', kind: 'Вопрос после встречи' },
  team: { icon: UsersThreeIcon, tone: 'neutral', kind: 'Запись командой' }, // Н3
  digest: { icon: SparkleIcon, tone: 'accent', kind: 'Подборка дня' },
  // Оплата на сайте
  pay_due: { icon: CreditCardIcon, tone: 'wait', kind: 'Оплата' },
  pay_received: { icon: CheckCircleIcon, tone: 'ok', kind: 'Оплата' },
  pay_refund: { icon: ArrowCounterClockwiseIcon, tone: 'neutral', kind: 'Возврат денег' },
  pay_expired: { icon: HourglassLowIcon, tone: 'off', kind: 'Оплата' },
  pay_collected: { icon: CoinsIcon, tone: 'ok', kind: 'Складчина' },
  pay_failed: { icon: ReceiptXIcon, tone: 'wait', kind: 'Складчина' },
  order_paid: { icon: PackageIcon, tone: 'accent', kind: 'Продажа' },
  order_done: { icon: CheckCircleIcon, tone: 'ok', kind: 'Продажа' },
  order_canceled: { icon: XCircleIcon, tone: 'off', kind: 'Покупка' },
  money_credited: { icon: WalletIcon, tone: 'ok', kind: 'Мои деньги' },
  payout_sent: { icon: BankIcon, tone: 'ok', kind: 'Мои деньги' },
  payout_failed: { icon: WarningCircleIcon, tone: 'danger', kind: 'Мои деньги' },
};

export interface ParsedChange {
  subject: string | null;
  items: { label: string; from: string; to: string }[];
}

/**
 * Достаёт «было → стало» из текста уведомления об изменении.
 * Текст собирает сервер; если формат не узнали, показываем текст как есть.
 */
export function parseChange(text: string): ParsedChange | null {
  const subject = text.match(/«[^»]+»/)?.[0] ?? null;
  const items: ParsedChange['items'] = [];
  const re = /(?:([а-яё ]+):\s*)?было (.+?), стало (.+?)(?=;\s|\.\s|\.$|$)/gi;
  for (const m of text.matchAll(re)) {
    items.push({ label: capitalize((m[1] ?? '').trim()), from: m[2]!.trim(), to: m[3]!.trim() });
  }
  return items.length ? { subject, items } : null;
}
