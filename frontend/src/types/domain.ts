import type { OrgSuspension } from './community'; // С17
import type { EventPayCollect, PaymentMode } from './payments'; // оплата на сайте

export type ID = string;
export type ISODate = string;

/** `deleted` — аккаунт удалён по просьбе владельца, запись обезличена. */
export type UserRole = 'user' | 'admin' | 'deleted';
/** Роль для интерфейса и прав: представитель организации — это пользователь с организацией. */
export type AccessRole = 'guest' | 'user' | 'org' | 'admin';

export type SkillLevel = 'beginner' | 'amateur' | 'experienced';
export type EventLevel = 'any' | SkillLevel;
export type Readiness = 'join' | 'organize';
export type AiFlag = 'none' | 'spam' | 'toxic' | 'suspicious';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface District extends GeoPoint {
  id: ID;
  name: string;
}

export interface User {
  id: ID;
  name: string;
  avatarUrl: string | null;
  age: number | null;
  role: UserRole;
  city: string;
  districtId: ID | null;
  about: string;
  interests: ID[];
  levels: Record<ID, SkillLevel>;
  readiness: Readiness | null;
  /** Точка отсчёта для «Рядом со мной». */
  home: GeoPoint | null;
  radiusKm: 1 | 3 | 5 | 10;
  email: string;
  phone: string;
  demo: { title: string; hint: string; order: number } | null;
  createdAt: ISODate;
  /** В7: пол указывают добровольно; null — «Не указывать». Видит только сам человек. */
  gender?: Gender | null;
}

/** В7: кто может записаться на событие. */
export type Composition = 'mixed' | 'women' | 'men';
export type Gender = 'female' | 'male';

export interface SportCategory {
  id: ID;
  name: string;
  icon: string;
  order: number;
  parentId: ID | null;
  fields: ExtraField[];
}

/** Дополнительное поле события, заданное данными каталога, а не кодом. */
export interface ExtraField {
  key: string;
  label: string;
  type: 'select' | 'text';
  options?: string[];
  placeholder?: string;
}

export type SportKind = 'catalog' | 'custom';

export interface Sport {
  id: ID;
  name: string;
  synonyms: string[];
  categoryIds: ID[];
  /** Имя иконки Phosphor. У пользовательского направления нет иконки — показываем монограмму. */
  icon: string | null;
  kind: SportKind;
  popular: boolean;
  fields: ExtraField[];
  mergedInto: ID | null;
  createdBy: ID | null;
  createdAt: ISODate;
}

export type OrganizerRef = { kind: 'user'; id: ID } | { kind: 'org'; id: ID };

export interface EventPlace extends GeoPoint {
  address: string;
  landmark: string;
  districtId: ID | null;
}

export type Intensity = 'low' | 'medium' | 'high';

/** Паспорт «Первый шаг»: всё, что снимает вопрос «подойду ли я». */
export interface FirstStep {
  intensity: Intensity;
  bring: string;
  preparation: string;
  age: string;
  howToFind: string;
  amenities: string[];
  firstTimeNote: string;
}

export type Price =
  { kind: 'free' } | { kind: 'fixed'; amount: number } | { kind: 'split'; total: number; note: string };

export type CancelPolicy =
  { kind: 'anytime' } | { kind: 'hoursBefore'; hours: number } | { kind: 'eveBefore'; time: string };

export type JoinMode = 'open' | 'approval';
export type PublicationStatus = 'published' | 'cancelled' | 'removed' | 'deleted';

/** Состояние события для экрана: публикация плюс время. */
export type EventState = 'upcoming' | 'live' | 'past' | 'cancelled' | 'removed' | 'deleted';

export interface Moderation {
  action: 'removed' | 'deleted';
  ruleId: ID | null;
  comment: string;
  /** Кто из админов принял решение. Видно только админу, остальным приходит пустая строка. */
  by: ID;
  at: ISODate;
  /** Организатор исправил карточку и попросил вернуть публикацию. */
  appeal?: { at: ISODate; comment: string } | null;
}

export interface ChangeItem {
  field: 'startsAt' | 'place' | 'capacity' | 'price' | 'joinMode' | 'duration' | 'composition';
  label: string;
  from: string;
  to: string;
}

