import {
  useCustom,
  useCustomMutation,
  useGetIdentity,
  useInvalidate,
  useInvalidateAuthStore,
  useSubscription,
  type BaseRecord,
  type HttpError,
  type LiveEvent,
} from '@refinedev/core';
import { App } from 'antd';
import { useCallback, useRef } from 'react';

import type { AccessRole } from '@/types/domain';
import type {
  AdminStats,
  CompanionView,
  DemoState,
  EventDetails,
  Identity,
  SportSimilarError,
} from '@/types/api';
import type { EventGearView, InventoryMe } from '@/types/inventory';
import type { CommunityStats } from '@/types/community'; // С16, В8

/**
 * Хуки доступа к API для экранов. Только через Refine: экраны не знают, откуда приходят данные.
 * Адреса действий — в API ниже; полный контракт — docs/architecture/api.md.
 */

export const API = {
  eventPhotos: (id: string) => `/events/${id}/photos`,
  joinEvent: (id: string) => `/events/${id}/join`,
  leaveEvent: (id: string) => `/events/${id}/leave`,
  cancelEvent: (id: string) => `/events/${id}/cancel`,
  ackChanges: (id: string) => `/events/${id}/ack-changes`,
  moderateEvent: (id: string) => `/events/${id}/moderate`,
  dismissEventFlag: (id: string) => `/events/${id}/dismiss-flag`,
  /** POST: организатор исправил снятое событие и просит вернуть. Тело `{ comment? }`. */
  appealEvent: (id: string) => `/events/${id}/appeal`,
  inviteToEvent: (id: string) => `/events/${id}/invite`,
  decideParticipation: (id: string) => `/participations/${id}/decide`,
  reactMessage: (id: string) => `/messages/${id}/react`,
  moderateMessage: (id: string) => `/messages/${id}/moderate`,
  submitOrganization: (id: string) => `/organizations/${id}/submit`,
  decideOrganization: (id: string) => `/organizations/${id}/decide`,
  /** PUT — «Я тоже», DELETE — снять отклик. Оба повторяемы. POST (переключатель) устарел. */
  metoo: (id: string) => `/companions/${id}/metoo`,
  inviteFromCompanion: (id: string) => `/companions/${id}/invite`,
  closeCompanion: (id: string) => `/companions/${id}/close`,
  promoteSport: (id: string) => `/sports/${id}/promote`,
  mergeSport: (id: string) => `/sports/${id}/merge`,
  suggestSports: '/sports/suggest',
  readNotifications: '/notifications/read',
  readNotification: (id: string) => `/notifications/${id}/read`,
  me: '/me',
  adminStats: '/admin/stats',
  demoState: '/demo/state',
  demoAccounts: '/demo/accounts',
  assistantSearch: '/assistant/search',
  assistantDraft: '/assistant/draft',
  assistantExplain: '/assistant/explain',
  assistantPremoderate: '/assistant/premoderate',
  /** С4: место из листа ожидания — «Иду» и «Отказаться». */
  acceptOffer: (id: string) => `/events/${id}/offer/accept`,
  declineOffer: (id: string) => `/events/${id}/offer/decline`,
  /** С6: GET → `PlanBView`; POST «Не смогу в новое время». */
  alternatives: (id: string) => `/events/${id}/alternatives`,
  declineReschedule: (id: string) => `/events/${id}/decline-reschedule`,
  /** С10: GET → `SeriesView`; POST → `SeriesJoinResult`. */
  series: (id: string) => `/events/${id}/series`,
  joinSeries: (id: string) => `/events/${id}/join-series`,
  /** В2: POST `{ text, steps?, cityId? }` → `MatchResult`. */
  assistantMatch: '/assistant/match',
  /** С1: GET — кто встретит и памятка; PUT `{ userId, note }` — назначить; DELETE — снять. */
  greeter: (id: string) => `/events/${id}/greeter`,
  /** С1: PUT `{ withCompanion? }` — «Я здесь впервые», DELETE — снять отметку. */
  firstVisit: (id: string) => `/events/${id}/first-visit`,
  /** С3: GET — состояние; POST `{ need }` — «Не хватает игроков»; DELETE — снять. */
  urgent: (id: string) => `/events/${id}/urgent`,
  /** Н2: PUT `{ withCompanion }` — отметить событие программы; DELETE — снять. */
  program: (id: string) => `/events/${id}/program`,
  /** С2: GET — группы спроса; POST `/offer` `{ key, eventId? , event? }` — предложить встречу. */
  demand: (orgId: string) => `/organizations/${orgId}/demand`,
  demandOffer: (orgId: string) => `/organizations/${orgId}/demand/offer`,
  /** В4: POST `{ slots: [{ startsAt, free, price? }] }` — владелец меняет окна площадки. */
  venueSlots: (id: string) => `/venues/${id}/slots`,
  /** В5: POST `BestPlaceInput` → `BestPlaceResult`: три удобных места для всей компании. */
  bestPlace: '/venues/best-place',
  /** В5: POST `{ venueId }` — перенести встречу на площадку (участники получат «было → стало»). */
  moveToVenue: (id: string) => `/events/${id}/move-to-venue`,
  /** Н1: PUT `{ needed }` — «Мне нужно сопровождение». */
  escort: (id: string) => `/events/${id}/escort`,
  /** С12: GET → `AgainPreview` — кого позовём «Собраться снова». */
  again: (id: string) => `/events/${id}/again`,
  /** С13: GET → `InviteLinkView`; POST `/rotate` — сменить ссылку; POST `invite-own` `{ people }` — пригласить своих. */
  inviteLink: (id: string) => `/events/${id}/invite-link`,
  rotateInviteLink: (id: string) => `/events/${id}/invite-link/rotate`,
  inviteOwn: (id: string) => `/events/${id}/invite-own`,
  /** С13, Н3: GET `?q=` → `PersonSuggestion[]` — люди на платформе по имени или почте. */
  suggestPeople: '/people/suggest',
  /** Н3: GET → `TeamState`; POST `{ userIds, note? }` — «Записать нас»; confirm/decline — ответ участника. */
  team: (id: string) => `/events/${id}/team`,
  confirmTeamPlace: (id: string) => `/events/${id}/team/confirm`,
  declineTeamPlace: (id: string) => `/events/${id}/team/decline`,
  /** Н3: GET → `TeamView[]` — команды события для организатора. */
  teams: (id: string) => `/events/${id}/teams`,
  /** Н6: PUT `{ children: [{ name, age }] }` — дети в действующей записи. */
  children: (id: string) => `/events/${id}/children`,
} as const;

