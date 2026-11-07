import { useCreate, useInvalidate, useInvalidateAuthStore, useList, useUpdate } from '@refinedev/core';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { API, ENGAGEMENT_API, errorMessage, useAction, useMe, type ApiError } from '@/lib/api';
import { normalize } from '@/lib/text';
import { EMPTY_FORM, toInput, type EventForm } from '@/pages/events/create/model';
import type { EventDetails, Identity, SportView } from '@/types/api';
import type { District, EventLevel } from '@/types/domain';

/** Что помощник может сделать за человека. Выполняется только после «Подтвердить». */
export type AssistantActionType =
  | 'navigate'
  | 'create_event'
  | 'join_event'
  | 'leave_event'
  | 'create_companion'
  | 'favorite_event'
  | 'update_profile';

export interface AssistantActionParams {
  path?: string;
  eventId?: string;
  sport?: string;
  title?: string;
  description?: string;
  date?: string;
  time?: string;
  durationMin?: number;
  address?: string;
  capacity?: number;
  price?: number;
  level?: EventLevel;
  joinMode?: 'open' | 'approval';
  text?: string;
  when?: string;
  district?: string;
  interests?: string[];
}

export interface AssistantAction {
  type: AssistantActionType;
  summary: string;
  params: AssistantActionParams;
  /** Чем закончилось: кнопки карточки после ответа человека больше не активны. */
  status?: 'done' | 'cancelled' | 'failed';
}

export interface ActionOutcome {
  ok: boolean;
  text: string;
  links?: { label: string; to: string }[];
}

const NEEDS_LOGIN: AssistantActionType[] = [
  'create_event',
  'join_event',
  'leave_event',
  'create_companion',
  'favorite_event',
  'update_profile',
];

const LEVEL_LABEL: Record<EventLevel, string> = {
  any: 'любой уровень',
  beginner: 'для новичков',
  amateur: 'любители',
  experienced: 'опытные',
};

/** Строки карточки подтверждения: что именно будет сделано. */
export function actionRows(action: AssistantAction): [string, string][] {
  const p = action.params;
  const rows: [string, string | number | undefined][] = [
    ['Вид спорта', p.sport],
    ['Название', p.title],
    [
      'Дата',
      p.date
        ? new Date(`${p.date}T12:00:00`).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            weekday: 'long',
          })
        : undefined,
    ],
    ['Время', p.time],
    ['Длительность', p.durationMin ? `${p.durationMin} мин` : undefined],
    ['Адрес', p.address],
    ['Мест', p.capacity],
    ['Цена', p.price === undefined ? undefined : p.price > 0 ? `${p.price} ₽ с человека` : 'бесплатно'],
    ['Уровень', p.level ? LEVEL_LABEL[p.level] : undefined],
    ['Запись', p.joinMode ? (p.joinMode === 'open' ? 'свободная' : 'по заявке') : undefined],
    ['Когда удобно', p.when],
    ['Район', p.district],
    ['Текст', p.text],
    ['Интересы', p.interests?.join(', ')],
    ['Описание', p.description],
  ];
  return rows
    .filter((r): r is [string, string | number] => r[1] !== undefined && r[1] !== '')
    .map(([k, v]) => [k, String(v)]);
}

/** Ссылка на форму создания с уже заполненными полями: «Проверить в форме». */
export function eventFormLink(p: AssistantActionParams): string {
  const q = new URLSearchParams();
  const set = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== '') q.set(k, String(v));
  };
  set('title', p.title);
  set('description', p.description);
  set('sport', p.sport);
  set('date', p.date);
  set('time', p.time);
  set('address', p.address);
  set('capacity', p.capacity);
  set('level', p.level);
  set('joinMode', p.joinMode);
  set('durationMin', p.durationMin);
  if (p.price === 0) q.set('free', '1');
  return `/events/new?${q}`;
}

export function companionFormLink(): string {
  return '/companions/new';
}

/** Ссылка, которой можно сделать то же самое вручную. */
export function manualLink(action: AssistantAction): { label: string; to: string } | null {
  const p = action.params;
  switch (action.type) {
    case 'create_event':
      return { label: 'Проверить в форме', to: eventFormLink(p) };
    case 'create_companion':
      return { label: 'Открыть форму объявления', to: companionFormLink() };
    case 'join_event':
    case 'leave_event':
    case 'favorite_event':
      return p.eventId ? { label: 'Открыть встречу', to: `/events/${p.eventId}` } : null;
    case 'update_profile':
      return { label: 'Открыть профиль', to: '/me' };
    default:
      return null;
  }
}

