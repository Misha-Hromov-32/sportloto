/**
 * Почта для регистрации: только российские почтовые сервисы (406-ФЗ от 31.07.2023, действует с 01.12.2023).
 * То же правило на сервере: backend/app/services/email_policy.py. Уже созданные аккаунты входят как раньше.
 */

const SHAPE = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/;

/** Почтовые сервисы российских компаний на доменах вне .ru. */
const RUSSIAN_PROVIDERS = new Set(['yandex.com', 'yandex.by', 'yandex.kz', 'yandex.uz', 'ya.ru']);

/** .ru, .su, .рф, .рус, .москва, .moscow, .дети, .tatar — в записи punycode и кириллицей. */
const RUSSIAN_ZONES = new Set([
  'ru',
  'su',
  'xn--p1ai',
  'рф',
  'xn--p1acf',
  'рус',
  'xn--80adxhks',
  'москва',
  'moscow',
  'xn--d1acj3b',
  'дети',
  'tatar',
]);

/** Служебные зоны (RFC 2606): почту из интернета не принимают, нужны для проверок. */
const TEST_ZONES = new Set(['test', 'example', 'localhost', 'invalid']);

const KNOWN_FOREIGN = [
  'gmail.',
  'googlemail.',
  'outlook.',
  'hotmail.',
  'live.',
  'msn.',
  'icloud.',
  'me.com',
  'mac.com',
  'yahoo.',
  'ymail.',
  'aol.',
  'proton.',
  'protonmail.',
  'pm.me',
  'gmx.',
  'zoho.',
  'tutanota.',
  'tuta.',
  'mail.com',
];

export const ALLOWED_EMAIL_HINT = 'Подойдёт почта Яндекса, Mail.ru, Рамблера или адрес на домене .ru и .рф';

function domainOf(email: string): string | null {
  const match = SHAPE.exec(email.trim().toLowerCase());
  return match?.[1] ? match[1].replace(/\.$/, '') : null;
}

export function isAllowedEmail(email: string): boolean {
  const domain = domainOf(email);
  if (!domain) return false;
  if (RUSSIAN_PROVIDERS.has(domain)) return true;
  const zone = domain.slice(domain.lastIndexOf('.') + 1);
  return RUSSIAN_ZONES.has(zone) || TEST_ZONES.has(zone);
}

/** Текст ошибки, если адрес не подходит. Под полем формы подсказка уже есть — там `hint: false`. */
export function foreignEmailMessage(email: string, { hint = true } = {}): string {
  const domain = domainOf(email) ?? '';
  const known = KNOWN_FOREIGN.some((name) => domain.startsWith(name));
  const text = known
    ? `Почту ${domain} зарегистрировать нельзя: по закону нужен российский сервис.`
    : 'Нужна почта российского сервиса.';
  return hint ? `${text} ${ALLOWED_EMAIL_HINT}` : text;
}
