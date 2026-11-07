/** `dark` больше не выбирается: сохранённое значение переводится в «Графит» (`midnight`). */
export type ThemeName = 'light' | 'dark' | 'pink' | 'midnight';

/** Прежняя «Тёмная» тема убрана из выбора — у тех, кто её выбирал, включается «Графит». */
function normalizeTheme(theme: ThemeName | undefined): ThemeName {
  return theme === 'dark' ? 'midnight' : (theme ?? 'light');
}

export interface UiSettings {
  theme: ThemeName;
  largeText: boolean;
  simple: boolean;
  leftHand: boolean;
  notify: {
    /** Всплывающие сообщения о новых уведомлениях, пока вы на сайте. */
    popups: boolean;
    applications: boolean;
    changes: boolean;
    answers: boolean;
  };
}

export const DEFAULT_SETTINGS: UiSettings = {
  theme: 'light',
  largeText: false,
  simple: false,
  leftHand: false,
  notify: { popups: true, applications: true, changes: true, answers: true },
};

/** Стартовые настройки демо-аккаунтов: Пётр Иванович сразу видит крупный текст и простой режим. */
const DEMO_DEFAULTS: Record<string, Partial<UiSettings>> = {
  'u-petr': { largeText: true, simple: true },
};

const KEY = (userId: string | null) => `vmeste.settings:${userId ?? 'guest'}`;
/** Настройки активного аккаунта — их читает скрипт в index.html до первой отрисовки. */
export const ACTIVE_KEY = 'vmeste.settings.active';

export function loadSettings(userId: string | null): UiSettings {
  try {
    const raw = localStorage.getItem(KEY(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UiSettings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        theme: normalizeTheme(parsed.theme),
        notify: { ...DEFAULT_SETTINGS.notify, ...parsed.notify },
      };
    }
  } catch {
    /* повреждённые настройки — берём по умолчанию */
  }
  return { ...DEFAULT_SETTINGS, ...(userId ? DEMO_DEFAULTS[userId] : undefined) };
}

export function saveSettings(userId: string | null, settings: UiSettings) {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(settings));
  } catch {
    /* хранилище недоступно — настройки живут до перезагрузки */
  }
}

/** Применяет настройки к <html>: тема, размер текста, простой режим, рука. */
export function applySettings(settings: UiSettings) {
  const root = document.documentElement;
  root.dataset.theme = normalizeTheme(settings.theme);
  if (settings.largeText) root.dataset.text = 'large';
  else delete root.dataset.text;
  if (settings.simple) root.dataset.simple = '';
  else delete root.dataset.simple;
  root.dataset.hand = settings.leftHand ? 'left' : 'right';
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (meta && bg) meta.setAttribute('content', bg);
  try {
    const value = JSON.stringify(settings);
    sessionStorage.setItem(ACTIVE_KEY, value);
    localStorage.setItem(ACTIVE_KEY, value);
  } catch {
    /* без хранилища — без сохранения */
  }
}

export const THEME_OPTIONS: { value: ThemeName; label: string; hint: string }[] = [
  { value: 'light', label: 'Светлая', hint: 'Лучше читается днём и на улице' },
  { value: 'midnight', label: 'Графит', hint: 'Тёмная, холодный свет и тонкие линии' },
  { value: 'pink', label: 'Для девочек', hint: 'Мягкий розовый фон' },
];
