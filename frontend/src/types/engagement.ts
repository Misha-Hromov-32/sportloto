import type { EventView } from './api';
import type { EventLevel, ID, ISODate, JoinMode } from './domain';

// ---------- С8: избранное, подписки, сохранённые поиски ----------

export interface FavoriteEvent {
  userId: ID;
  eventId: ID;
  at: ISODate;
}

export type FollowKind = 'org' | 'user';

export interface FollowView {
  kind: FollowKind;
  id: ID;
  name: string;
  avatarUrl: string | null;
  caption: string;
  link: string;
  upcoming: number;
  at: ISODate;
}

export interface SavedSearchView {
  id: ID;
  name: string;
  query: string;
  summary: string;
  /** Сколько встреч подходит сейчас. */
  matches: number;
  createdAt: ISODate;
}

export interface FavoritesView {
  events: EventView[];
  follows: FollowView[];
  searches: SavedSearchView[];
}

// ---------- С11: шаблоны быстрого создания ----------

export interface EventTemplate {
  id: ID;
  name: string;
  hint: string;
  /** Имя иконки Phosphor из каталога направлений. */
  icon: string | null;
  sportId: ID;
  /** Дополнительные поля направления: формат игры, контроль времени. */
  extra: Record<string, string>;
  fields: {
    title: string;
    description: string;
    durationMin: number;
    capacity: number | null;
    minParticipants: number | null;
    level: EventLevel;
    beginnersWelcome: boolean;
    joinMode: JoinMode;
    time: string;
    bring: string;
    preparation: string;
    intensity: 'low' | 'medium' | 'high';
    firstTimeNote: string;
  };
}

// ---------- С14: выгрузка участников ----------

export interface ParticipantsExport {
  filename: string;
  csv: string;
  rows: number;
}

// ---------- С15: «Встреча состоялась?» ----------

export type HeldAnswer = 'yes' | 'no';

/** Вопрос участнику после встречи. */
export interface HeldCheck {
  canAnswer: boolean;
  answer: HeldAnswer | null;
  /** Ответить можно до этого времени. */
  until: ISODate;
}

// ---------- «Поделиться с близким» ----------

export interface ShareState {
  canShare: boolean;
  reason: string;
  link: { token: string; path: string; expiresAt: ISODate; createdAt: ISODate } | null;
}

export type SharedStatus = 'active' | 'cancelled' | 'expired' | 'revoked' | 'left';

/** Что видит близкий по ссылке: только то, что видит сам участник. */
export interface SharedCard {
  status: SharedStatus;
  participantName: string;
  title: string;
  sportName: string;
  startsAt: ISODate;
  durationMin: number;
  address: string;
  howToFind: string;
  organizerName: string;
  organizerContact: string;
  privateInfo: string;
  cancelReason: string;
  expiresAt: ISODate;
}

// ---------- Н5: карточки ближайших записей без интернета ----------

export interface OfflineCard {
  eventId: ID;
  title: string;
  sportName: string;
  startsAt: ISODate;
  durationMin: number;
  address: string;
  howToFind: string;
  bring: string;
  organizerName: string;
  organizerContact: string;
  privateInfo: string;
}
