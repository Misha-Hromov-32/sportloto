import type { PersonShort } from './api';
import type { EventState, ID, ISODate, OrganizerRef, OrgStatus, OrgType } from './domain';
import type { ShelfSale } from './payments'; // оплата на сайте

/** В3 + С7: инвентарь для игры, общая полка вещей и помощь от партнёров. */

export type GearKind =
  | 'ball'
  | 'racket'
  | 'shuttle'
  | 'bibs'
  | 'mat'
  | 'poles'
  | 'net'
  | 'cones'
  | 'board'
  | 'clock'
  | 'skis'
  | 'protection'
  | 'other';

/** Строка «что нужно для игры» в событии: «Ракетка — 4». */
export interface GearLine {
  id: ID;
  eventId: ID;
  name: string;
  kind: GearKind;
  quantity: number;
  createdAt: ISODate;
}

export type ShelfCondition = 'new' | 'good' | 'used';
export type ShelfTerm = 'return_after' | 'no_deposit' | 'pickup' | 'bring_to_place' | 'kids_only';

/** Вещь на общей полке: её дают на время. */
export interface ShelfItem {
  id: ID;
  owner: OrganizerRef;
  createdBy: ID;
  name: string;
  kind: GearKind;
  sportId: ID | null;
  quantity: number;
  condition: ShelfCondition;
  districtId: ID | null;
  terms: ShelfTerm[];
  note: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** Продаётся: цена за штуку. Нет поля или null — только на время. */
  sale?: ShelfSale | null;
  /** Фото вещи. Нет — показываем значок по типу вещи. */
  photoUrl?: string | null;
}

export type LoanStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'returned';

/** Просьба дать вещь с полки на конкретное событие. */
export interface GearLoan {
  id: ID;
  itemId: ID;
  eventId: ID;
  lineId: ID | null;
  requesterId: ID;
  quantity: number;
  comment: string;
  status: LoanStatus;
  reason: string;
  createdAt: ISODate;
  decidedAt: ISODate | null;
  returnedAt: ISODate | null;
}

export type SupportStatus = 'open' | 'closed' | 'cancelled';
export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';

export interface SupportOffer {
  id: ID;
  sponsorOrgId: ID;
  userId: ID;
  comment: string;
  status: OfferStatus;
  at: ISODate;
  decidedAt: ISODate | null;
}

/** Потребность клуба, которую может закрыть партнёр. Денег и оплаты нет. */
export interface SupportNeed {
  id: ID;
  orgId: ID;
  eventId: ID | null;
  title: string;
  details: string;
  /** До какого момента нужна помощь (конец дня), null — без срока. */
  deadline: ISODate | null;
  status: SupportStatus;
  offers: SupportOffer[];
  closedByOrgId: ID | null;
  closedAt: ISODate | null;
  createdBy: ID;
  createdAt: ISODate;
}

// ---------- Ответы API ----------

export interface OwnerView {
  kind: 'user' | 'org';
  id: ID;
  name: string;
  avatarUrl: string | null;
  link: string;
  orgType: OrgType | null;
}

export interface GearLineView extends GearLine {
  covered: number;
  missing: number;
  pledges: { person: PersonShort; quantity: number; mine: boolean }[];
  loans: { id: ID; from: OwnerView; quantity: number; status: LoanStatus; mine: boolean }[];
  myPledge: number;
}

export interface EventGearView {
  eventId: ID;
  eventTitle: string;
  state: EventState;
  lines: GearLineView[];
  totals: { needed: number; covered: number; missing: number };
  can: {
    pledge: boolean;
    request: boolean;
    edit: boolean;
    askSponsors: boolean;
  };
  /** Почему нельзя отметить «Возьму с собой» — для подсказки под блоком. */
  pledgeHint: string;
  support: SupportNeedView[];
}

export interface ShelfItemView extends ShelfItem {
  ownerView: OwnerView;
  available: number;
  inUse: number;
  districtName: string | null;
  sportName: string | null;
  isMine: boolean;
  pendingRequests: number;
}

export interface LoanView extends GearLoan {
  item: { id: ID; name: string; kind: GearKind };
  ownerView: OwnerView;
  requester: PersonShort;
  event: { id: ID; title: string; startsAt: ISODate; state: EventState };
  lineName: string | null;
  isOwner: boolean;
  isRequester: boolean;
  /** Телефон владельца — просившему после согласия, чтобы договориться о передаче. */
  contact: string | null;
}

export interface SupportOfferView extends SupportOffer {
  sponsor: OwnerView;
  person: PersonShort;
}

export interface SupportNeedView extends SupportNeed {
  org: OwnerView;
  event: { id: ID; title: string; startsAt: ISODate; state: EventState } | null;
  offers: SupportOfferView[];
  closedBy: OwnerView | null;
  isOwner: boolean;
  myOffer: SupportOfferView | null;
  /** Партнёры, от имени которых смотрящий может откликнуться. */
  offerAs: { id: ID; name: string }[];
  overdue: boolean;
}

export interface InventoryOrg {
  id: ID;
  name: string;
  type: OrgType;
  status: OrgStatus;
}

/** Что текущий человек может делать с полкой и потребностями. */
export interface InventoryMe {
  userId: ID | null;
  /** Допущенные организации, от имени которых можно делиться вещами. */
  shareAs: InventoryOrg[];
  /** Допущенные клубы, которые могут просить о помощи. */
  clubs: InventoryOrg[];
  /** Допущенные партнёры. */
  sponsors: InventoryOrg[];
  /** Ближайшие события, на которые можно попросить вещь: свои и где человек участник. */
  events: { id: ID; title: string; startsAt: ISODate; isOrganizer: boolean }[];
  incomingPending: number;
}

// ---------- Тела запросов ----------

export interface GearLineInput {
  id?: ID;
  name: string;
  kind?: GearKind;
  quantity: number;
}

export interface ShelfItemInput {
  /** От имени допущенной организации; без него — от себя. */
  orgId?: ID | null;
  name: string;
  /** Без типа сервер определит его по названию. */
  kind?: GearKind;
  sportId?: ID | null;
  quantity: number;
  condition: ShelfCondition;
  districtId?: ID | null;
  terms: ShelfTerm[];
  note?: string;
  /** Продаю: цена за штуку; null — снять с продажи. */
  sale?: ShelfSale | null;
}

export interface SupportNeedInput {
  orgId: ID;
  eventId?: ID | null;
  title: string;
  details?: string;
  deadline?: ISODate | null;
}