export interface EventChange {
  id: ID;
  at: ISODate;
  items: ChangeItem[];
  acknowledgedBy: ID[];
}

export interface Series {
  id: ID;
  rule: 'weekly';
  until: ISODate;
}

export interface SportEvent {
  id: ID;
  title: string;
  description: string;
  sportId: ID;
  organizer: OrganizerRef;
  createdBy: ID;
  startsAt: ISODate;
  durationMin: number;
  place: EventPlace;
  level: EventLevel;
  beginnersWelcome: boolean;
  firstStep: FirstStep;
  price: Price;
  paymentNote: string;
  cancelPolicy: CancelPolicy;
  joinMode: JoinMode;
  capacity: number | null;
  /** Порог сбора: событие состоится, если наберётся столько участников. */
  minParticipants: number | null;
  status: PublicationStatus;
  moderation: Moderation | null;
  cancelReason: string;
  changes: EventChange[];
  series: Series | null;
  /** Сведения только для подтверждённых участников: телефон, код домофона и т. п. */
  privateInfo: string;
  discussion: 'everyone' | 'participants';
  extra: Record<string, string>;
  coverUrl: string | null;
  /** Фото с состоявшейся встречи, добавленные организатором. */
  photos?: EventPhoto[];
  createdWithAssistant: boolean;
  aiFlag: AiFlag;
  aiReason: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** В4: площадка, на которой проходит встреча. Условия доступности наследуются от неё. */
  venueId?: ID | null;
  /** Н1: что организатор добавил к условиям площадки. */
  accessExtras?: EventAccessExtra[];
  /** В7: состав; нет поля — смешанный. */
  composition?: Composition;
  /** С13: «по приглашению» — нет в ленте и поиске, открывается по ссылке с кодом. */
  visibility?: EventVisibility;
  /** С13: код ссылки-приглашения. Видят организатор и администратор. */
  inviteCode?: string;
  /** Н6: можно прийти с детьми или занятие для детей. */
  family?: EventFamily | null;
  /** Оплата на сайте; нет поля — на месте или переводом. */
  paymentMode?: PaymentMode;
  /** Итог сбора складчины с оплатой на сайте. */
  payCollect?: EventPayCollect | null;
}

export type ParticipationStatus =
  | 'confirmed'
  | 'pending'
  | 'rejected'
  | 'waitlist'
  | 'cancelled'
  /** Событие снято модератором: запись заморожена, при возврате восстанавливается. */
  | 'event_removed'
  /** D-16: организатор убрал человека из участников этой встречи. Записаться снова на неё нельзя. */
  | 'removed';

export interface Participation {
  id: ID;
  eventId: ID;
  userId: ID;
  status: ParticipationStatus;
  prevStatus: ParticipationStatus | null;
  note: string;
  rejectReason: string;
  /** Пришёл по приглашению или через «Собрать встречу». */
  source: 'self' | 'invite' | 'gathered';
  /** Н1: участнику нужно сопровождение. Видят он сам и организатор. */
  needsEscort?: boolean;
  createdAt: ISODate;
  decidedAt: ISODate | null;
  /** С4: место из листа ожидания придержано до `until`; человек подтверждает «Иду» или отказывается. */
  offer?: { until: ISODate; at: ISODate } | null;
  /** С6: запись отменена, потому что событие перенесли на неудобное время. */
  leftBecause?: 'reschedule' | null;
  /** Н6: дети, которых записал взрослый. Каждый занимает место. */
  children?: ChildSeat[];
  /** Н6: занимает ли место сам взрослый; на занятии для детей — нет, он только сопровождает. */
  adultSeat?: boolean;
  /** Н3: запись в составе команды. */
  teamId?: ID | null;
  /** D-16: почему организатор убрал из участников (видит сам человек и организатор). */
  removedReason?: string;
}

/** D-16: почему организатор не пускает человека на свои встречи. Категорию видит и сам человек. */
export type StopReasonCode = 'no_show' | 'rude' | 'rules' | 'other';

/** D-16: срок записи в стоп-листе при добавлении. */
export type StopTerm = 'forever' | 'month' | 'three_months';

/**
 * D-16: запись стоп-листа организатора. Список личного организатора (`ownerKind: 'user'`)
 * или общий список клуба (`ownerKind: 'org'`: владелец и соуправляющие). Одна запись на пару
 * владелец списка + человек.
 */
