import { count, plural } from '@/lib/plural';
import type { EventFamily } from '@/types/domain';

export const YEAR_WORDS = ['год', 'года', 'лет'] as const;

/** «5 лет», «2 года». */
export const ageText = (n: number) => count(n, YEAR_WORDS);

/** Родительный падеж после «от» и «до»: «от 1 года», «до 7 лет». */
const yearsGenitive = (n: number) => `${n}\u00A0${plural(n, YEAR_WORDS) === 'год' ? 'года' : 'лет'}`;

export function familyLabel(f: EventFamily): string {
  const ages =
    f.minAge !== null && f.maxAge !== null
      ? `${f.minAge}–${f.maxAge}\u00A0${plural(f.maxAge, YEAR_WORDS)}`
      : f.minAge !== null
        ? `от ${yearsGenitive(f.minAge)}`
        : f.maxAge !== null
          ? `до ${yearsGenitive(f.maxAge)}`
          : '';
  return [f.kind === 'kids' ? 'Для детей' : 'Можно с детьми', ages].filter(Boolean).join(' · ');
}
