import type { HeldCheck } from './engagement';
import type { MyPayment } from './payments'; // оплата на сайте
import type { GearLine } from './inventory';
import type {
  ChildSeat,
  EventVisibility,
  TeamMemberStatus,
  AccessRole,
  AppNotification,
  AuditEntry,
  CompanionRequest,
  Composition,
  District,
  EventState,
  ExtraField,
  Gender,
  GeoPoint,
  ID,
  ISODate,
  Message,
  OrgStatus,
  OrgType,
  Organization,
  Participation,
  ParticipationStatus,
  PlatformRule,
  Readiness,
  SkillLevel,
  Sport,
  SportCategory,
  SportEvent,
  StopReasonCode,
  StopTerm,
  User,
  AccessNeed,
  EventAccessExtra,
  Venue,
  VenueFeature,
  VenueKind,
} from './domain';

import type { DemandSlot, EventProgramKind } from './domain'; // С2, Н2

/** Ответы API сервера. */

export interface SportView {
  id: ID;
  name: string;
  icon: string | null;
  kind: Sport['kind'];
  popular: boolean;
  categoryIds: ID[];
  synonyms: string[];
  fields: ExtraField[];
  /** Скрыто администратором: в выборе не показывается, старые записи его сохраняют. */
  hidden?: boolean;
}

export interface SportSuggestion extends SportView {
  match: 'exact' | 'synonym' | 'prefix' | 'typo';
}

export interface CategoryView extends SportCategory {
  sports: SportView[];
}

export interface OrganizerFacts {
  held: number;
  cancelled: number;
  upcoming: number;
  /** С15: сколько прошедших встреч подтвердило большинство ответивших участников. */
  confirmed?: number;
  /** С15: сколько встреч, по словам большинства участников, не состоялось (они не входят в `held`). */
  disputed?: number;
}

export interface OrganizerView {
  kind: 'user' | 'org';
  id: ID;
  name: string;
  avatarUrl: string | null;
  /** «Организация проверена» — только у допущенной организации. */
  verified: boolean;
  orgType: OrgType | null;
  facts: OrganizerFacts;
  link: string;
}

export interface EventCounts {
  confirmed: number;
  pending: number;
  waitlist: number;
  spotsLeft: number | null;
  /** Сколько ещё нужно до порога сбора; null — порога нет или он набран. */
  toThreshold: number | null;
}

export interface MyParticipation {
  id: ID;
  status: ParticipationStatus;
  note: string;
  rejectReason: string;
  waitlistPosition: number | null;
  /** Есть изменения события, которые участник ещё не подтвердил «Я в курсе». */
  unackedChangeIds: ID[];
  /** Н1: участник отметил «Мне нужно сопровождение». */
  needsEscort?: boolean;
  /** С4: место придержано до этого времени, нужно ответить «Иду» или «Отказаться». */
  offerUntil?: ISODate | null;
  /** С6: запись отменена из-за переноса — показываем похожие встречи. */
  leftBecause?: 'reschedule' | null;
  /** Н6: записанные дети и занимает ли место сам взрослый. */
  children?: ChildSeat[];
  adultSeat?: boolean;
  /** D-16: почему организатор убрал из участников (статус `removed`). */
  removedReason?: string;
  /** Оплата на сайте: что с оплатой участия; null — встреча без оплаты на сайте. */
  payment?: MyPayment | null;
}

export interface EventPermissions {
  join: boolean;
  /** Почему записаться нельзя — готовый текст для интерфейса. */
  joinReason: string;
  /** Код причины из правил записи (`organizer_blocked`, `event_full`…); пусто, если записаться можно. */
  joinCode?: string;
  leave: boolean;
  ask: boolean;
  askReason: string;
  manage: boolean;
  moderate: boolean;
  seePrivate: boolean;
  /** Можно открыть правку: предстоящее событие или снятое модератором (без уведомлений участникам). */
  edit?: boolean;
  /** Можно попросить администратора вернуть снятое событие. */
  appeal?: boolean;
}

export interface PersonShort {
  id: ID;
  name: string;
  avatarUrl: string | null;
  initials: string;
}