export interface StopEntry {
  id: ID;
  ownerKind: 'user' | 'org';
  ownerId: ID;
  userId: ID;
  reasonCode: StopReasonCode;
  /** Текст для «Другое» (от 5 знаков); для остальных категорий пустой. Видит и сам человек. */
  reasonText: string;
  /** Заметка для себя и соуправляющих. Человек и администратор её не видят. */
  note: string;
  /** До какого момента действует; null — пока не уберут. */
  until: ISODate | null;
  addedBy: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** Администратор снял запрет: запись не действует, организатор видит причину. */
  liftedAt: ISODate | null;
  liftedBy: ID | null;
  liftedReason: string;
}

export type ReactionKey = 'thanks' | 'agree' | 'going';

export type MessageStatus = 'visible' | 'hidden' | 'deleted';

export interface Message {
  id: ID;
  eventId: ID;
  authorId: ID | null;
  asOrgId: ID | null;
  text: string;
  replyTo: ID | null;
  reactions: Partial<Record<ReactionKey, ID[]>>;
  status: MessageStatus;
  hiddenReason: string;
  /** Кто скрыл: скрытое админом организатор вернуть не может. */
  hiddenBy?: 'admin' | 'organizer' | null;
  system: boolean;
  aiFlag: AiFlag;
  aiReason: string;
  createdAt: ISODate;
  /** С14: организатор закрепил своё объявление сверху обсуждения. */
  pinnedAt?: ISODate | null;
}

export type OrgType =
  | 'club'
  | 'circle'
  | 'federation'
  | 'company'
  | 'school'
  | 'coach'
  | 'initiative'
  /** В3 + С7: спонсор или партнёр — помогает клубам вещами, проходит тот же допуск. */
  | 'sponsor'
  /** В4: владелец площадок — проходит тот же допуск администратором. */
  | 'venue';
export type OrgStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'returned' | 'blocked';

export interface OrganizationReview {
  id: ID;
  decision: 'submitted' | 'approved' | 'rejected' | 'returned';
  reason: string;
  adminId: ID | null;
  at: ISODate;
}

export interface Organization {
  id: ID;
  name: string;
  type: OrgType;
  description: string;
  sportIds: ID[];
  city: string;
  districtId: ID | null;
  address: string;
  contacts: { phone: string; email: string; social: string };
  logoUrl: string | null;
  /** Широкое фото в шапке страницы организации. */
  coverUrl?: string | null;
  ownerId: ID;
  status: OrgStatus;
  reviews: OrganizationReview[];
  createdWithAssistant: boolean;
  aiFlag: AiFlag;
  aiReason: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** С17: допуск приостановлен администратором — новые встречи не публикуются. */
  suspension?: OrgSuspension | null;
}

export type CompanionStatus = 'open' | 'gathered' | 'closed';

export interface CompanionRequest {
  id: ID;
  authorId: ID;
  sportId: ID;
  text: string;
  districtId: ID | null;
  point: GeoPoint | null;
  when: string;
  level: SkillLevel;
  readiness: Readiness;
  metoo: { userId: ID; at: ISODate }[];
  status: CompanionStatus;
  eventId: ID | null;
  createdWithAssistant: boolean;
  createdAt: ISODate;
}

// ---------- С1, С2, С3, Н2: встречающий, спрос, срочный добор, программа для ветеранов ----------

/** С1: участник отметил «Я здесь впервые». */
export interface FirstVisit {
  eventId: ID;
  userId: ID;
  /** Н2: придёт с близким человеком (только на событиях программы). */
  withCompanion: boolean;
  at: ISODate;
}

/** С2: удобное время в спросе — будни или выходные плюс часть дня. */
export type DemandSlot =
  | 'weekday_morning'
  | 'weekday_day'
  | 'weekday_evening'
  | 'weekend_morning'
  | 'weekend_day'
  | 'weekend_evening'
  | 'any';

/** Н2: метка программы на событии. Статус человека не храним, отмечается только событие. */
export type EventProgramKind = 'veterans';

