import type { OrgEmblemKey } from '@/lib/eventImages';

export type EmblemKey = OrgEmblemKey;
export type EmblemTone = 'accent' | 'ink';

export type LogoChoice =
  | { kind: 'monogram' }
  | { kind: 'emblem'; emblem: EmblemKey; tone: EmblemTone }
  /** Своя картинка: квадрат 512×512, кадр выбран в форме. */
  | { kind: 'upload'; url: string };

/** Логотип показывается квадратом со скруглением (`Avatar shape="org"`). */
export const LOGO_OUTPUT = { width: 512 };

/** Знаки рисуются цветом `currentColor`: в выборе — цветом темы, в сохранённом логотипе — цветами логотипа. */
export const EMBLEMS: { key: EmblemKey; label: string; markup: string }[] = [
  {
    key: 'ball',
    label: 'Мяч',
    markup:
      '<g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><circle cx="32" cy="32" r="20"/><path d="M12 32h40M32 12c-9 7-9 33 0 40M32 12c9 7 9 33 0 40"/></g>',
  },
  {
    key: 'peaks',
    label: 'Вершины',
    markup: '<path fill="currentColor" d="M6 50 26 18l10 16 6-9 16 25z"/>',
  },
  {
    key: 'waves',
    label: 'Волны',
    markup:
      '<g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M10 22c5-5 9-5 14 0s9 5 14 0 9-5 14 0"/><path d="M10 33c5-5 9-5 14 0s9 5 14 0 9-5 14 0"/><path d="M10 44c5-5 9-5 14 0s9 5 14 0 9-5 14 0"/></g>',
  },
  {
    key: 'star',
    label: 'Звезда',
    markup:
      '<path fill="currentColor" d="M32 8l6.5 16.5H56L42 35.5 47.5 54 32 43 16.5 54 22 35.5 8 24.5h17.5z"/>',
  },
  {
    key: 'stripes',
    label: 'Полосы',
    markup:
      '<g fill="currentColor"><path d="M8 50 22 14h7L15 50z"/><path d="M21 50 35 14h7L28 50z"/><path d="M34 50 48 14h7L41 50z"/></g>',
  },
  {
    key: 'target',
    label: 'Мишень',
    markup:
      '<g fill="none" stroke="currentColor" stroke-width="4"><circle cx="32" cy="32" r="21"/><circle cx="32" cy="32" r="12"/></g><circle fill="currentColor" cx="32" cy="32" r="4"/>',
  },
];

export const TONES: { key: EmblemTone; label: string }[] = [
  { key: 'accent', label: 'Красный' },
  { key: 'ink', label: 'Чёрный' },
];

/**
 * Логотип сохраняется картинкой, поэтому цвета берутся из токенов светлой темы в момент сохранения:
 * у организации один логотип во всех темах, а значения по-прежнему живут только в tokens.css.
 */
function lightTokens(): Record<'accent' | 'accentInk' | 'ink' | 'bg', string> {
  const probe = document.createElement('span');
  probe.setAttribute('data-theme', 'light');
  probe.hidden = true;
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const tokens = {
    accent: read('--accent'),
    accentInk: read('--accent-ink'),
    ink: read('--ink'),
    bg: read('--bg'),
  };
  probe.remove();
  return tokens;
}

export function emblemUrl(emblem: EmblemKey, tone: EmblemTone): string {
  const item = EMBLEMS.find((e) => e.key === emblem) ?? EMBLEMS[0]!;
  const t = lightTokens();
  const [bg, fg] = tone === 'accent' ? [t.accent, t.accentInk] : [t.ink, t.bg];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" data-emblem="${item.key}" data-tone="${tone}"><rect width="64" height="64" fill="${bg}"/><g color="${fg}">${item.markup}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function emblemFromUrl(url: string): LogoChoice | null {
  if (!url.startsWith('data:image/svg+xml')) return null;
  const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1));
  const emblem = svg.match(/data-emblem="(\w+)"/)?.[1] as EmblemKey | undefined;
  const tone = svg.match(/data-tone="(\w+)"/)?.[1] as EmblemTone | undefined;
  if (!emblem || !EMBLEMS.some((e) => e.key === emblem)) return null;
  return { kind: 'emblem', emblem, tone: tone === 'ink' ? 'ink' : 'accent' };
}

export function logoChoiceOf(url: string | null | undefined): LogoChoice {
  if (!url) return { kind: 'monogram' };
  return emblemFromUrl(url) ?? { kind: 'upload', url };
}

export function logoUrlOf(choice: LogoChoice): string | null {
  if (choice.kind === 'emblem') return emblemUrl(choice.emblem, choice.tone);
  if (choice.kind === 'upload') return choice.url;
  return null;
}