export interface EventView extends SportEvent {
  sport: SportView;
  organizerView: OrganizerView;
  state: EventState;
  counts: EventCounts;
  /** Первые участники для ряда мест: инициалы и аватары. */
  seats: PersonShort[];
  my: MyParticipation | null;
  isOrganizer: boolean;
  can: EventPermissions;
  distanceKm: number | null;
  districtName: string | null;
  privateInfo: string;
  /** У встречи есть сведения для участников (сам текст приходит только тем, кому его можно видеть). */
  hasPrivateInfo?: boolean;
  /** Подпись «почему вам подходит» для подборки. */
  matchReasons: string[];
  /** Взвешенный счёт подбора (0…~10); null — подбор не считается: гость, администратор, организатор. */
  matchScore?: number | null;
  /** Порог сбора набран: true — встреча состоится, false — пока нет, null — порога нет. */
  gathered?: boolean | null;
  /** К этому времени нужно набрать порог (за сутки до начала); null — порога нет. */
  thresholdDeadline?: ISODate | null;
  /** В4: площадка встречи, если событие к ней привязано. */
  venue?: VenueShort | null;
  /** Н1: условия доступной среды: от площадки и добавленные организатором. */
  access?: EventAccess;
  /** С3: срочный добор — сколько игроков ещё нужно; null — просьбы нет или она погасла. */
  urgent?: UrgentBadge | null;
  /** Н2: событие входит в программу поддержки ветеранов. */
  program?: ProgramBadge | null;
  /** С8: событие в избранном у текущего человека. */
  favorite?: boolean;
  /** С15: вопрос участнику «Встреча состоялась?» после окончания. */
  heldCheck?: HeldCheck | null;
}

// ---------- В2, С1, С2, С3, Н2: подбор, встречающий, спрос, срочный добор, программа ----------

export interface UrgentBadge {
  /** Сколько игроков ещё нужно. */
  need: number;
  /** Метка погаснет в это время (за час до начала). */
  until: ISODate;
}

export interface ProgramBadge {
  kind: EventProgramKind;
  label: string;
  withCompanion: boolean;
}

/** Фильтры подбора: обычные фильтры поиска плюс «вокруг района». */
export interface MatchFilters extends SearchFilters {
  /** Искать вокруг центра района (радиус — `radiusKm`), а не только внутри его границ. */
  aroundDistrictId?: ID;
}

/** Шаг диалога подбора: что поменять в фильтрах. Клиент присылает выбранные шаги обратно. */
export interface MatchPatch {
  set?: Partial<MatchFilters>;
  drop?: (keyof MatchFilters)[];
}

export interface MatchOption {
  /** Устойчивый ключ варианта: `widen:radius`, `when:weekend`… */
  id: string;
  label: string;
  /** Что изменится: «2 события, до 6 км». */
  hint?: string;
  patch: MatchPatch;
}

export interface MatchQuestion {
  id: string;
  question: string;
  options: MatchOption[];
}

export interface MatchItem {
  event: EventView;
  /** Почему подходит: 2–4 коротких пункта. */
  why: string[];
}

export interface MatchResult {
  filters: MatchFilters;
  /** Как помощник понял запрос: «волейбол, на выходных, рады новичкам, до 3 км от Взлётки». */
  understood: string[];
  reply: string;
  items: MatchItem[];
  /** Сколько событий подходит всего. */
  total: number;
  questions: MatchQuestion[];
  widen: MatchOption[];
  /** Подходящие события, на которые человек уже записан. */
  joined: { id: ID; title: string; startsAt: ISODate }[];
  /** Черновик «Ищу компанию», если подходящих мало. */
  companion: {
    sportId: ID | null;
    sportName: string | null;
    districtId: ID | null;
    when: string;
    level: SkillLevel;
    text: string;
  } | null;
}

/** С1: кто встретит новичков, памятка и список новичков — по правам смотрящего. */
export interface GreeterView {
  eventId: ID;
  greeter: (PersonShort & { isOrganizer: boolean }) | null;
  /** Приметы и место встречи: участникам, организатору и встречающему. */
  note: string;
  /** Н2: на событии программы встречающий называется наставником. */
  mentor: boolean;
  withCompanionAllowed: boolean;
  my: { firstVisit: boolean; withCompanion: boolean } | null;
  /** Можно отметить «Я здесь впервые»: активная запись и событие впереди. */
  canMark: boolean;
  /** Памятка новичку: только подтверждённому участнику, отметившему «впервые». */
  memo: { find: string; who: string; expect: string } | null;
  /** Новички: организатору и встречающему. */
  newcomers: (PersonShort & { status: ParticipationStatus; withCompanion: boolean })[] | null;
  isGreeter: boolean;
  canManage: boolean;
  /** Кого организатор может назначить: он сам и подтверждённые участники. */
  candidates: PersonShort[] | null;
}