export type NotificationType =
  /** Оплата на сайте: срок, оплата, возврат, снятие записи, складчина, заказы вещей, зачисления и выплаты. */
  | 'pay_due'
  | 'pay_received'
  | 'pay_refund'
  | 'pay_expired'
  | 'pay_collected'
  | 'pay_failed'
  | 'order_paid'
  | 'order_done'
  | 'order_canceled'
  | 'money_credited'
  | 'payout_sent'
  | 'payout_failed'
  /** D-16: организатор не пускает на свои встречи / убрал из участников / администратор снял запрет. */
  | 'stop_listed'
  | 'removed_from_event'
  | 'stop_lifted'
  | 'joined'
  | 'left'
  | 'application'
  | 'accepted'
  | 'rejected'
  | 'waitlist_promoted'
  | 'question'
  | 'answer'
  | 'changed'
  | 'cancelled'
  | 'removed'
  | 'restored'
  | 'deleted'
  | 'message_hidden'
  | 'org_submitted'
  | 'org_approved'
  | 'org_rejected'
  | 'org_returned'
  | 'invite'
  | 'metoo'
  | 'gathered'
  /** Набрался порог сбора: встреча состоится. */
  | 'threshold_reached'
  /** Участников снова меньше порога — организатору. */
  | 'threshold_lost'
  /** Человек встал в лист ожидания (ему самому). */
  | 'waitlist_joined'
  /** Организатор просит вернуть снятое событие — админам. */
  | 'appeal'
  /** В3 + С7: инвентарь с общей полки и помощь партнёров. */
  | 'gear_request'
  | 'gear_accepted'
  | 'gear_rejected'
  | 'gear_cancelled'
  | 'gear_returned'
  | 'support_new'
  | 'support_offer'
  | 'support_accepted'
  | 'support_declined'
  /** С4: освободилось место, оно придержано для человека из листа ожидания. */
  | 'waitlist_offer'
  /** С4: человек не подтвердил место вовремя, оно перешло дальше. */
  | 'offer_expired'
  /** С9: напоминание за сутки и за 2 часа. */
  | 'reminder'
  /** С6: подобраны похожие встречи взамен отменённой или перенесённой. */
  | 'plan_b'
  /** Н1: участник отметил, что ему нужно сопровождение, — организатору. */
  | 'escort_needed'
  /** С1: организатор попросил встретить новичков; новичок отметил «Я здесь впервые». */
  | 'greeter'
  | 'first_visit'
  /** С3: срочно нужны игроки на встречу в ближайшие двое суток. */
  | 'urgent'
  /** С2: клуб предлагает встречу тем, кто искал компанию. */
  | 'demand_offer'
  /** С16, С17, В8: решение по жалобе, приостановка допуска, переданная страница сообщества. */
  | 'report_upheld'
  | 'report_dismissed'
  | 'org_suspended'
  | 'org_resumed'
  | 'import_transferred'
  /** С8, С14, С15: новая встреча по подписке, управляющий клуба, «Встреча состоялась?». */
  | 'new_match'
  | 'manager_added'
  | 'manager_removed'
  | 'held_question'
  /** Н3: новости записи командой — кто подтвердил место, кто отказался. */
  | 'team'
  /** Подборка дня: до трёх подходящих встреч раз в день. */
  | 'digest';

/** Отправленная подборка: какие встречи и почему, чтобы не присылать их снова. */
export interface Digest {
  id: ID;
  userId: ID;
  items: { eventId: ID; reasons: string[] }[];
  createdAt: ISODate;
  day: string;
  trigger: 'schedule' | 'manual';
  /** Письмо: в очереди, отправляется, ушло, не ушло, не нужно; null — письма нет. */
  mail: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | null;
  mailAt: ISODate | null;
  intro: string | null;
}

export interface AppNotification {
  id: ID;
  userId: ID;
  type: NotificationType;
  title: string;
  text: string;
  link: string;
  read: boolean;
  createdAt: ISODate;
}

