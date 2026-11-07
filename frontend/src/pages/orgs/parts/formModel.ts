import type { DraftQuestion, OrganizationView } from '@/types/api';
import type { OrgType } from '@/types/domain';
import type { OrganizationInput } from '@/types/inputs';

import { logoChoiceOf, type LogoChoice } from './logos';

export type OrgField = 'name' | 'type' | 'description' | 'sportIds' | 'districtId' | 'address' | 'contacts';
/** Поля с картинками: помощник их не заполняет, ошибки по ним приходят от сервера. */
export type MediaField = 'logoUrl' | 'coverUrl';
export type ErrorField = OrgField | MediaField;

export interface OrgFormValues {
  name: string;
  type: OrgType | null;
  description: string;
  sportIds: string[];
  /** Своё направление, которого нет в каталоге: создаётся при отправке, без дублей. */
  customSports: string[];
  city: string;
  districtId: string | null;
  address: string;
  phone: string;
  email: string;
  social: string;
  logo: LogoChoice;
  /** Обложка страницы: data URL после кадрирования или сохранённый адрес. */
  coverUrl: string | null;
  createdWithAssistant: boolean;
  /** Поля, которые заполнил помощник, с ответом на «почему так». Правка поля снимает пометку. */
  assisted: Partial<Record<OrgField, string>>;
}

export type OrgErrors = Partial<Record<ErrorField | 'form', string>>;

export const EMPTY_VALUES: OrgFormValues = {
  name: '',
  type: null,
  description: '',
  sportIds: [],
  customSports: [],
  city: 'Красноярск',
  districtId: null,
  address: '',
  phone: '',
  email: '',
  social: '',
  logo: { kind: 'monogram' },
  coverUrl: null,
  createdWithAssistant: false,
  assisted: {},
};

export const DESCRIPTION_MIN = 30;

export function valuesFromOrg(org: OrganizationView): OrgFormValues {
  return {
    name: org.name,
    type: org.type,
    description: org.description,
    sportIds: org.sportIds,
    customSports: [],
    city: org.city || 'Красноярск',
    districtId: org.districtId,
    address: org.address,
    phone: org.contacts.phone,
    email: org.contacts.email,
    social: org.contacts.social,
    logo: logoChoiceOf(org.logoUrl),
    coverUrl: org.coverUrl ?? null,
    createdWithAssistant: org.createdWithAssistant,
    assisted: {},
  };
}

export function toInput(
  values: OrgFormValues,
  sportIds: string[],
  logoUrl: string | null,
): OrganizationInput {
  return {
    name: values.name.trim(),
    type: values.type ?? 'club',
    description: values.description.trim(),
    sportIds,
    city: values.city.trim() || 'Красноярск',
    districtId: values.districtId,
    address: values.address.trim(),
    contacts: { phone: values.phone.trim(), email: values.email.trim(), social: values.social.trim() },
    logoUrl,
    coverUrl: values.coverUrl,
    createdWithAssistant: values.createdWithAssistant,
  };
}

/** Те же правила, что проверяет сервер: показываем все ошибки сразу, до отправки. */
export function validate(values: OrgFormValues): OrgErrors {
  const errors: OrgErrors = {};
  if (values.name.trim().length < 3) errors.name = 'Напишите название, хотя бы 3 буквы';
  if (!values.type) errors.type = 'Выберите, кто вы: клуб, секция, тренер или другое';
  const left = DESCRIPTION_MIN - values.description.trim().length;
  if (left > 0) errors.description = 'Расскажите подробнее, чем вы занимаетесь: хотя бы 30 знаков';
  if (!values.sportIds.length && !values.customSports.length)
    errors.sportIds = 'Выберите хотя бы одно направление';
  if (!values.phone.trim() && !values.email.trim()) errors.contacts = 'Укажите телефон или почту для связи';
  else if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()))
    errors.contacts = 'Проверьте почту: в ней должен быть знак @ и точка, например club@mail.ru';
  return errors;
}

export const FIELD_ORDER: ErrorField[] = [
  'name',
  'type',
  'description',
  'logoUrl',
  'coverUrl',
  'sportIds',
  'districtId',
  'address',
  'contacts',
];

export const FIELD_LABEL: Record<ErrorField, string> = {
  name: 'Название',
  type: 'Кто вы',
  description: 'О деятельности',
  logoUrl: 'Логотип',
  coverUrl: 'Обложка страницы',
  sportIds: 'Направления',
  districtId: 'Район',
  address: 'Где проходят занятия',
  contacts: 'Контакты',
};

export function fieldId(field: OrgField): string {
  return `org-${field}`;
}

export function hasContent(values: OrgFormValues): boolean {
  return Boolean(
    values.name.trim() ||
    values.description.trim() ||
    values.sportIds.length ||
    values.customSports.length ||
    values.phone.trim() ||
    values.email.trim(),
  );
}

/** «vk.com/club» → ссылка, которую можно открыть. */
export function socialHref(value: string): string {
  const v = value.trim();
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

export function socialLabel(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
}

export function describedBy(id: string, hint: boolean, error?: string): string | undefined {
  return [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
}

export interface AssistantState {
  text: string;
  stage: 'input' | 'result';
  questions: DraftQuestion[];
}

export const EMPTY_ASSISTANT: AssistantState = { text: '', stage: 'input', questions: [] };
