const rules = new Intl.PluralRules('ru-RU');

type Forms = readonly [string, string, string];

/** forms: [одна, две, пять] — «участник», «участника», «участников». */
export function plural(n: number, forms: Forms): string {
  const rule = rules.select(n);
  if (rule === 'one') return forms[0];
  if (rule === 'few') return forms[1];
  return forms[2];
}

/** «5 участников» с неразрывным пробелом. */
export function count(n: number, forms: Forms): string {
  return `${n.toLocaleString('ru-RU')}\u00A0${plural(n, forms)}`;
}

export const WORDS = {
  participant: ['участник', 'участника', 'участников'],
  person: ['человек', 'человека', 'человек'],
  place: ['место', 'места', 'мест'],
  event: ['событие', 'события', 'событий'],
  meeting: ['встреча', 'встречи', 'встреч'],
  application: ['заявка', 'заявки', 'заявок'],
  question: ['вопрос', 'вопроса', 'вопросов'],
  answer: ['ответ', 'ответа', 'ответов'],
  minute: ['минута', 'минуты', 'минут'],
  hour: ['час', 'часа', 'часов'],
  day: ['день', 'дня', 'дней'],
  sport: ['направление', 'направления', 'направлений'],
  notification: ['уведомление', 'уведомления', 'уведомлений'],
  message: ['сообщение', 'сообщения', 'сообщений'],
  response: ['отклик', 'отклика', 'откликов'],
  organization: ['организация', 'организации', 'организаций'],
} as const satisfies Record<string, Forms>;
