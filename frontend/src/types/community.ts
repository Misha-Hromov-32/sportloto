import type { SportView } from './api';
import type { ID, ISODate, Price } from './domain';
import type { EventInput } from './inputs';

// ---------- В8: наполнение из сообществ ----------

/** Публичное сообщество, из постов которого собраны черновики. Хранится только название и адрес. */
export interface CommunitySource {
  id: ID;
  name: string;
  url: string;
  /** Служебная организация «Сообщество «…» (импорт)», от имени которой публикуются встречи. */
  orgId: ID | null;
  /** Сообщество забрало страницу: встречи переданы этой организации. */
  transferredTo: ID | null;
  transferredAt: ISODate | null;
  createdAt: ISODate;
}

export type ImportStatus = 'draft' | 'published' | 'rejected';

/** Поля черновика, которые администратор может поправить перед публикацией. */
export type ImportDraft = Pick<
  EventInput,
  'title' | 'description' | 'sportId' | 'newSportName' | 'startsAt' | 'durationMin' | 'level' | 'capacity'
> & {
  place: { address: string; districtId: ID | null; lat?: number; lng?: number };
  price: Price;
  beginnersWelcome: boolean;
  /** Обложка встречи: HTTPS-адрес или уменьшенное фото. */
  coverUrl?: string | null;
  /** Повторять каждую неделю до этого дня. */
  repeatWeeklyUntil?: ISODate | null;
  /** Другие дни недели того же расписания («вт и чт»): у каждого своя серия. */
  extraStarts?: ISODate[];
  /** После публикации: все встречи из поста, если их больше одной. */
  eventIds?: ID[];
};

/**
 * Пост сообщества. Имя и страница автора не сохраняются: только текст, дата, ссылка на пост
 * и сообщество.
 */
export interface ImportedPost {
  id: ID;
  sourceId: ID;
  /** Номер поста в сообществе: повторная загрузка того же поста не создаёт дубль. */
  externalId: string;
  postUrl: string;
  text: string;
  postedAt: ISODate | null;
  importedAt: ISODate;
  status: ImportStatus;
  /** Есть направление и время: похоже на встречу. */
  meeting: boolean;
  draft: Partial<ImportDraft>;
  /** Что распознал помощник и почему. Правка поля снимает пометку. */
  assisted: Partial<Record<ImportField, string>>;
  eventId: ID | null;
  rejectReason: string;
  decidedBy: ID | null;
  decidedAt: ISODate | null;
}

export type ImportField =
  | 'title'
  | 'sportId'
  | 'startsAt'
  | 'place'
  | 'price'
  | 'capacity'
  | 'level'
  | 'description'
  | 'coverUrl'
  | 'series';

export interface ImportedPostView extends ImportedPost {
  source: { id: ID; name: string; url: string };
  sport: SportView | null;
  districtName: string | null;
  /** Чего не хватает для публикации, простыми словами. */
  problems: { field: ImportField; text: string }[];
  /** Пост старше недели: «в субботу» могло означать прошлую субботу. */
  stale: boolean;
  event: { id: ID; title: string } | null;
}

export interface ImportUploadResult {
  added: number;
  duplicates: number;
  notMeeting: number;
  skipped: number;
  ids: ID[];
}

export interface CommunitySourceView extends CommunitySource {
  posts: number;
  published: number;
  drafts: number;
  /** Организации, которые указали адрес этого сообщества в заявке. */
  claims: { orgId: ID; name: string; status: string; approved: boolean }[];
  transferredName: string | null;
}

/** Плашка на карточке события: откуда встреча и кто может забрать страницу. */
export interface EventSourceView {
  sourceId: ID;
  name: string;
  url: string;
  postUrl: string;
  orgId: ID | null;
  transferred: boolean;
  /** Что подставить в заявку организации, если сообщество захочет забрать страницу. */
  claim: { name: string; description: string; sportIds: ID[]; social: string; districtId: ID | null };
}

// ---------- С16: жалобы ----------

export type ReportReason = 'spam' | 'fraud' | 'abuse' | 'danger' | 'other';
export type ReportTarget = 'event' | 'message';
export type ReportStatus = 'open' | 'upheld' | 'dismissed';

export interface Report {
  id: ID;
  targetType: ReportTarget;
  targetId: ID;
  eventId: ID;
  reporterId: ID;
  reason: ReportReason;
  comment: string;
  status: ReportStatus;
  createdAt: ISODate;
  decidedAt: ISODate | null;
  decidedBy: ID | null;
}

export interface ReportInput {
  targetType: ReportTarget;
  targetId: ID;
  reason: ReportReason;
  comment?: string;
}

export interface MyReportState {
  reported: boolean;
  status: ReportStatus | null;
}

/** Жалобы на один объект, собранные вместе. Кто пожаловался, администратор не видит. */
export interface ReportGroupView {
  id: string;
  targetType: ReportTarget;
  targetId: ID;
  eventId: ID;
  eventTitle: string;
  /** Текст сообщения или название события. */
  preview: string;
  authorName: string;
  /** Что с объектом сейчас: «published», «removed», «visible», «hidden»… */
  targetState: string;
  alreadyHandled: boolean;
  count: number;
  reasons: { reason: ReportReason; count: number }[];
  comments: { reason: ReportReason; text: string; at: ISODate }[];
  firstAt: ISODate;
  lastAt: ISODate;
  status: ReportStatus;
}

export interface CommunityStats {
  reports: { events: number; messages: number };
  imports: { drafts: number };
  suspendedOrgs: number;
}

// ---------- С17: приостановка допуска ----------

export interface OrgSuspension {
  reason: string;
  at: ISODate;
  by: ID;
}

// ---------- В6: спрос и инфраструктура ----------

export type DemandKind = 'search' | 'phrase' | 'companion' | 'waitlist' | 'failed';
export interface AnalyticsDistrict {
  id: ID;
  name: string;
  demand: number;
  unmet: number;
  vulnerable: number;
  events: number;
  freeEvents: number;
  paidEvents: number;
  avgPrice: number | null;
  paidFill: number | null;
  seats: number;
  venues: number;
  freeWindows: number;
  venuesNoAccess: number;
  eventsNoAccess: number;
  /** Запросов на одну встречу. */
  gap: number;
  commercial: number;
  social: number;
}

export interface AnalyticsCell {
  districtId: ID;
  sportId: ID;
  demand: number;
  events: number;
  gap: number;
}

export interface AnalyticsView {
  days: number;
  from: ISODate;
  to: ISODate;
  /** Сколько записей журнала — демонстрационная история. */
  demoEntries: number;
  liveEntries: number;
  totals: Record<DemandKind, number> & { events: number; venues: number; freeWindows: number };
  daily: { date: string; demand: number; live: number }[];
  phrases: { text: string; count: number }[];
  filters: { label: string; count: number }[];
  districts: AnalyticsDistrict[];
  sports: { id: ID; name: string; demand: number; events: number }[];
  cells: AnalyticsCell[];
  /** Данные площадок берутся из раздела «Площадки»; без них предложение считается по встречам. */
  venuesAvailable: boolean;
}