export type ApiError = HttpError & { code?: string };

/** Ответ 409 `sport_similar`: в каталоге есть похожее направление. Покажите варианты и «Это другое». */
export function isSportSimilar(error: unknown): error is SportSimilarError {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'sport_similar');
}

/** Помощник не ответил: для поиска фразой сервер подсказывает обычный текстовый запрос. */
export function assistantFallbackQuery(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('fallback' in error)) return null;
  const fallback = (error as { fallback?: { q?: string } }).fallback;
  return fallback?.q?.trim() || null;
}

/** Ключ повтора для создания события или сообщения: двойное нажатие не создаст дубль. */
export function newIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type ActionMethod = 'post' | 'put' | 'delete' | 'patch';

export function errorMessage(error: unknown, fallback = 'Не получилось. Попробуйте ещё раз'): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message
  )
    return error.message;
  return fallback;
}

/** Текущий пользователь (или null для гостя) и его роль. */
export function useMe() {
  const { data, isLoading } = useGetIdentity<Identity | null>();
  const me = data ?? null;
  const role: AccessRole = me?.role ?? 'guest';
  return { me, role, isLoading, isGuest: !me };
}

/**
 * Действие API (POST /events/:id/join и т. п.). Ошибки показываются сообщением с текстом от сервера,
 * результат возвращается промисом. Живые обновления перерисуют затронутые списки сами.
 */
