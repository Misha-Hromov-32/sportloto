import { capitalize } from '@/lib/text';
import { dayjs, weekendRange } from '@/lib/dates';
import type { StatusMeta } from '@/lib/labels';
import { PARTICIPATION_STATUS } from '@/lib/labels';
import { count, plural, WORDS } from '@/lib/plural';
import type { EventView, SportView } from '@/types/api';

import { offerTitle } from '../../events/event/participation/offer';

/** Причина из данных как законченное предложение: без двойной точки. */
export function sentence(text: string): string {
  const t = text.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

export type MyTab = 'upcoming' | 'requests' | 'organizing' | 'past';

export const MY_TABS: MyTab[] = ['upcoming', 'requests', 'organizing', 'past'];

/** В какую вкладку «Моих занятий» попадает событие, где человек участник или подал заявку. */
export function participationTab(e: EventView): MyTab | null {
  const status = e.my?.status;
  if (!status || status === 'cancelled') return null;
  // D-16: организатор убрал из участников — среди прошедших и отменённых, с причиной
  if (status === 'removed') return e.state === 'deleted' ? null : 'past';
  // Удалённое остаётся среди предстоящих с пометкой: и у записавшихся, и у тех, кто ждал решения или места
  if (e.state === 'deleted') return status === 'rejected' ? null : 'upcoming';
  if (e.state === 'past') return status === 'confirmed' ? 'past' : null;
  // С4: придержанное место ждёт ответа — показываем среди предстоящих, рядом с остальными занятиями
  if (status === 'waitlist' && e.my?.offerUntil) return 'upcoming';
  if (status === 'pending' || status === 'waitlist' || status === 'rejected') return 'requests';
  return 'upcoming';
}

export interface DateGroup<T> {
  key: string;
  label: string;
  hint: string | null;
  items: T[];
}

/** «Сегодня», «Завтра», «В эти выходные», дальше по дням. Порядок — по времени начала. */
export function groupUpcoming<T extends { startsAt: string }>(items: T[], now = dayjs()): DateGroup<T>[] {
  const [satStart, sunEnd] = weekendRange(now);
  const groups = new Map<string, DateGroup<T>>();
  const sorted = [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const item of sorted) {
    const d = dayjs(item.startsAt);
    let key: string;
    let label: string;
    let hint: string | null;
    if (d.isSame(now, 'day') || d.isBefore(now, 'day')) {
      key = 'today';
      label = 'Сегодня';
      hint = now.format('D MMMM, dddd');
    } else if (d.isSame(now.add(1, 'day'), 'day')) {
      key = 'tomorrow';
      label = 'Завтра';
      hint = now.add(1, 'day').format('D MMMM, dddd');
    } else if (!d.isBefore(satStart) && !d.isAfter(sunEnd)) {
      key = 'weekend';
      label = 'В эти выходные';
      hint = `${satStart.format('D')}–${sunEnd.format('D MMMM')}`;
    } else {
      key = d.format('YYYY-MM-DD');
      label = capitalize(d.format('dddd'));
      hint = d.format(d.isSame(now, 'year') ? 'D MMMM' : 'D MMMM YYYY');
    }
    const group = groups.get(key) ?? { key, label, hint, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** История: по месяцам, свежие сверху. */
export function groupByMonth<T extends { startsAt: string }>(items: T[], now = dayjs()): DateGroup<T>[] {
  const groups = new Map<string, DateGroup<T>>();
  const sorted = [...items].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  for (const item of sorted) {
    const d = dayjs(item.startsAt);
    const key = d.format('YYYY-MM');
    const label = capitalize(d.format(d.isSame(now, 'year') ? 'MMMM' : 'MMMM YYYY'));
    const group = groups.get(key) ?? { key, label, hint: null, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export type NextAction =
  | { kind: 'route' }
  | { kind: 'ack' }
  | { kind: 'withdraw' }
  | { kind: 'leaveQueue' }
  | { kind: 'manage'; attention: boolean }
  | { kind: 'findOther' }
  | { kind: 'open' }
  /** С4: «Иду» / «Отказаться» для придержанного места. */
  | { kind: 'offer' }
  /** С6: похожие встречи взамен отменённой. */
  | { kind: 'planB' };

export interface RowStatus {
  meta: StatusMeta;
  /** Пояснение под статусом: причина, позиция, что будет дальше. */
  detail: string | null;
  /** Было → стало для неподтверждённых изменений. */
  changes: { label: string; from: string; to: string }[];
  action: NextAction;
}

const CHANGED: StatusMeta = { label: 'Изменилось, подтвердите', tone: 'wait', icon: 'history' };
const REMOVED: StatusMeta = { label: 'Снято модератором', tone: 'danger', icon: 'ban' };
const DELETED: StatusMeta = { label: 'Событие удалено', tone: 'danger', icon: 'ban' };
const CANCELLED: StatusMeta = { label: 'Отменено организатором', tone: 'off', icon: 'calendarX' };
const LIVE: StatusMeta = { label: 'Уже идёт', tone: 'accent', icon: 'play' };
const ATTENDED: StatusMeta = { label: 'Вы были', tone: 'off', icon: 'check' };

/** Статус строки «Моих занятий» словами и одно следующее действие. */
export function participantStatus(e: EventView): RowStatus {
  const my = e.my!;
  const none = { changes: [] };
  if (my.status === 'removed') {
    return {
      ...none,
      meta: PARTICIPATION_STATUS.removed,
      detail: my.removedReason ? `Причина: ${sentence(my.removedReason)}` : null,
      action: { kind: 'findOther' },
    };
  }
  if (e.state === 'deleted') {
    return {
      ...none,
      meta: DELETED,
      detail: [
        e.moderation?.comment ? `Причина: ${sentence(e.moderation.comment)}` : null,
        'Встречи не будет, запись больше не действует.',
      ]
        .filter(Boolean)
        .join(' '),
      action: { kind: 'findOther' },
    };
  }
  if (e.state === 'removed' || my.status === 'event_removed') {
    return {
      ...none,
      meta: REMOVED,
      detail: [
        e.moderation?.comment ? `Причина: ${sentence(e.moderation.comment)}` : null,
        'Запись приостановлена: если событие вернут, она восстановится сама.',
      ]
        .filter(Boolean)
        .join(' '),
      action: { kind: 'findOther' },
    };
  }
  if (e.state === 'cancelled') {
    const paid = e.price.kind !== 'free' && my.status === 'confirmed';
    return {
      ...none,
      meta: CANCELLED,
      detail: [
        e.cancelReason ? `Причина: ${sentence(e.cancelReason)}` : null,
        paid ? 'Если вы платили, деньги вернут полностью.' : null,
      ]
        .filter(Boolean)
        .join(' '),
      action: { kind: 'planB' },
    };
  }
  if (e.state === 'past') {
    return { ...none, meta: ATTENDED, detail: null, action: { kind: 'open' } };
  }
  switch (my.status) {
    case 'confirmed': {
      const pending = e.changes.filter((c) => my.unackedChangeIds.includes(c.id));
      if (pending.length) {
        return {
          meta: CHANGED,
          detail: 'Организатор изменил событие. Нажмите «Я в курсе», чтобы он знал, что вы видели.',
          changes: pending.flatMap((c) => c.items),
          action: { kind: 'ack' },
        };
      }
      if (e.state === 'live') {
        return { ...none, meta: LIVE, detail: 'Вас ждут на месте.', action: { kind: 'route' } };
      }
      return { ...none, meta: PARTICIPATION_STATUS.confirmed, detail: null, action: { kind: 'route' } };
    }
    case 'pending':
      return {
        ...none,
        meta: PARTICIPATION_STATUS.pending,
        detail: 'Вы ещё не участник. Ответ организатора появится здесь и в уведомлениях.',
        action: { kind: 'withdraw' },
      };
    case 'waitlist':
      if (my.offerUntil) {
        return {
          ...none,
          meta: { label: offerTitle(my.offerUntil), tone: 'accent', icon: 'clock' },
          detail: 'Освободилось место. Подтвердите, что придёте, иначе оно перейдёт следующему в очереди.',
          action: { kind: 'offer' },
        };
      }
      return {
        ...none,
        meta: {
          ...PARTICIPATION_STATUS.waitlist,
          label: my.waitlistPosition
            ? `${PARTICIPATION_STATUS.waitlist.label}, ${my.waitlistPosition}-й`
            : PARTICIPATION_STATUS.waitlist.label,
        },
        detail:
          e.joinMode === 'open'
            ? 'Если место освободится, его придержат за вами и пришлют уведомление.'
            : 'Если место освободится, ваша заявка уйдёт организатору.',
        action: { kind: 'leaveQueue' },
      };
    case 'rejected':
      return {
        ...none,
        meta: PARTICIPATION_STATUS.rejected,
        detail: my.rejectReason ? `Причина: ${sentence(my.rejectReason)}` : 'Организатор не указал причину.',
        action: { kind: 'findOther' },
      };
    default:
      return { ...none, meta: PARTICIPATION_STATUS[my.status], detail: null, action: { kind: 'open' } };
  }
}

/** Статус строки во вкладке «Организую». */
export function organizerStatus(e: EventView): RowStatus {
  const none = { changes: [] };
  const people = e.capacity
    ? `Участников: ${e.counts.confirmed} из ${e.capacity}`
    : `Участников: ${e.counts.confirmed}`;
  // Управлять удалённым нельзя: строка ведёт в карточку, где видны пункт правил и комментарий
  if (e.state === 'deleted') {
    return {
      ...none,
      meta: { ...DELETED, label: 'Удалено модератором' },
      detail: e.moderation?.comment
        ? `Причина: ${sentence(e.moderation.comment)}`
        : 'Причина — в карточке события.',
      action: { kind: 'open' },
    };
  }
  if (e.state === 'removed') {
    return {
      ...none,
      meta: REMOVED,
      detail: e.moderation?.comment
        ? `Причина: ${sentence(e.moderation.comment)}`
        : 'Откройте управление, там причина.',
      action: { kind: 'manage', attention: true },
    };
  }
  if (e.state === 'cancelled') {
    return {
      ...none,
      meta: CANCELLED,
      detail: e.cancelReason ? `Причина: ${sentence(e.cancelReason)}` : null,
      action: { kind: 'manage', attention: false },
    };
  }
  if (e.state === 'past') {
    return {
      ...none,
      meta: { label: 'Прошло', tone: 'off', icon: 'history' },
      detail: people,
      action: { kind: 'open' },
    };
  }
  if (e.counts.pending > 0) {
    return {
      ...none,
      meta: {
        label: `${count(e.counts.pending, WORDS.application)} ${plural(e.counts.pending, ['ждёт', 'ждут', 'ждут'])} решения`,
        tone: 'wait',
        icon: 'clock',
      },
      detail: people,
      action: { kind: 'manage', attention: true },
    };
  }
  if (e.state === 'live')
    return { ...none, meta: LIVE, detail: people, action: { kind: 'manage', attention: false } };
  const meta: StatusMeta =
    e.counts.toThreshold !== null
      ? { label: `Нужно ещё ${count(e.counts.toThreshold, WORDS.person)}`, tone: 'wait', icon: 'queue' }
      : { label: 'Идёт запись', tone: 'ok', icon: 'check' };
  return { ...none, meta, detail: people, action: { kind: 'manage', attention: false } };
}

export interface TriedItem {
  sport: Pick<SportView, 'id' | 'name' | 'icon'>;
  times: number;
  firstAt: string;
}

/** Собирает коллекцию из прошедших занятий: направление, сколько раз, когда впервые. */
export function collectTried(events: { sport: TriedItem['sport']; startsAt: string }[]): TriedItem[] {
  const map = new Map<string, TriedItem>();
  for (const e of events) {
    const item = map.get(e.sport.id);
    if (item) {
      item.times += 1;
      if (e.startsAt < item.firstAt) item.firstAt = e.startsAt;
    } else {
      map.set(e.sport.id, { sport: e.sport, times: 1, firstAt: e.startsAt });
    }
  }
  return [...map.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt));
}
