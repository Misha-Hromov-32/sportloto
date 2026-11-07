import type { I18nProvider } from '@refinedev/core';

/** Русские тексты служебных сообщений Refine (уведомления об ошибках и сохранении). */
const RU: Record<string, string> = {
  'notifications.success': 'Готово',
  'notifications.error': 'Не получилось',
  'notifications.undoable': 'Можно отменить',
  'notifications.createSuccess': 'Сохранено',
  'notifications.createError': 'Не удалось сохранить',
  'notifications.editSuccess': 'Изменения сохранены',
  'notifications.editError': 'Не удалось сохранить изменения',
  'notifications.deleteSuccess': 'Удалено',
  'notifications.deleteError': 'Не удалось удалить',
  warnWhenUnsavedChanges: 'Вы не сохранили изменения. Уйти со страницы?',
  'buttons.save': 'Сохранить',
  'buttons.cancel': 'Отмена',
  'buttons.delete': 'Удалить',
  'buttons.confirm': 'Подтвердить',
  'buttons.refresh': 'Обновить',
  'buttons.logout': 'Выйти',
  'pages.error.404': 'Такой страницы нет',
};

export const i18nProvider: I18nProvider = {
  translate: (key: string, _options?: unknown, defaultMessage?: string) => RU[key] ?? defaultMessage ?? key,
  changeLocale: async () => undefined,
  getLocale: () => 'ru',
};