export function useAction<TResult extends BaseRecord = BaseRecord>() {
  const { mutateAsync, mutation } = useCustomMutation<TResult>();
  const { message } = App.useApp();
  const run = useCallback(
    async (
      url: string,
      payload: Record<string, unknown> = {},
      opts: { silent?: boolean; success?: string; method?: ActionMethod } = {},
    ) => {
      try {
        const res = await mutateAsync({
          url,
          method: opts.method ?? 'post',
          values: payload,
          successNotification: false,
          errorNotification: false,
        });
        if (opts.success) message.success(opts.success);
        return res.data;
      } catch (error) {
        if (!opts.silent) message.error(errorMessage(error));
        throw error;
      }
    },
    [mutateAsync, message],
  );
  return { run, isPending: mutation.isPending, error: mutation.error as ApiError | null };
}

/** Перезапросить данные, когда «сервер» сообщил об изменении любого из ресурсов (в т. ч. из другой вкладки). */
export function useLiveRefetch(resources: string[], refetch: () => void) {
  const latest = useRef(refetch);
  latest.current = refetch;
  const key = resources.join(',');
  useSubscription({
    channel: 'resources/*',
    types: ['*'],
    onLiveEvent: (event: LiveEvent) => {
      const resource = event.channel.replace('resources/', '');
      if (key.split(',').includes(resource)) latest.current();
    },
  });
}

/** Держит шапку (уведомления, роль) в актуальном состоянии при живых обновлениях. */
export function useIdentitySync() {
  const invalidateAuth = useInvalidateAuthStore();
  const invalidate = useInvalidate();
  useLiveRefetch(['notifications', 'users', 'organizations'], () => {
    void invalidateAuth();
  });
  useLiveRefetch(['demo'], () => {
    void invalidate({ resource: 'events', invalidates: ['all'] });
  });
}

