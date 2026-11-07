import type { OrganizationView } from '@/types/api';
import type { AiFlag, AuditAction, AuditEntry } from '@/types/domain';

/** Подписи действий без рода: в журнале действуют и администраторы, и организаторы. */
export const AUDIT_ACTION: Record<AuditAction, string> = {
  'org.approve': 'Допуск организации',
  'org.reject': 'Отказ организации',
  'org.return': 'Возврат на доработку',
  'event.remove': 'Снятие с публикации',
  'event.restore': 'Возврат в публикацию',
  'event.delete': 'Удаление события',
  'event.cancel': 'Отмена события организатором',
  'event.reschedule': 'Перенос события',
  'message.hide': 'Скрытие сообщения',
  'message.restore': 'Возврат сообщения',
  'sport.create': 'Новое направление',
  'sport.promote': 'Направление в каталог',
  'sport.merge': 'Объединение направлений',
  'participation.accept': 'Заявка участника принята',
  'participation.reject': 'Заявка участника отклонена',
  'event.appeal': 'Просьба вернуть событие',
  'event.keep': 'Пометка помощника снята',
  'message.keep': 'Сообщение оставлено',
  // С16, С17, В8
  'report.uphold': 'Жалоба подтверждена',
  'report.dismiss': 'Жалоба отклонена',
  'org.suspend': 'Допуск приостановлен',
  'org.resume': 'Допуск возобновлён',
  'import.publish': 'Публикация из сообщества',
  'import.reject': 'Пост сообщества отклонён',
  'import.transfer': 'Страница передана сообществу',
  // D-16
  'stop.add': 'Добавление в стоп-лист',
  'stop.update': 'Изменение записи в стоп-листе',
  'stop.remove': 'Удаление из стоп-листа',
  'stop.lift': 'Запрет снят администратором',
  'participation.remove': 'Участник убран из встречи',
  // Оплата на сайте
  'payment.refund': 'Возврат денег',
  'payout.done': 'Выплата переведена',
  'payout.fail': 'Выплата не прошла',
  'payments.settings': 'Изменены ставки оплаты',
};

export const AUDIT_GROUPS: { value: string; label: string }[] = [
  { value: 'org.', label: 'Организации' },
  { value: 'event.', label: 'События' },
  { value: 'message.', label: 'Сообщения' },
  { value: 'sport.', label: 'Направления' },
  { value: 'participation.', label: 'Заявки участников' },
  { value: 'report.', label: 'Жалобы' }, // С16
  { value: 'import.', label: 'Из сообществ' }, // В8
  { value: 'stop.', label: 'Стоп-листы' }, // D-16
  { value: 'pay', label: 'Оплата' },
];

/** Куда вести из журнала: карточка в админке, если она есть. */
export function auditTargetLink(
  entry: Pick<AuditEntry, 'targetType' | 'targetId' | 'action'>,
): string | null {
  switch (entry.targetType) {
    case 'org':
      return `/admin/organizations/${entry.targetId}`;
    case 'event':
      return `/admin/events/${entry.targetId}`;
    case 'message':
      return `/admin/messages?tab=${entry.action === 'message.hide' ? 'hidden' : 'all'}`;
    case 'sport':
      return '/admin/sports';
    case 'import': // В8
      return '/admin/imports';
    case 'payment':
      return `/admin/payments?tab=payments&q=${encodeURIComponent(entry.targetId)}`;
    case 'payout':
      return '/admin/payments?tab=payouts';
    case 'settings':
      return entry.action === 'payments.settings' ? '/admin/payments?tab=settings' : null;
    default:
      return null;
  }
}

export type FlagSubject = 'org' | 'event' | 'message';

const SUSPICIOUS: Record<FlagSubject, string> = {
  org: 'Похоже на подозрительную заявку',
  event: 'Похоже на подозрительное событие',
  message: 'Похоже на подозрительное сообщение',
};

export function flagTitle(flag: AiFlag, subject: FlagSubject): string {
  if (flag === 'spam') return 'Похоже на спам или рекламу';
  if (flag === 'toxic') return 'Похоже на грубость';
  return SUSPICIOUS[subject];
}

export const REJECT_TEMPLATES = [
  'Похоже на рекламу, а не на совместные занятия (правило 1).',
  'Непонятно, какие занятия вы проводите, для кого и какого уровня.',
  'Нет способа связаться: укажите телефон или почту.',
  'Такая организация уже есть на платформе.',
];

export const RETURN_TEMPLATES = [
  'Укажите адрес, где проходят занятия, и как туда попасть.',
  'Добавьте телефон для связи.',
  'Расскажите подробнее о занятиях: для кого, какой уровень, как часто.',
];

export const HIDE_TEMPLATES = [
  'Реклама, не относится к событию.',
  'Грубость по отношению к участникам.',
  'Повторяющиеся сообщения со ссылками.',
];

/** Когда заявку последний раз отправили на проверку. */
export function submittedAt(o: Pick<OrganizationView, 'reviews' | 'createdAt'>): string {
  const sent = [...o.reviews].reverse().find((r) => r.decision === 'submitted');
  return sent?.at ?? o.createdAt;
}

/** Название в кавычках, если своих кавычек в нём нет: «Енисей» уже внутри «Беговой клуб «Енисей»». */
export function quoted(name: string): string {
  return /[«»"]/.test(name) ? name : `«${name}»`;
}