/** С3: состояние срочного добора для организатора. */
export interface UrgentView {
  eventId: ID;
  active: boolean;
  need: number;
  /** Сколько ещё нужно сейчас. */
  remaining: number;
  notified: number;
  createdAt: ISODate | null;
  /** Можно включить: событие впереди, до начала от 1 до 48 часов, есть места. */
  canStart: boolean;
  reason: string;
  maxNeed: number;
  until: ISODate;
}

/** С2: обезличенная группа спроса — без имён и контактов. */
export interface DemandGroupView {
  key: string;
  sport: SportView;
  slot: DemandSlot;
  slotLabel: string;
  districtId: ID | null;
  districtName: string | null;
  people: number;
  fromSearch: number;
  fromCompanions: number;
  beginners: number;
  /** Сколько из них получат приглашение: искали, войдя в аккаунт. */
  reachable: number;
  /** Направление клуба. */
  ours: boolean;
  offer: { eventId: ID; title: string; startsAt: ISODate; invited: number } | null;
  suggestion: { title: string; date: string; time: string; districtId: ID | null; address: string };
}

export interface DemandView {
  groups: DemandGroupView[];
  /** Людей в маленьких группах (меньше трёх) — их не показываем, чтобы никого нельзя было узнать. */
  hidden: number;
  minGroup: number;
}

export interface ParticipantView extends Participation {
  user: PersonShort & { level: SkillLevel | null; age: number | null };
  waitlistPosition: number | null;
  /** D-16: человек в действующем стоп-листе организатора этой встречи. */
  stopListed?: boolean;
}

/** Новая заявка из стопки «Разобрать по одной» по всем своим событиям (`participations?scope=organizer_pending`). */
export interface OrganizerPendingView extends ParticipantView {
  event: {
    id: ID;
    title: string;
    startsAt: ISODate;
    capacity: number | null;
    /** Занятые места в составе, дети считаются. */
    confirmedCount: number;
    /** null — без лимита мест. */
    seatsLeft: number | null;
    joinMode: SportEvent['joinMode'];
    sport: { id: ID; name: string };
    coverUrl: string | null;
  };
  /** Сколько мест займёт заявка при «Принять»: заявитель, его дети и ждущие участники команды. */
  seats: number;
  /** Сколько прошедших встреч у заявителя на платформе — то же, что `UserView.facts.attended`. */
  attended: number;
  /** Отметил «Я здесь впервые» на этой встрече. */
  firstVisit: boolean;
}

export interface EventDetails extends EventView {
  participants: PersonShort[];
  /** Только организатору и админу. */
  manage: {
    confirmed: ParticipantView[];
    pending: ParticipantView[];
    waitlist: ParticipantView[];
    declined: ParticipantView[];
  } | null;
  messagesCount: number;
  /** В3: что нужно для игры — строки списка без отметок (их отдаёт GET /events/:id/gear). */
  gear?: GearLine[];
}

export interface MessageView extends Omit<Message, 'text'> {
  /** null — сообщение скрыто модератором или удалено автором, текст не показываем. */
  text: string | null;
  author: (PersonShort & { isOrganizer: boolean; orgName: string | null; orgLogoUrl: string | null }) | null;
  mine: boolean;
  myReactions: string[];
  event: { id: ID; title: string };
}

export interface UserView {
  id: ID;
  name: string;
  avatarUrl: string | null;
  initials: string;
  age: number | null;
  city: string;
  districtId: ID | null;
  districtName: string | null;
  about: string;
  interests: SportView[];
  levels: Record<ID, SkillLevel>;
  readiness: Readiness | null;
  facts: OrganizerFacts & { attended: number; sportsTried: number };
  createdAt: ISODate;
}