export const safePath = (path: string | undefined): path is string => Boolean(path && /^\/(?!\/)/.test(path));

function findByName<T extends { name: string; synonyms?: string[] }>(
  items: T[],
  name: string | undefined,
): T | undefined {
  if (!name) return undefined;
  const n = normalize(name);
  return (
    items.find((s) => normalize(s.name) === n) ??
    items.find((s) => s.synonyms?.some((x) => normalize(x) === n)) ??
    items.find((s) => normalize(s.name).startsWith(n) || n.startsWith(normalize(s.name))) ??
    items.find((s) => normalize(s.name).includes(n) || n.includes(normalize(s.name)))
  );
}

const fieldText = (error: unknown) => {
  const errors = (error as ApiError | null)?.errors as Record<string, string> | undefined;
  return errors ? Object.values(errors).filter(Boolean).join('. ') : '';
};

const statusText: Record<string, string> = {
  confirmed: 'Вы записаны.',
  pending: 'Заявка отправлена. Организатор ответит, статус виден в «Моих занятиях».',
  waitlist: 'Мест нет, вы в листе ожидания. Если место освободится, придёт уведомление.',
};

/** Выполняет действие помощника от имени человека через обычные запросы сайта (те же правила и права). */
export function useAssistantActions() {
  const { me } = useMe();
  const navigate = useNavigate();
  const { run } = useAction();
  const { mutateAsync: create } = useCreate();
  const { mutateAsync: update } = useUpdate<Identity>();
  const invalidate = useInvalidate();
  const invalidateAuth = useInvalidateAuthStore();
  const sports = useList<SportView>({ resource: 'sports', pagination: { mode: 'off' } }).result.data;
  const districts = useList<District>({ resource: 'districts', pagination: { mode: 'off' } }).result.data;

  return useCallback(
    async (action: AssistantAction): Promise<ActionOutcome> => {
      const p = action.params;
      if (!me && NEEDS_LOGIN.includes(action.type))
        return {
          ok: false,
          text: 'Чтобы я сделал это за вас, войдите на сайт. После входа повторите просьбу.',
          links: [{ label: 'Войти', to: '/login?to=/assistant' }],
        };
      try {
        switch (action.type) {
          case 'navigate': {
            if (!safePath(p.path)) return { ok: false, text: 'Не понял, какую страницу открыть.' };
            navigate(p.path);
            return { ok: true, text: 'Открыл страницу.' };
          }
          case 'join_event': {
            if (!p.eventId) return { ok: false, text: 'Не понял, на какую встречу записать.' };
            const e = (await run(API.joinEvent(p.eventId), {}, { silent: true })) as EventDetails;
            void invalidate({ resource: 'events', invalidates: ['all'] });
            return {
              ok: true,
              text: `${e.title}. ${statusText[e.my?.status ?? 'confirmed'] ?? 'Готово.'}`,
              links: [
                { label: 'Открыть встречу', to: `/events/${e.id}` },
                { label: 'Мои занятия', to: '/me' },
              ],
            };
          }
          case 'leave_event': {
            if (!p.eventId) return { ok: false, text: 'Не понял, какую запись отменить.' };
            await run(API.leaveEvent(p.eventId), {}, { silent: true });
            void invalidate({ resource: 'events', invalidates: ['all'] });
            return { ok: true, text: 'Запись отменена.', links: [{ label: 'Мои занятия', to: '/me' }] };
          }
          case 'favorite_event': {
            if (!p.eventId) return { ok: false, text: 'Не понял, какую встречу сохранить.' };
            await run(ENGAGEMENT_API.favorite(p.eventId), {}, { silent: true, method: 'put' });
            return {
              ok: true,
              text: 'Сохранил в избранное.',
              links: [{ label: 'Открыть избранное', to: '/me?tab=favorites' }],
            };
          }
          case 'create_event': {
            const sport = findByName(sports, p.sport);
            const district = findByName(districts, p.district);
            const sportName = sport?.name ?? p.sport ?? '';
            if (!sportName) return { ok: false, text: 'Назовите вид спорта, и я создам встречу.', links: [] };
            const dateLabel = p.date
              ? new Date(`${p.date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
              : '';
            const form: EventForm = {
              ...EMPTY_FORM,
              sport: sport ?? null,
              newSportName: sport ? '' : sportName,
              confirmNewSport: !sport,
              title:
                p.title && p.title.length >= 5 ? p.title : [sportName, dateLabel].filter(Boolean).join(', '),
              description: p.description ?? '',
              date: p.date ?? '',
              time: p.time ?? '',
              durationMin: p.durationMin ?? EMPTY_FORM.durationMin,
              address: p.address ?? '',
              districtId: district?.id ?? null,
              capacity: p.capacity && p.capacity >= 2 ? p.capacity : EMPTY_FORM.capacity,
              level: p.level ?? 'any',
              beginnersWelcome: !p.level || p.level === 'any' || p.level === 'beginner',
              joinMode: p.joinMode ?? 'open',
              priceKind: p.price ? 'fixed' : 'free',
              priceAmount: p.price ? p.price : null,
            };
            try {
              const res = await create({
                resource: 'events',
                values: toInput(form, true),
                successNotification: false,
                errorNotification: false,
              });
              const id = String(res.data.id);
              return {
                ok: true,
                text: `Встреча «${form.title}» создана и опубликована. Её можно поправить или добавить фото в любой момент.`,
                links: [
                  { label: 'Открыть встречу', to: `/events/${id}` },
                  { label: 'Изменить', to: `/events/${id}/edit` },
                ],
              };
            } catch (error) {
              return {
                ok: false,
                text: `Не получилось создать встречу. ${fieldText(error) || errorMessage(error)} Откройте форму: я перенёс туда всё, что вы рассказали.`,
                links: [{ label: 'Открыть форму', to: eventFormLink(p) }],
              };
            }
          }
          case 'create_companion': {
            const sport = findByName(sports, p.sport);
            const district = findByName(districts, p.district);
            if (!p.text && !sport) return { ok: false, text: 'Напишите, с кем и чем хотите заниматься.' };
            try {
              await create({
                resource: 'companions',
                values: {
                  ...(sport ? { sportId: sport.id } : { newSportName: p.sport ?? '' }),
                  text: p.text ?? `Ищу компанию: ${sport?.name ?? p.sport}`,
                  districtId: district?.id ?? me?.districtId ?? null,
                  when: p.when ?? 'Когда угодно',
                  level: p.level && p.level !== 'any' ? p.level : 'beginner',
                  readiness: 'join',
                  createdWithAssistant: true,
                },
                successNotification: false,
                errorNotification: false,
              });
              return {
                ok: true,
                text: 'Объявление опубликовано. Когда кто-то откликнется, придёт уведомление.',
                links: [{ label: 'Все объявления', to: '/companions' }],
              };
            } catch (error) {
              return {
                ok: false,
                text: `Не получилось опубликовать. ${fieldText(error) || errorMessage(error)}`,
                links: [{ label: 'Открыть форму', to: companionFormLink() }],
              };
            }
          }
          case 'update_profile': {
            if (!me) return { ok: false, text: 'Войдите, чтобы изменить профиль.' };
            const patch: Record<string, unknown> = {};
            const found = (p.interests ?? [])
              .map((name) => findByName(sports, name))
              .filter(Boolean) as SportView[];
            if (found.length) {
              const ids = [...new Set([...me.interests.map((s) => s.id), ...found.map((s) => s.id)])];
              patch.interests = ids;
              patch.levels = Object.fromEntries(ids.map((id) => [id, me.levels[id] ?? 'beginner']));
            }
            const district = findByName(districts, p.district);
            if (district) patch.districtId = district.id;
            if (!Object.keys(patch).length)
              return {
                ok: false,
                text: 'Не нашёл таких видов спорта или района в каталоге.',
                links: [{ label: 'Открыть профиль', to: '/me' }],
              };
            await update({
              resource: 'users',
              id: me.id,
              values: patch,
              successNotification: false,
              errorNotification: false,
            });
            void invalidateAuth();
            void invalidate({ resource: 'events', invalidates: ['all'] });
            return {
              ok: true,
              text: 'Профиль обновлён. Подборка «Для вас» теперь учитывает изменения.',
              links: [{ label: 'Подборка для вас', to: '/events' }],
            };
          }
        }
      } catch (error) {
        return {
          ok: false,
          text: errorMessage(error, 'Не получилось. Попробуйте ещё раз.'),
          links: manualLink(action) ? [manualLink(action)!] : [],
        };
      }
      return { ok: false, text: 'Это действие пока недоступно.' };
    },
    [me, navigate, run, create, update, invalidate, invalidateAuth, sports, districts],
  );
}