export function useAdminStats() {
  const { query, result } = useCustom<AdminStats>({ url: API.adminStats, method: 'get' });
  useLiveRefetch(['organizations', 'events', 'messages', 'sports', 'admin'], () => void query.refetch());
  return {
    stats: result.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useDemoState() {
  const { query, result } = useCustom<DemoState>({ url: API.demoState, method: 'get' });
  useLiveRefetch(['demo'], () => void query.refetch());
  return { demo: result.data ?? null, isLoading: query.isLoading, refetch: query.refetch };
}

export interface DemoAccount {
  id: string;
  name: string;
  initials: string;
  age: number | null;
  role: AccessRole;
  title: string;
  hint: string;
  orgs: { id: string; name: string; status: string }[];
}

export function useDemoAccounts() {
  const { query, result } = useCustom<DemoAccount[]>({ url: API.demoAccounts, method: 'get' });
  useLiveRefetch(['organizations', 'demo'], () => void query.refetch());
  // Пока запрос идёт, Refine отдаёт пустой объект, а не undefined
  return { accounts: Array.isArray(result.data) ? (result.data as DemoAccount[]) : [] };
}

/** «Я тоже» в объявлении «Ищу компанию»: отдельные действия «откликнуться» и «снять отклик». */
export function useMetoo() {
  const { run, isPending } = useAction<CompanionView>();
  const add = useCallback(
    (companionId: string, opts: { silent?: boolean; success?: string } = {}) =>
      run(API.metoo(companionId), {}, { ...opts, method: 'put' }),
    [run],
  );
  const remove = useCallback(
    (companionId: string, opts: { silent?: boolean; success?: string } = {}) =>
      run(API.metoo(companionId), {}, { ...opts, method: 'delete' }),
    [run],
  );
  return { add, remove, isPending };
}

/** «Попросить вернуть» снятое модератором событие после исправления. */
export function useAppealEvent() {
  const { run, isPending } = useAction<EventDetails>();
  const appeal = useCallback(
    (eventId: string, comment = '', opts: { silent?: boolean; success?: string } = {}) =>
      run(API.appealEvent(eventId), { comment }, opts),
    [run],
  );
  return { appeal, isPending };
}

/** GET-запрос с живым обновлением: С1 «кто встретит», С3 срочный добор, С2 спрос. */
export function useLiveGet<T>(url: string, resources: string[], enabled = true) {
  const { query, result } = useCustom<BaseRecord>({
    url,
    method: 'get',
    queryOptions: { enabled, retry: false },
    errorNotification: false,
  });
  useLiveRefetch(resources, () => {
    if (enabled) void query.refetch();
  });
  return {
    // До ответа и при ошибке Refine отдаёт пустой объект — экранам нужен null
    data: query.isSuccess && result.data ? (result.data as unknown as T) : null,
    isLoading: query.isLoading && enabled,
    isError: query.isError,
    error: query.error as ApiError | null,
    refetch: query.refetch,
  };
}

/** Отметить уведомления прочитанными: одно — по id, без id — все. */
export function useReadNotifications() {
  const { run, isPending } = useAction<{ ok: true; unread: number }>();
  const readOne = useCallback((id: string) => run(API.readNotification(id), {}, { silent: true }), [run]);
  const readAll = useCallback(
    (ids?: string[]) => run(API.readNotifications, ids ? { ids } : {}, { silent: true }),
    [run],
  );
  return { readOne, readAll, isPending };
}

// ---------- В3 + С7: инвентарь для игры, общая полка, помощь партнёров ----------

/** Ресурсы списков: `shelf`, `gear-loans`, `support-needs`. Действия — ниже. */
export const INVENTORY_API = {
  eventGear: (eventId: string) => `/events/${eventId}/gear`,
  /** PUT `{ quantity }`: «Возьму с собой», 0 — снять отметку. */
  pledge: (eventId: string, lineId: string) => `/events/${eventId}/gear/${lineId}/pledge`,
  requestItem: (itemId: string) => `/shelf/${itemId}/request`,
  decideLoan: (loanId: string) => `/gear-loans/${loanId}/decide`,
  cancelLoan: (loanId: string) => `/gear-loans/${loanId}/cancel`,
  returnLoan: (loanId: string) => `/gear-loans/${loanId}/return`,
  offerSupport: (needId: string) => `/support-needs/${needId}/offer`,
  decideOffer: (needId: string, offerId: string) => `/support-needs/${needId}/offers/${offerId}/decide`,
  withdrawOffer: (needId: string, offerId: string) => `/support-needs/${needId}/offers/${offerId}/withdraw`,
  cancelSupport: (needId: string) => `/support-needs/${needId}/cancel`,
  me: '/inventory/me',
} as const;

const INVENTORY_LIVE = ['inventory', 'events', 'participations', 'organizations', 'demo'];

/** Перечитать данные инвентаря, когда их изменила другая сторона (в том числе в другой вкладке). */
export function useInventoryLive(refetch: () => void) {
  useLiveRefetch(INVENTORY_LIVE, refetch);
}

export function useEventGear(eventId: string) {
  const { query, result } = useCustom<EventGearView>({
    url: INVENTORY_API.eventGear(eventId),
    method: 'get',
    queryOptions: { enabled: Boolean(eventId), retry: false },
    errorNotification: false,
  });
  useInventoryLive(() => void query.refetch());
  return {
    gear:
      eventId && Array.isArray((result.data as EventGearView | undefined)?.lines)
        ? (result.data as EventGearView)
        : null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useInventoryMe() {
  const { query, result } = useCustom<InventoryMe>({
    url: INVENTORY_API.me,
    method: 'get',
    errorNotification: false,
  });
  useInventoryLive(() => void query.refetch());
  const data = result.data as InventoryMe | undefined;
  return { me: data && 'shareAs' in data ? data : null, isLoading: query.isLoading };
}

// ---------- В6, В8, С16, С17: спрос, импорт из сообществ, жалобы, приостановка допуска ----------

/** Ресурсы списков: `community-imports`, `community-sources`, `reports` (жалобы, собранные по объекту). */
export const COMMUNITY_API = {
  /** POST `{ content, sourceUrl?, sourceName?, example? }` → `ImportUploadResult`. */
  uploadImport: '/imports/upload',
  /** PUT — сохранить правку черновика. */
  saveImport: (id: string) => `/imports/${id}`,
  publishImport: (id: string) => `/imports/${id}/publish`,
  rejectImport: (id: string) => `/imports/${id}/reject`,
  restoreImport: (id: string) => `/imports/${id}/restore`,
  /** PUT `{ logoUrl?, about? }` — логотип и описание страницы сообщества, пока его не забрали. */
  updateSource: (id: string) => `/community-sources/${id}`,
  transferSource: (id: string) => `/community-sources/${id}/transfer`,
  /** GET → `{ source: EventSourceView | null }`. */
  eventSource: (eventId: string) => `/events/${eventId}/source`,
  /** POST `ReportInput` → `{ report, duplicate }`. */
  report: '/reports',
  /** GET → `MyReportState`: жаловался ли я на это событие и что решили. */
  myEventReport: (eventId: string) => `/events/${eventId}/my-report`,
  myMessageReports: (eventId: string) => `/events/${eventId}/my-message-reports`,
  decideReports: '/reports/decide',
  stats: '/admin/community-stats',
  suspendOrg: (id: string) => `/organizations/${id}/suspend`,
  resumeOrg: (id: string) => `/organizations/${id}/resume`,
  analytics: '/admin/analytics',
} as const;

export function useCommunityStats(enabled = true) {
  return useLiveGet<CommunityStats>(
    COMMUNITY_API.stats,
    ['reports', 'imports', 'organizations', 'admin', 'demo'],
    enabled,
  );
}

// ---------- С8, С11, С14, С15, Н5: избранное, шаблоны, выгрузка участников, надёжность; ссылка близкому ----------

export const ENGAGEMENT_API = {
  /** GET → `FavoritesView`: избранные события, подписки, сохранённые поиски. */
  favorites: '/me/favorites',
  /** PUT — в избранное, DELETE — убрать. */
  favorite: (eventId: string) => `/events/${eventId}/favorite`,
  /** DELETE — отписаться. */
  follow: (kind: 'org' | 'user', id: string) => `/follows/${kind}/${id}`,
  /** DELETE — удалить сохранённый поиск. */
  savedSearch: (id: string) => `/saved-searches/${id}`,
  /** GET → `EventTemplate[]`. */
  templates: '/event-templates',
  /** GET → `ParticipantsExport` (CSV для таблицы). */
  participantsExport: (eventId: string) => `/events/${eventId}/participants-export`,
  /** PUT `{ answer: 'yes' | 'no' }` → `HeldCheck`. */
  held: (eventId: string) => `/events/${eventId}/held`,
  /** GET → `ShareState`; POST — создать ссылку; DELETE — отозвать. */
  share: (eventId: string) => `/events/${eventId}/share`,
  /** GET без входа → `SharedCard`. */
  shared: (token: string) => `/share/${token}`,
  /** GET → `OfflineCard[]`: ближайшие записи для хранения на устройстве. */
  offlineCards: '/me/offline-cards',
} as const;

// ---------- Подборка дня ----------

export const DIGEST_API = {
  /** GET → `DigestSettings`; PUT `DigestSettingsInput` → `DigestSettings`. */
  settings: '/me/digest',
  /** POST → `DigestSendResult`: собрать подборку сейчас. */
  sendNow: '/me/digest/send-now',
  /** GET → `DigestView`: встречи подборки (только её получателю). */
  digest: (id: string) => `/digests/${id}`,
  /** POST `{ token }` без входа → `{ ok, wasOn }`: ссылка «Отписаться» из письма. */
  unsubscribe: '/digest/unsubscribe',
} as const;
