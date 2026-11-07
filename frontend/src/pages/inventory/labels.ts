import {
  BasketballIcon,
  CheckerboardIcon,
  GridNineIcon,
  PackageIcon,
  PersonSimpleHikeIcon,
  PersonSimpleSkiIcon,
  RacquetIcon,
  RowsIcon,
  ShieldIcon,
  SoccerBallIcon,
  TennisBallIcon,
  TimerIcon,
  TrafficConeIcon,
  TShirtIcon,
  VolleyballIcon,
  type Icon,
} from '@phosphor-icons/react';

import { formatEventDate } from '@/lib/dates';
import type { StatusMeta } from '@/lib/labels';
import type { GearKind, LoanStatus, OfferStatus, ShelfCondition, ShelfTerm, SupportStatus } from '@/types/inventory';

export const GEAR_KIND: Record<GearKind, { label: string; icon: Icon }> = {
  ball: { label: 'Мячи', icon: SoccerBallIcon },
  racket: { label: 'Ракетки', icon: RacquetIcon },
  shuttle: { label: 'Воланы и мячики', icon: TennisBallIcon },
  bibs: { label: 'Манишки и форма', icon: TShirtIcon },
  mat: { label: 'Коврики', icon: RowsIcon },
  poles: { label: 'Палки для ходьбы', icon: PersonSimpleHikeIcon },
  net: { label: 'Сетки', icon: GridNineIcon },
  cones: { label: 'Фишки и конусы', icon: TrafficConeIcon },
  board: { label: 'Шахматы и шашки', icon: CheckerboardIcon },
  clock: { label: 'Часы и секундомеры', icon: TimerIcon },
  skis: { label: 'Лыжи и коньки', icon: PersonSimpleSkiIcon },
  protection: { label: 'Шлемы и защита', icon: ShieldIcon },
  other: { label: 'Другое', icon: PackageIcon },
};

export const GEAR_KIND_ORDER: GearKind[] = [
  'ball',
  'racket',
  'shuttle',
  'bibs',
  'mat',
  'poles',
  'net',
  'cones',
  'board',
  'clock',
  'skis',
  'protection',
  'other',
];

/** Мяч рисуем по названию: у волейбола и баскетбола свои значки. */
export function gearIcon(kind: GearKind, name = ''): Icon {
  if (kind === 'ball') {
    if (/волейб/i.test(name)) return VolleyballIcon;
    if (/баскет/i.test(name)) return BasketballIcon;
  }
  return GEAR_KIND[kind].icon;
}

export const CONDITION: Record<ShelfCondition, string> = {
  new: 'Новое',
  good: 'Хорошее',
  used: 'Поношенное, но целое',
};

export const TERM: Record<ShelfTerm, string> = {
  return_after: 'Вернуть после игры',
  no_deposit: 'Залог не нужен',
  pickup: 'Забрать у владельца',
  bring_to_place: 'Привезут на место',
  kids_only: 'Только для детских групп',
};

export const LOAN_STATUS: Record<LoanStatus, StatusMeta> = {
  pending: { label: 'Ждёт ответа владельца', tone: 'wait', icon: 'clock' },
  accepted: { label: 'Дадут на игру', tone: 'ok', icon: 'check' },
  rejected: { label: 'Отказали', tone: 'danger', icon: 'cross' },
  cancelled: { label: 'Просьба отменена', tone: 'off', icon: 'calendarX' },
  returned: { label: 'Вернули, выдача закрыта', tone: 'off', icon: 'arrowUUpLeft' },
};

/** Как статус видит владелец вещи. */
export const LOAN_STATUS_FOR_OWNER: Record<LoanStatus, StatusMeta> = {
  pending: { label: 'Ждёт вашего ответа', tone: 'wait', icon: 'clock' },
  accepted: { label: 'Выдали, ждём возврата', tone: 'ok', icon: 'check' },
  rejected: { label: 'Вы отказали', tone: 'off', icon: 'cross' },
  cancelled: { label: 'Просьбу отменили', tone: 'off', icon: 'calendarX' },
  returned: { label: 'Вернули', tone: 'off', icon: 'arrowUUpLeft' },
};

export const SUPPORT_STATUS: Record<SupportStatus, StatusMeta> = {
  open: { label: 'Нужна помощь', tone: 'wait', icon: 'clock' },
  closed: { label: 'Помогли', tone: 'ok', icon: 'check' },
  cancelled: { label: 'Просьба снята', tone: 'off', icon: 'calendarX' },
};

export const OFFER_STATUS: Record<OfferStatus, StatusMeta> = {
  pending: { label: 'Ждёт ответа клуба', tone: 'wait', icon: 'clock' },
  accepted: { label: 'Клуб принял помощь', tone: 'ok', icon: 'check' },
  declined: { label: 'Клуб выбрал другой вариант', tone: 'off', icon: 'cross' },
  withdrawn: { label: 'Отклик отозван', tone: 'off', icon: 'calendarX' },
};

/** Где взять, если ни у кого нет. Нейтральные подсказки, без названий магазинов. */
export const RENT_HINTS: { title: string; text: string }[] = [
  {
    title: 'Прокат спортинвентаря рядом',
    text: 'Во многих районах есть прокат при стадионах и парках: мячи, лыжи, коньки, ракетки выдают на день.',
  },
  {
    title: 'Спортивный зал или школа',
    text: 'Залы часто дают мячи и сетки вместе с арендой. Спросите у администратора, когда договариваетесь о времени.',
  },
  {
    title: 'Купить недорого',
    text: 'Простой мяч или воланы продаются в любом спортивном магазине. Покупку можно разделить на всех участников.',
  },
];

/** Название в кавычках, если своих кавычек в нём нет: «Спортмастерская», но ФК «Дворовые легенды». */
export function quoted(name: string): string {
  return name.includes('«') ? name : `«${name}»`;
}

/** Дата внутри предложения: «на «Стритбол», суббота, 24 октября, 17:00». */
export function dateInText(iso: string): string {
  const text = formatEventDate(iso);
  return text.charAt(0).toLowerCase() + text.slice(1);
}