export interface Identity extends UserView {
  role: AccessRole;
  userRole: User['role'];
  email: string;
  phone: string;
  home: GeoPoint | null;
  radiusKm: User['radiusKm'];
  /** С14: `managed` — человек соуправляющий, а не владелец страницы. */
  orgs: { id: ID; name: string; status: OrgStatus; managed?: boolean }[];
  demo: User['demo'];
  unreadNotifications: number;
  /** В7: пол из профиля; null — не указан. Другим людям не показывается. */
  gender?: Gender | null;
}

export interface OrganizationView extends Organization {
  sports: SportView[];
  typeLabel: string;
  facts: OrganizerFacts;
  isOwner: boolean;
  /** С14: текущий человек — соуправляющий: публикует встречи и рассматривает заявки, но не меняет сведения. */
  isManager?: boolean;
  lastReview: Organization['reviews'][number] | null;
  owner: PersonShort | null;
  eventsCount: number;
  /** Похожие названия — для админа, чтобы ловить дубли. */
  similar: string[];
}

export interface CompanionView extends CompanionRequest {
  isDemo?: boolean;
  author: PersonShort & { level: SkillLevel | null };
  sport: SportView;
  districtName: string | null;
  metooCount: number;
  metooPeople: PersonShort[];
  iMetoo: boolean;
  isMine: boolean;
  matchReasons: string[];
  distanceKm: number | null;
}

export type NotificationView = AppNotification;

export interface AuditView extends AuditEntry {
  actorName: string;
  ruleTitle: string | null;
}

export interface AdminStats {
  pendingOrgs: number;
  flaggedMessages: number;
  flaggedEvents: number;
  flaggedOrgs: number;
  publishedEvents: number;
  removedEvents: number;
  customSports: number;
  week: { newEvents: number; joins: number; questions: number; answeredQuestions: number };
}

export interface DemoState {
  assistantFailure: boolean;
  /** Как помощник «ломается»: сразу ошибкой или не отвечает вовремя. */
  assistantFailureMode: 'error' | 'timeout';
  schemaVersion: number;
  seededAt: ISODate;
  /** Даты демо-данных сдвинуты на сегодня: когда и на сколько дней. Для плашки «Данные обновлены». */
  datesShiftedAt: ISODate | null;
  datesShiftedDays: number;
}

/** Ответ 409 `sport_similar`: похожие направления, из которых можно выбрать вместо нового. */
export interface SportSimilarError {
  code: 'sport_similar';
  statusCode: 409;
  message: string;
  similar: SportSuggestion[];
}

export interface SearchFilters {
  q?: string;
  sportIds?: ID[];
  when?: 'today' | 'tomorrow' | 'weekend' | 'week' | 'date';
  date?: ISODate;
  dayPart?: 'morning' | 'day' | 'evening';
  level?: EventLevel;
  beginners?: boolean;
  free?: boolean;
  priceMax?: number;
  joinMode?: SportEvent['joinMode'];
  near?: boolean;
  radiusKm?: number;
  districtId?: ID;
  /** В7: состав события. */
  composition?: Composition;
  /** Н6: «Семейные» — можно с детьми, «Для детей» — детские занятия. */
  family?: 'family' | 'kids';
}

type EventLevel = SportEvent['level'];

export interface SearchChip {
  key: keyof SearchFilters;
  label: string;
  value: unknown;
}

export interface ParsedSearch {
  filters: SearchFilters;
  chips: SearchChip[];
  /** Слова, которые помощник не понял, — уходят в текстовый поиск. */
  rest: string;
}

export type DraftKind = 'event' | 'companion' | 'organization';

export interface DraftQuestion {
  field: string;
  question: string;
  options: { label: string; value: unknown }[];
  allowCustom: boolean;
}

export interface AssistantDraft<T> {
  kind: DraftKind;
  draft: Partial<T>;
  /** Поля, заполненные помощником, с ответом на «почему так». */
  filled: { field: string; why: string }[];
  missing: DraftQuestion[];
  /** Направление не нашлось в каталоге — будет создано новое (или предложены похожие). */
  newSport: { name: string; similar: SportSuggestion[] } | null;
}

// ---------- Запись: пересечения, серия, похожие встречи (С6, С9, С10) ----------

/** С9: запись или событие, которое идёт в то же время. */
export interface TimeConflict {
  eventId: ID;
  title: string;
  startsAt: ISODate;
  durationMin: number;
  /** Человек на это событие записан или сам его проводит. */
  role: 'participant' | 'organizer';
}

