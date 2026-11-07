import { currentKey, postpone, remaining, type DeckState } from '@/components/SwipeDeck/deck';
import { count, WORDS } from '@/lib/plural';
import type { ParticipationStatus } from '@/types/domain';

import type { DecisionKind } from './decisionQueue';

/** Стопка заявок: «Решу позже» складывает карточки в хвост, итог показывается, когда остались только они. */
export interface ReviewState {
  deck: DeckState;
  later: string[];
}

/**
 * Обновление от стопки. Решение «вверх» — это «Решу позже»: карточка уходит в конец, а не в решённые.
 * Если отложить больше некуда, она остаётся последней, и стопка показывает итог.
 */
export function applyDeckUpdate(s: ReviewState, update: (deck: DeckState) => DeckState): ReviewState {
  const next = update(s.deck);
  const key = currentKey(s.deck);
  const postponed =
    key !== null && next.index === s.deck.index + 1 && next.decisions[key] === 'up' && !s.deck.decisions[key];
  if (!postponed) return next === s.deck ? s : { ...s, deck: next };
  const later = s.later.includes(key) ? s.later : [...s.later, key];
  const deck = remaining(s.deck) > 1 ? postpone(s.deck, key) : s.deck;
  return { deck, later };
}

/** Стопка пройдена: впереди нет ничего, кроме отложенных. */
export function passDone(s: ReviewState): boolean {
  return s.deck.order.slice(s.deck.index).every((k) => s.later.includes(k));
}

/** «Вернуться к отложенным»: отложенные снова в работе. */
export function reopenLater(s: ReviewState): ReviewState {
  return { ...s, later: [] };
}

/** Новые заявки встают в конец стопки, но перед отложенными. */
export function appendKeys(s: ReviewState, keys: readonly string[]): ReviewState {
  const fresh = keys.filter((k) => !s.deck.order.includes(k));
  if (!fresh.length) return s;
  const order = [...s.deck.order];
  let at = order.length;
  while (at > s.deck.index && s.later.includes(order[at - 1]!)) at -= 1;
  order.splice(at, 0, ...fresh);
  return { ...s, deck: { ...s.deck, order } };
}

/** Карточки, которые ещё ждут решения в этой стопке: текущая, следующие и отложенные. */
export const undecidedKeys = (s: ReviewState): string[] => s.deck.order.slice(s.deck.index);

/** Свободные места с учётом принятых в стопке, но ещё не учтённых сервером. */
export function freeSeats(seatsLeft: number | null, takenHere: number): number | null {
  if (seatsLeft === null) return null;
  return Math.max(0, seatsLeft - takenHere);
}

export function acceptBlock(need: number, free: number | null): string | null {
  if (free === null || need <= free) return null;
  if (free === 0) return need > 1 ? `Не хватает мест: нужно ${need}, свободных нет` : 'Свободных мест нет';
  return `Не хватает мест: нужно ${need}, свободно ${free}`;
}

export function seatsLine(capacity: number | null, free: number | null): string {
  if (capacity === null || free === null) return 'Мест без ограничения';
  return `Свободно ${free} из ${capacity}`;
}

export function decidedText(name: string, kind: DecisionKind): string {
  return `${name}: заявка ${kind === 'accept' ? 'принята' : 'отклонена'}`;
}

/** Почему карточка пропала из стопки, по статусу заявки после живого обновления. */
export function goneText(name: string, status: ParticipationStatus | null): string {
  switch (status) {
    case 'cancelled':
      return `${name}: заявку отозвали`;
    case 'waitlist':
      return `${name}: мест не осталось, заявка перешла в лист ожидания`;
    case 'confirmed':
    case 'rejected':
      return `${name}: эту заявку уже рассмотрели`;
    default:
      return `${name}: заявки больше нет`;
  }
}

export const newApplicationText = (name: string) => `Новая заявка: ${name}`;

const EVENT_DATIVE = ['событию', 'событиям', 'событиям'] as const;

/** «Новые заявки: 12 по 3 событиям». */
export function pendingSummary(applications: number, events: number): string {
  return `Новые заявки: ${applications} по ${count(events, EVENT_DATIVE)}`;
}

export function summaryLine(accepted: number, rejected: number, later: number): string {
  return `Принято ${accepted}, отклонено ${rejected}, отложено ${later}`;
}

export const applicationsCount = (n: number) => count(n, WORDS.application);
