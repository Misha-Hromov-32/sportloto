import { StyleProvider, type Transformer } from '@ant-design/cssinjs';
import { App as AntdApp, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { buildAntdTheme } from './antd';
import { applySettings, loadSettings, saveSettings, type UiSettings } from './settings';
import { SettingsContext } from './useSettings';

/**
 * Ant Design добавляет на весь сайт `a:hover { color: colorLinkHover }`. Это правило сильнее классов
 * компонентов, поэтому ссылка-кнопка при наведении получала красный текст на красном фоне, а подписи
 * карточек на фото — красный на фото. Цвет наведения у ссылок задают сами компоненты.
 */
const keepLinkColor: Transformer = {
  visit: (style) => {
    const link = style.a;
    if (!link || typeof link !== 'object' || Array.isArray(link)) return style;
    const { '&:hover': hover, '&:active': active, ...rest } = link as Record<string, unknown>;
    const strip = (state: unknown) => {
      if (!state || typeof state !== 'object') return state;
      const { color: _color, ...other } = state as Record<string, unknown>;
      return other;
    };
    return { ...style, a: { ...rest, '&:hover': strip(hover), '&:active': strip(active) } } as typeof style;
  },
};
const TRANSFORMERS = [keepLinkColor];

/**
 * Настройки внешнего вида хранятся отдельно для каждого аккаунта (и гостя).
 * Атрибуты на <html> ставятся синхронно при изменении, поэтому тема Ant Design
 * сразу читает новые значения CSS-переменных.
 */
export function ThemeProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const [state, setState] = useState(() => {
    const settings = loadSettings(userId);
    applySettings(settings);
    return { userId, settings };
  });

  let current = state;
  if (state.userId !== userId) {
    current = { userId, settings: loadSettings(userId) };
    applySettings(current.settings);
    setState(current);
  }
  const { settings } = current;

  const update = useCallback((patch: Partial<UiSettings>) => {
    setState((prev) => {
      const next = { ...prev.settings, ...patch, notify: { ...prev.settings.notify, ...patch.notify } };
      applySettings(next);
      saveSettings(prev.userId, next);
      return { ...prev, settings: next };
    });
  }, []);

  const antdTheme = useMemo(() => buildAntdTheme(settings), [settings]);
  const value = useMemo(() => ({ settings, update }), [settings, update]);

  return (
    <SettingsContext.Provider value={value}>
      <StyleProvider transformers={TRANSFORMERS}>
        <ConfigProvider
          theme={antdTheme}
          locale={ruRU}
          componentSize="middle"
          wave={{ disabled: true }}
          form={{ requiredMark: false, scrollToFirstError: { behavior: 'smooth', block: 'center' } }}
        >
          <AntdApp
            notification={{ placement: 'bottomRight', bottom: 96, maxCount: 3 }}
            message={{ maxCount: 2 }}
          >
            {children}
          </AntdApp>
        </ConfigProvider>
      </StyleProvider>
    </SettingsContext.Provider>
  );
}