/** С9: ответ 409 `time_conflict` на запись с `checkConflicts: true`. */
export interface TimeConflictError {
  code: 'time_conflict';
  statusCode: 409;
  message: string;
  conflicts: TimeConflict[];
}

/** С10: встречи серии и что с каждой из них у человека. */
export interface SeriesView {
  seriesId: ID;
  until: ISODate;
  events: EventView[];
}

export type SeriesJoinOutcome = 'confirmed' | 'pending' | 'waitlist' | 'already' | 'skipped';

export interface SeriesJoinResult {
  results: { eventId: ID; startsAt: ISODate; outcome: SeriesJoinOutcome; reason: string }[];
  joined: number;
  skipped: number;
}

/** С6: похожие встречи взамен отменённой или перенесённой. */
export interface PlanBView {
  eventId: ID;
  reason: 'cancelled' | 'reschedule' | null;
  alternatives: EventView[];
}

export type {
  AppNotification,
  AuditEntry,
  CompanionRequest,
  District,
  Message,
  Organization,
  Participation,
  PlatformRule,
  SportCategory,
};

// ---------- В4, В5, Н1: площадки, подбор места, доступная среда ----------

/** Площадка в карточке события и в подсказках. */
export interface VenueShort {
  id: ID;
  name: string;
  kind: VenueKind;
  address: string;
  pricePerHour: number;
}

export interface EventAccess {
  /** Условия площадки, относящиеся к доступной среде. */
  venue: VenueFeature[];
  /** Что добавил организатор: сопровождающий, адаптивный инвентарь. */
  extras: EventAccessExtra[];
}

export type VenueSlotStatus = 'free' | 'busy' | 'event';

export interface VenueSlotView {
  startsAt: ISODate;
  endsAt: ISODate;
  status: VenueSlotStatus;
  /** Цена за час в этом окне. */
  price: number;
  /** Окно изменено владельцем вручную. */
  custom: boolean;
  /** Окно занято встречей с платформы. */
  event: { id: ID; title: string } | null;
}

export interface VenueDay {
  /** Местная дата площадки, YYYY-MM-DD. */
  date: string;
  slots: VenueSlotView[];
  freeCount: number;
}

/** Соседние свободные окна одним отрезком: «сб 10:00–14:00». */
export interface VenueWindow {
  startsAt: ISODate;
  endsAt: ISODate;
  /** Самая высокая цена за час внутри отрезка. */
  price: number;
}

export interface VenueView extends Omit<Venue, 'slots'> {
  sports: SportView[];
  kindLabel: string;
  districtName: string | null;
  org: { id: ID; name: string; verified: boolean };
  isOwner: boolean;
  /** Сколько дней назад владелец обновлял сведения или окна. */
  ownerUpdatedDays: number;
  distanceKm: number | null;
  /** Ближайшие свободные отрезки на две недели вперёд (до трёх). */
  nextWindows: VenueWindow[];
  /** Свободных окон в выбранный день или за две недели. */
  freeCount: number;
  upcomingEvents: number;
}

export interface VenueDetails extends VenueView {
  days: VenueDay[];
}

export interface BestPlaceNeeds {
  features?: VenueFeature[];
  /** true — только крытые, false — только открытые, null — не важно. */
  indoor?: boolean | null;
  /** Аренда за час не дороже. */
  priceMax?: number | null;
  /** Только площадки, где окно свободно в нужное время. */
  freeAtTime?: boolean;
}

export interface BestPlaceInput {
  eventId?: ID;
  companionId?: ID;
  sportId?: ID | null;
  /** Время встречи: у события — его время, у новой встречи — выбранное в форме. */
  startsAt?: ISODate | null;
  durationMin?: number | null;
  needs?: BestPlaceNeeds;
}

export interface BestPlaceGroup {
  districtId: ID;
  districtName: string;
  people: number;
}

export interface BestPlaceOption {
  venue: VenueView;
  avgKm: number;
  maxKm: number;
  /** Расстояние от центра каждого района. */
  distances: (BestPlaceGroup & { km: number })[];
  /** Почему подходит: «есть пандус», «свободно в сб 10:00–12:00». */
  reasons: string[];
  /** Одна строка объяснения для экрана. */
  summary: string;
  /** Чем вариант выделяется: «Ближе всего в среднем», «Самому дальнему ближе всего». */
  badges: string[];
  /** Окно, свободное в нужное время, или ближайшее свободное. */
  window: VenueWindow | null;
  freeAtTime: boolean | null;
  isCurrent: boolean;
}

