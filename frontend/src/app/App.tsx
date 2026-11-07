import { useNotificationProvider } from '@refinedev/antd';
import { Refine, type HttpError } from '@refinedev/core';
import routerProvider, { DocumentTitleHandler, UnsavedChangesNotifier } from '@refinedev/react-router';
import { useEffect, useSyncExternalStore } from 'react';
import { BrowserRouter } from 'react-router';

import { accessControlProvider, authProvider, authSession, dataProvider, liveProvider } from '@/api';
import { getSelectedCity, loadCities } from '@/lib/cities';
import { SeoSync } from '@/lib/seo';
import { ThemeProvider } from '@/theme/ThemeProvider';

import { i18nProvider } from './i18n';
import { AppRoutes } from './routes';
import { ChatLauncher } from './components/ChatLauncher';

const resources = [
  {
    name: 'events',
    list: '/events',
    show: '/events/:id',
    create: '/events/new',
    edit: '/events/:id/manage',
    meta: { label: 'События' },
  },
  { name: 'companions', list: '/companions', create: '/companions/new', meta: { label: 'Ищу компанию' } },
  {
    name: 'organizations',
    list: '/admin/organizations',
    show: '/orgs/:id',
    create: '/org/new',
    meta: { label: 'Организации' },
  },
  { name: 'notifications', list: '/notifications', meta: { label: 'Уведомления' } },
  { name: 'users', show: '/profile/:id', meta: { label: 'Люди' } },
  { name: 'messages', list: '/admin/messages', meta: { label: 'Обсуждения' } },
  { name: 'participations', meta: { label: 'Записи' } },
  { name: 'sports', list: '/admin/sports', meta: { label: 'Направления' } },
  { name: 'categories', meta: { label: 'Категории направлений' } },
  { name: 'districts', meta: { label: 'Районы' } },
  { name: 'cities', meta: { label: 'Города' } },
  { name: 'rules', list: '/rules', meta: { label: 'Правила' } },
  { name: 'audit', list: '/admin/log', meta: { label: 'Журнал' } },
  { name: 'invites', meta: { label: 'Приглашения' } },
];

const TITLES: [RegExp, string][] = [
  [/^\/assistant/, 'Чат с помощником'],
  [/^\/$/, 'Спорт и точка — компания для спорта в Красноярске'],
  [/^\/login/, 'Вход'],
  [/^\/register/, 'Присоединиться'],
  [/^\/verify-email/, 'Подтверждение почты'],
  [/^\/forgot-password/, 'Сброс пароля'],
  [/^\/reset-password/, 'Новый пароль'],
  [/^\/events\/new/, 'Создать событие'],
  [/^\/events\/[^/]+\/manage/, 'Управление событием'],
  [/^\/events\/[^/]+\/poster/, 'Афиша для печати'],
  [/^\/events\/[^/]+/, 'Событие'],
  [/^\/events/, 'Найти встречу'],
  [/^\/companions\/new/, 'Новое объявление'],
  [/^\/companions/, 'Ищу компанию'],
  [/^\/me\/(money|payments)/, 'Мои деньги'],
  [/^\/me/, 'Мой кабинет'],
  [/^\/notifications/, 'Уведомления'],
  [/^\/profile/, 'Профиль'],
  [/^\/settings/, 'Настройки'],
  [/^\/orgs\//, 'Организация'],
  [/^\/venues\//, 'Площадка'], // В4
  [/^\/org\/new/, 'Заявка организации'],
  [/^\/org\//, 'Кабинет организации'],
  [/^\/rules/, 'Правила платформы'],
  [/^\/legal/, 'Документы'],
  [/^\/share\//, 'Подробности встречи'],
  [/^\/admin\/organizations/, 'Организации — администрирование'],
  [/^\/admin\/events/, 'События — администрирование'],
  [/^\/admin\/messages/, 'Обсуждения — администрирование'],
  [/^\/admin\/sports/, 'Направления — администрирование'],
  [/^\/admin\/references/, 'Справочники — администрирование'],
  [/^\/admin\/log/, 'Журнал — администрирование'],
  [/^\/admin\/payments/, 'Оплата — администрирование'],
  [/^\/pay\//, 'Оплата'],
  [/^\/orders\//, 'Покупка'],
  [/^\/admin\/imports/, 'Из сообществ — администрирование'], // В8
  [/^\/admin\/analytics/, 'Спрос и инфраструктура — администрирование'], // В6
  [/^\/admin/, 'Сводка — администрирование'],
];

const titleHandler = ({ pathname }: { pathname?: string }) => {
  const title = TITLES.find(([re]) => re.test(pathname ?? '/'))?.[1];
  return title && pathname !== '/'
    ? `${title} — Спорт и точка`
    : `Спорт и точка — компания для спорта в ${getSelectedCity().in}`;
};

function Providers() {
  const userId = useSyncExternalStore(authSession.subscribe, authSession.getUserId, () => null);
  // Города правит администратор: список берём с сервера, до ответа работает сохранённый
  useEffect(() => {
    void loadCities();
  }, []);
  return (
    <ThemeProvider userId={userId}>
      <Refine
        dataProvider={dataProvider}
        authProvider={authProvider}
        accessControlProvider={accessControlProvider}
        liveProvider={liveProvider}
        routerProvider={routerProvider}
        notificationProvider={useNotificationProvider}
        i18nProvider={i18nProvider}
        resources={resources}
        options={{
          liveMode: 'auto',
          syncWithLocation: false,
          warnWhenUnsavedChanges: true,
          disableTelemetry: true,
          mutationMode: 'pessimistic',
          reactQuery: {
            clientConfig: {
              defaultOptions: {
                queries: {
                  refetchOnWindowFocus: false,
                  retry: (count: number, error: unknown) =>
                    count < 1 && ((error as HttpError)?.statusCode ?? 500) >= 500,
                },
              },
            },
          },
        }}
      >
        <AppRoutes />
        <ChatLauncher />
        <UnsavedChangesNotifier
          translationKey="warnWhenUnsavedChanges"
          message="Вы не сохранили изменения. Уйти со страницы?"
        />
        <DocumentTitleHandler handler={titleHandler} />
        <SeoSync />
      </Refine>
    </ThemeProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Providers />
    </BrowserRouter>
  );
}
