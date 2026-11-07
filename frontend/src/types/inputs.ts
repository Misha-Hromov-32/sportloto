import type { GearLineInput } from './inventory';
import type { PaymentMode } from './payments'; // оплата на сайте
import type {
  CancelPolicy,
  Composition,
  EventLevel,
  EventVisibility,
  EventFamily,
  FirstStep,
  GeoPoint,
  ID,
  ISODate,
  JoinMode,
  OrgType,
  Price,
  Readiness,
  SkillLevel,
  User,
  EventAccessExtra,
  VenueFeature,
  VenueKind,
} from './domain';

/** Тела запросов. Валидация — на сервере. */

export interface EventInput {
  title: string;
  description: string;
  sportId?: ID;
  /** Своё направление, если в каталоге не нашлось. */
  newSportName?: string;
  /** Опубликовать от имени организации (только допущенной). */
  orgId?: ID | null;
  startsAt: ISODate;
  durationMin: number;
  place: { address: string; landmark?: string; districtId?: ID | null; lat?: number; lng?: number };
  level: EventLevel;
  beginnersWelcome: boolean;
  firstStep: Partial<FirstStep>;
  price: Price;
  paymentNote?: string;
  cancelPolicy: CancelPolicy;
  joinMode: JoinMode;
  capacity: number | null;
  minParticipants: number | null;
  privateInfo?: string;
  discussion?: 'everyone' | 'participants';
  extra?: Record<string, string>;
  coverUrl?: string | null;
  repeatWeeklyUntil?: ISODate | null;
  createdWithAssistant?: boolean;
  /** Из какого объявления «Ищу компанию» собрана встреча. */
  companionId?: ID | null;
  /** Создать своё направление, даже если в каталоге есть похожее (после ответа `sport_similar`). */
  confirmNew?: boolean;
  /** Ключ повтора: второй запрос с тем же ключом вернёт уже созданное событие. */
  idempotencyKey?: string;
  /** В7: кто может записаться; по умолчанию смешанный состав. */
  composition?: Composition;
  /** В4: площадка встречи; null — без площадки. */
  venueId?: ID | null;
  /** Н1: что организатор добавляет к условиям площадки. */
  accessExtras?: EventAccessExtra[];
  /** В3: что нужно для игры. В правке список заменяется целиком, без поля — не меняется. */
  gear?: GearLineInput[];
  /** С13: «по приглашению» — событие не видно в ленте и поиске. */
  visibility?: EventVisibility;
  /** Н6: можно с детьми или для детей; null — для взрослых. */
  family?: EventFamily | null;
  /** С12: собираемся снова — после публикации пригласить участников этой прошедшей встречи. */
  againFrom?: ID | null;
  /** Оплата на сайте (только «с человека» или складчина); по умолчанию на месте. */
  paymentMode?: PaymentMode;
}

export type EventPatch = Partial<
  Pick<
    EventInput,
    | 'title'
    | 'description'
    | 'startsAt'
    | 'durationMin'
    | 'place'
    | 'level'
    | 'beginnersWelcome'
    | 'firstStep'
    | 'price'
    | 'paymentNote'
    | 'cancelPolicy'
    | 'joinMode'
    | 'capacity'
    | 'minParticipants'
    | 'privateInfo'
    | 'discussion'
    | 'extra'
    | 'coverUrl'
    | 'composition'
    | 'venueId'
    | 'accessExtras'
    | 'gear'
    | 'visibility'
    | 'family'
    | 'paymentMode'
  >
>;

export interface CompanionInput {
  sportId?: ID;
  newSportName?: string;
  text: string;
  districtId: ID | null;
  point?: GeoPoint | null;
  when: string;
  level: SkillLevel;
  readiness: Readiness;
  createdWithAssistant?: boolean;
  /** Создать своё направление, даже если в каталоге есть похожее. */
  confirmNew?: boolean;
}

export interface OrganizationInput {
  name: string;
  type: OrgType;
  description: string;
  sportIds: ID[];
  city: string;
  districtId: ID | null;
  address: string;
  contacts: { phone: string; email: string; social: string };
  logoUrl?: string | null;
  coverUrl?: string | null;
  createdWithAssistant?: boolean;
}

export type ProfilePatch = Partial<
  Pick<
    User,
    | 'name'
    | 'about'
    | 'districtId'
    | 'interests'
    | 'levels'
    | 'readiness'
    | 'home'
    | 'radiusKm'
    | 'phone'
    | 'age'
    | 'gender'
  >
>;

export interface RegisterInput {
  name: string;
  email?: string;
  /** Пароль для входа по почте; хранится на сервере только хешем. */
  password?: string;
  districtId?: ID | null;
  interests?: ID[];
  level?: SkillLevel;
}

// ---------- В4: площадки ----------

export interface VenueInput {
  name: string;
  kind: VenueKind;
  description: string;
  address: string;
  landmark?: string;
  districtId: ID | null;
  lat?: number;
  lng?: number;
  sportIds: ID[];
  indoor: boolean;
  pricePerHour: number;
  peakPricePerHour: number | null;
  features: VenueFeature[];
  photoUrl?: string | null;
  contacts: { phone: string; email: string; site: string };
  hours: { open: string; close: string };
  status?: 'active' | 'hidden';
}