export interface BestPlaceResult {
  groups: BestPlaceGroup[];
  /** Сколько человек учтено и сколько без района. */
  counted: number;
  withoutDistrict: number;
  options: BestPlaceOption[];
  /** Площадок по условиям до сортировки. */
  matched: number;
  /** Подсказка, какое условие мешает, если ничего не нашлось. */
  relax: string | null;
}

export type { AccessNeed };

// ---------- С12, С13, Н3, Н6: тем же составом, по приглашению, командой, с детьми ----------

/** Подсказка «кого записать или пригласить»: только зарегистрированные люди, без почты и телефона. */
export interface PersonSuggestion extends PersonShort {
  /** Район или «совпала почта» — чтобы отличить тёзок. */
  hint: string;
}

export interface TeamMemberView {
  user: PersonShort;
  status: TeamMemberStatus;
}

export interface TeamView {
  id: ID;
  eventId: ID;
  captain: PersonShort;
  members: TeamMemberView[];
  until: ISODate;
  needsApproval: boolean;
  accepted: boolean;
  status: 'active' | 'closed';
  /** Всего мест команды вместе с тем, кто записывал. */
  seats: number;
}

/** Н3: что видит человек в карточке события. */
export interface TeamState {
  /** Команда, которую записал я. */
  mine: TeamView | null;
  /** Меня записали в команду: нужно подтвердить место или отказаться. */
  invitation: (TeamView & { myStatus: TeamMemberStatus }) | null;
  /** Сколько друзей можно записать вместе с собой; 0 — сейчас нельзя. */
  maxFriends: number;
  /** Почему нельзя записать команду. */
  reason: string;
}

/** С13: ссылка-приглашение для организатора. */
export interface InviteLinkView {
  visibility: EventVisibility;
  code: string;
  /** Путь ссылки: /events/:id?invite=код. */
  path: string;
  /** Организатор — компания: можно «Пригласить своих». */
  company: boolean;
  /** Сколько человек открывали действующую ссылку. */
  opened: number;
}

export interface InviteSendResult {
  sent: PersonShort[];
  already: PersonShort[];
  notFound: string[];
}

/** С12: кого позовём «Собраться снова». */
export interface AgainPreview {
  eventId: ID;
  title: string;
  invitees: PersonShort[];
}

/** Что включено на сервере: подтверждение почты при регистрации и сброс пароля по письму. */
export interface AuthConfig {
  emailVerification: boolean;
  passwordReset: boolean;
  /** Запасной путь, если письмо не пришло: подтвердить аккаунт кодом из SMS. */
  phoneVerification: boolean;
}

/**
 * Итог действия со ссылкой из письма, кодом из SMS или отправки письма. Коды: token_invalid, token_expired,
 * token_used, rate_limited (retryAfter — через сколько секунд можно снова), email_not_verified, validation,
 * sms_unavailable, sms_failed, code_invalid (attemptsLeft), code_expired, invalid_credentials,
 * offline (в этой версии письма и SMS не отправляются), network и прочие ошибки сервера.
 */
export interface AuthFlowResult {
  ok: boolean;
  code?: string;
  message?: string;
  retryAfter?: number;
  email?: string;
  fieldErrors?: Record<string, string>;
  /** Код из SMS отправлен: через сколько секунд можно запросить новый и сколько секунд он действует. */
  resendIn?: number;
  expiresIn?: number;
  attemptsLeft?: number;
}

/** Подтверждение аккаунта: настройки сервера, ссылка из письма, повторное письмо и запасной путь по SMS. */
export interface EmailAuth {
  config(): Promise<AuthConfig>;
  verifyEmail(token: string): Promise<AuthFlowResult>;
  resendVerification(email: string): Promise<AuthFlowResult>;
  /** Пароль подтверждает, что номер добавляет владелец аккаунта; хранится только в памяти вкладки. */
  sendPhoneCode(email: string, password: string, phone: string): Promise<AuthFlowResult>;
  /** Успех — вход в аккаунт, как по ссылке из письма. */
  verifyPhoneCode(email: string, phone: string, code: string): Promise<AuthFlowResult>;
  /**
   * Удалить свой аккаунт; пароль подтверждает, что удаляет владелец. Сессию вкладки не трогает:
   * после успеха экран уходит с личной страницы и выходит из аккаунта (logout).
   */
  deleteAccount(password: string): Promise<AuthFlowResult>;
}