export type AuditAction =
  /** Оплата на сайте: возврат и выплата администратором, ставки. */
  | 'payment.refund'
  | 'payout.done'
  | 'payout.fail'
  | 'payments.settings'
  /** D-16: стоп-лист организатора. */
  | 'stop.add'
  | 'stop.update'
  | 'stop.remove'
  | 'stop.lift'
  | 'participation.remove'
  | 'org.approve'
  | 'org.reject'
  | 'org.return'
  | 'event.remove'
  | 'event.restore'
  | 'event.delete'
  | 'event.cancel'
  | 'event.reschedule'
  | 'message.hide'
  | 'message.restore'
  | 'sport.create'
  | 'sport.promote'
  | 'sport.merge'
  | 'participation.accept'
  | 'participation.reject'
  | 'event.appeal'
  | 'event.keep'
  | 'message.keep'
  /** С16, С17, В8: жалобы, приостановка допуска, импорт из сообществ. */
  | 'report.uphold'
  | 'report.dismiss'
  | 'org.suspend'
  | 'org.resume'
  | 'import.publish'
  | 'import.reject'
  | 'import.transfer';

export interface AuditEntry {
  id: ID;
  actorId: ID;
  action: AuditAction;
  targetType:
    | 'org'
    | 'event'
    | 'message'
    | 'sport'
    | 'participation'
    | 'import'
    | 'user'
    /** Оплата на сайте. */
    | 'payment'
    | 'payout'
    | 'settings';
  targetId: ID;
  targetTitle: string;
  ruleId: ID | null;
  reason: string;
  at: ISODate;
}

export interface PlatformRule {
  id: ID;
  number: number;
  title: string;
  text: string;
}

// ---------- В4, Н1: площадки, свободные окна и доступная среда ----------

export type VenueKind = 'hall' | 'field' | 'court' | 'pool' | 'ice' | 'studio' | 'yard' | 'park';

/** Условия площадки. Первые четыре — доступная среда для маломобильных людей (МГН). */
export type VenueFeature =
  'ramp' | 'elevator' | 'accessibleToilet' | 'accessibleParking' | 'lockerRoom' | 'shower' | 'lighting';

/** Что организатор встречи добавляет к условиям площадки. */
export type EventAccessExtra = 'escort' | 'adaptiveGear';

/** Что человек может попросить в фильтре «Нужна доступная среда». */
export type AccessNeed = 'ramp' | 'elevator' | 'accessibleToilet' | 'escort';

/**
 * Окно расписания, которое владелец изменил вручную. Остальные окна в часы работы
 * считаются свободными по базовой цене: хранить всё расписание не нужно.
 */
export interface VenueSlotOverride {
  startsAt: ISODate;
  free: boolean;
  /** Цена за час для этого окна; null — базовая. */
  price: number | null;
}

export interface Venue {
  id: ID;
  /** Организация с типом «Площадка», которая ведёт расписание. */
  orgId: ID;
  name: string;
  kind: VenueKind;
  description: string;
  address: string;
  landmark: string;
  districtId: ID | null;
  lat: number;
  lng: number;
  sportIds: ID[];
  indoor: boolean;
  /** Цена аренды за час, 0 — бесплатно. */
  pricePerHour: number;
  /** Цена за час вечером (с 18:00) и в выходные; null — как обычно. */
  peakPricePerHour: number | null;
  features: VenueFeature[];
  photoUrl: string | null;
  contacts: { phone: string; email: string; site: string };
  /** Часы работы по местному времени: окна по 2 часа от открытия до закрытия. */
  hours: { open: string; close: string };
  timeZone: string;
  slots: VenueSlotOverride[];
  status: 'active' | 'hidden';
  /** Когда владелец последний раз обновлял сведения или окна. */
  ownerUpdatedAt: ISODate;
  createdAt: ISODate;
}

// ---------- С12, С13, Н3, Н6: тем же составом, по приглашению, командой, с детьми ----------

/** С13: кто видит событие. */
export type EventVisibility = 'public' | 'invite';

/** Н6: «Можно с детьми» (взрослые с детьми) или «Для детей» (место занимает ребёнок, взрослый сопровождает). */
export interface EventFamily {
  kind: 'family' | 'kids';
  /** Возраст детей, включительно; null — без ограничения. */
  minAge: number | null;
  maxAge: number | null;
}

export interface ChildSeat {
  name: string;
  age: number;
}

/** Н3: место в команде. `agreed` — согласился, пока организатор не принял заявку команды. */
export type TeamMemberStatus = 'invited' | 'agreed' | 'joined' | 'declined' | 'expired';

export interface EventPhoto {
  id: string;
  url: string;
  caption: string;
}
