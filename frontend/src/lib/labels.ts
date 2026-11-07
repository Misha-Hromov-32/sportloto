import type {
  Composition,
  EventLevel,
  EventState,
  Gender,
  Intensity,
  JoinMode,
  OrgStatus,
  OrgType,
  ParticipationStatus,
  Readiness,
  SkillLevel,
} from '@/types/domain';

/** Единый словарь подписей. Одно состояние называется одинаково на всех экранах. */

export type StatusTone = 'ok' | 'wait' | 'off' | 'danger' | 'neutral' | 'accent';

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  /** Ключ иконки для StatusBadge. */
  icon: StatusIcon;
}

export type StatusIcon =
  | 'check'
  | 'clock'
  | 'queue'
  | 'cross'
  | 'ban'
  | 'calendarX'
  | 'history'
  | 'shield'
  | 'arrowUUpLeft'
  | 'pencil'
  | 'lock'
  | 'play'
  | 'eyeSlash'
  | 'trash';

export const PARTICIPATION_STATUS: Record<ParticipationStatus, StatusMeta> = {
  confirmed: { label: 'Вы участник', tone: 'ok', icon: 'check' },
  pending: { label: 'Заявка на рассмотрении', tone: 'wait', icon: 'clock' },
  waitlist: { label: 'Вы в листе ожидания', tone: 'wait', icon: 'queue' },
  rejected: { label: 'Заявка отклонена', tone: 'danger', icon: 'cross' },
  cancelled: { label: 'Вы отменили запись', tone: 'off', icon: 'calendarX' },
  event_removed: { label: 'Запись приостановлена', tone: 'off', icon: 'ban' },
  removed: { label: 'Организатор убрал вас из участников', tone: 'danger', icon: 'ban' }, // D-16
};

/** Как статус записи видит организатор в списке участников. */
export const PARTICIPATION_STATUS_FOR_ORGANIZER: Record<ParticipationStatus, StatusMeta> = {
  confirmed: { label: 'Участник', tone: 'ok', icon: 'check' },
  pending: { label: 'Ждёт решения', tone: 'wait', icon: 'clock' },
  waitlist: { label: 'В листе ожидания', tone: 'wait', icon: 'queue' },
  rejected: { label: 'Отклонена', tone: 'danger', icon: 'cross' },
  cancelled: { label: 'Отменил запись', tone: 'off', icon: 'calendarX' },
  event_removed: { label: 'Запись приостановлена', tone: 'off', icon: 'ban' },
  removed: { label: 'Убран из участников', tone: 'danger', icon: 'ban' }, // D-16
};

export const EVENT_STATE: Record<EventState, StatusMeta> = {
  upcoming: { label: 'Идёт запись', tone: 'ok', icon: 'check' },
  live: { label: 'Уже идёт', tone: 'accent', icon: 'play' },
  past: { label: 'Прошло', tone: 'off', icon: 'history' },
  cancelled: { label: 'Отменено организатором', tone: 'off', icon: 'calendarX' },
  removed: { label: 'Снято модератором', tone: 'danger', icon: 'ban' },
  deleted: { label: 'Удалено', tone: 'off', icon: 'trash' },
};

export const ORG_STATUS: Record<OrgStatus, StatusMeta> = {
  draft: { label: 'Черновик', tone: 'neutral', icon: 'pencil' },
  pending: { label: 'На рассмотрении', tone: 'wait', icon: 'clock' },
  approved: { label: 'Допущена', tone: 'ok', icon: 'shield' },
  rejected: { label: 'Отклонена', tone: 'danger', icon: 'cross' },
  returned: { label: 'Возвращена на доработку', tone: 'wait', icon: 'arrowUUpLeft' },
  blocked: { label: 'Заблокирована', tone: 'danger', icon: 'lock' },
};

export const MESSAGE_HIDDEN: StatusMeta = { label: 'Скрыто модератором', tone: 'off', icon: 'eyeSlash' };

export const ORG_TYPE: Record<OrgType, string> = {
  club: 'Клуб',
  circle: 'Кружок или секция',
  federation: 'Федерация',
  company: 'Компания',
  school: 'Спортивная школа',
  coach: 'Тренер или авторская школа',
  initiative: 'Инициативная группа',
  sponsor: 'Спонсор или партнёр',
  venue: 'Площадка',
};

export const SKILL_LEVEL: Record<SkillLevel, string> = {
  beginner: 'Новичок',
  amateur: 'Любитель',
  experienced: 'Опытный',
};

export const EVENT_LEVEL: Record<EventLevel, string> = {
  any: 'Любой уровень',
  beginner: 'Для новичков',
  amateur: 'Для любителей',
  experienced: 'Для опытных',
};

/** Уровень простыми словами — для паспорта «Первый шаг». */
export const EVENT_LEVEL_HINT: Record<EventLevel, string> = {
  any: 'Подойдёт и тем, кто пробует впервые, и тем, кто давно занимается',
  beginner: 'Учим с нуля, опыт не нужен',
  amateur: 'Нужно знать правила и немного играть',
  experienced: 'Играем в хорошем темпе, нужен опыт',
};

export const INTENSITY: Record<Intensity, { label: string; hint: string }> = {
  low: { label: 'Спокойно', hint: 'Можно разговаривать, перерывы по желанию' },
  medium: { label: 'Умеренно', hint: 'Немного запыхаетесь, перерывы есть' },
  high: { label: 'Интенсивно', hint: 'Серьёзная нагрузка, нужна подготовка' },
};

export const JOIN_MODE: Record<JoinMode, { label: string; hint: string; action: string }> = {
  open: {
    label: 'Свободная запись',
    hint: 'Вы участник сразу, ждать ответа не нужно',
    action: 'Записаться',
  },
  approval: {
    label: 'Запись по заявке',
    hint: 'Организатор посмотрит заявку и ответит. До ответа вы ещё не участник',
    action: 'Отправить заявку',
  },
};

export const READINESS: Record<Readiness, { label: string; hint: string }> = {
  join: { label: 'Готов присоединиться', hint: 'Ищу, к кому пойти' },
  organize: { label: 'Хочу организовать', hint: 'Соберу встречу, если найдутся люди' },
};

/** В7: состав события. `tag` — короткая метка для карточки, у смешанного метки нет. */
export const COMPOSITION: Record<Composition, { label: string; hint: string; tag: string | null }> = {
  mixed: { label: 'Смешанный', hint: 'Записаться может любой', tag: null },
  women: {
    label: 'Только женщины',
    hint: 'Записаться могут те, кто указал в профиле женский пол',
    tag: 'Только женщины',
  },
  men: {
    label: 'Только мужчины',
    hint: 'Записаться могут те, кто указал в профиле мужской пол',
    tag: 'Только мужчины',
  },
};

/** В7: пол в профиле. Указывать необязательно. */
export const GENDER: Record<Gender, string> = {
  female: 'Женский',
  male: 'Мужской',
};