// ---------- Подборка дня ----------

/** GET и PUT /me/digest. */
export interface DigestSettings {
  on: boolean;
  hour: number;
  hours: number[];
  email: boolean;
  /** Можно ли включить письма: почта есть, настоящая и подтверждена. */
  emailAllowed: boolean;
  emailReason: string | null;
  emailAddress: string | null;
  cityName: string;
  timeZone: string;
  last: { id: ID; createdAt: ISODate; count: number } | null;
}

/** PUT /me/digest: любые из полей. */
export interface DigestSettingsInput {
  on?: boolean;
  hour?: number;
  email?: boolean;
}

/** GET /digests/:id: встречи подборки с причинами на момент отправки. */
export interface DigestView {
  id: ID;
  createdAt: ISODate;
  trigger: 'schedule' | 'manual';
  mail: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | null;
  items: { event: EventView; reasons: string[] }[];
}

/** POST /me/digest/send-now. */
export interface DigestSendResult {
  sent: boolean;
  message: string;
  digest: DigestView | null;
}

// ---------- D-16: стоп-лист организатора ----------

/** Чей стоп-лист: `user:<id>` — личный организатор, `org:<id>` — клуб. */
export type StopOwnerKey = `user:${string}` | `org:${string}`;

export type StopEntryState = 'active' | 'expired' | 'lifted';

/** Строка стоп-листа. `note` видят только организатор и соуправляющие; администратору приходит пустой. */
export interface StopEntryView {
  id: ID;
  owner: { kind: 'user' | 'org'; id: ID; name: string };
  user: PersonShort;
  reasonCode: StopReasonCode;
  /** Готовая подпись: «Не приходит без предупреждения» или текст «Другое». */
  reasonLabel: string;
  reasonText: string;
  note: string;
  until: ISODate | null;
  state: StopEntryState;
  addedBy: PersonShort;
  createdAt: ISODate;
  liftedAt: ISODate | null;
  liftedBy: PersonShort | null;
  liftedReason: string;
}

/** GET /stop-list?owner=…: список и права текущего человека на него. */
export interface StopListView {
  owner: { kind: 'user' | 'org'; id: ID; name: string };
  entries: StopEntryView[];
  canEdit: boolean;
}

/** GET /stop-list/preview?owner=…&userId=…: что будет при добавлении (для окна). */
export interface StopPreview {
  user: PersonShort;
  /** Предстоящие встречи этого организатора, где человек записан, ждёт решения или в очереди. */
  upcoming: { eventId: ID; title: string; startsAt: ISODate; status: ParticipationStatus }[];
  /** Уже в стоп-листе — окно предлагает обновить причину и срок. */
  existing: StopEntryView | null;
  /** Нельзя добавить (себя, команду клуба, администратора): готовый текст. */
  blockedReason: string | null;
}

/** POST /stop-list. */
export interface StopAddInput {
  owner: StopOwnerKey;
  userId: ID;
  reasonCode: StopReasonCode;
  reasonText?: string;
  note?: string;
  term: StopTerm;
  /** Отменить записи человека на предстоящие встречи этого организатора (по умолчанию в окне включено). */
  cancelUpcoming: boolean;
}

export interface StopAddResult {
  entry: StopEntryView;
  /** Сколько записей отменено на предстоящих встречах. */
  cancelled: number;
}

/** POST /participations/:id/remove: убрать из участников одной встречи. */
export interface RemoveParticipantInput {
  reason?: string;
  /** Сразу добавить в стоп-лист организатора этой встречи. */
  stop?: Omit<StopAddInput, 'owner' | 'userId'> | null;
}

/** Для администратора: стоп-листы, где упоминается организация или человек. */
export interface AdminStopSummary {
  entries: StopEntryView[];
  /** Сколько разных организаторов добавили человека за 30 дней (для профиля пользователя). */
  recentOwners: number;
}

/** Сигнал в обзоре админки: человек в стоп-листах у 3+ организаторов за 30 дней. */
export interface StopSignal {
  user: PersonShort;
  owners: number;
  lastAt: ISODate;
}
