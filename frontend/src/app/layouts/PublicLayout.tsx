import {
  Bell,
  Buildings,
  CalendarCheck,
  CaretDown,
  GearSix,
  List,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  SignOut,
  User,
  UsersThree,
} from '@phosphor-icons/react';
import { WalletIcon } from '@phosphor-icons/react'; // оплата на сайте
import { useLogout } from '@refinedev/core';
import { Dropdown, type MenuProps } from 'antd';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';

import { Avatar, Button, Logo, ThemeSwitch } from '@/components';
import { SocialLinks } from '@/components/SocialLinks/SocialLinks';
import { CityPicker } from '@/components/CityPicker/CityPicker';
import { useIdentitySync, useMe } from '@/lib/api';
import { count, WORDS } from '@/lib/plural';
import { useSelectedCity } from '@/lib/useSelectedCity';
import { usePageMotion } from '@/lib/usePageMotion';

import { NotificationPopups } from '../components/NotificationPopups';
import styles from './PublicLayout.module.css';

/** Пользовательский контур: шапка, нижняя панель на телефоне, подвал. */
export function PublicLayout({ children }: { children?: ReactNode }) {
  useIdentitySync();
  const { me, isGuest, role } = useMe();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  usePageMotion(mainRef, location.pathname);
  const city = useSelectedCity();
  // Шапка одна на всём сайте: личные разделы открываются из меню аккаунта и колокольчика,
  // а не подменяют главное меню (иначе на «Моих занятиях» шапка выглядела другой).
  const workspace =
    !!me && location.pathname !== '/' && !/^\/(login|register|rules)(\/|$)/.test(location.pathname);
  const navigation = [
    { to: '/events', label: 'Найти встречу' },
    { to: '/companions', label: 'Ищу компанию' },
    ...(role !== 'admin' ? [{ to: '/inventory?tab=mine', label: 'Моя полка' }] : []),
    ...(me
      ? [
          {
            to: role === 'admin' ? '/admin' : '/me',
            label: role === 'admin' ? 'Администрирование' : 'Мои занятия',
          },
        ]
      : [
          { to: '/#how', label: 'Как это работает' },
          { to: '/#orgs', label: 'Для клубов' },
        ]),
  ];
  useEffect(() => {
    if (location.pathname === '/') document.title = `Спорт и точка — компания для спорта в ${city.in}`;
  }, [city, location.pathname]);
  const loginTo = `/login?to=${encodeURIComponent(location.pathname + location.search)}`;

  return (
    <div
      className={styles.shell}
      data-workspace={workspace ? '' : undefined}
      data-home={location.pathname === '/' ? '' : undefined}
      data-chat-page={/^\/assistant\/?$/.test(location.pathname) ? '' : undefined}
    >
      <a href="#main" className="skip-link">
        Перейти к содержанию
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brandGroup}>
            <Logo />
            <div className={styles.cityControl}>
              <CityPicker />
            </div>
          </div>
          <nav className={styles.nav} aria-label="Главное меню">
            {navigation.map((n) =>
              n.to.includes('#') ? (
                <a key={n.to} href={n.to} className={styles.navLink}>
                  {n.label}
                </a>
              ) : (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end
                  className={({ isActive }) =>
                    [styles.navLink, isActive && styles.navActive].filter(Boolean).join(' ')
                  }
                >
                  {n.label}
                  {n.to === '/notifications' && !!me?.unreadNotifications && (
                    <span className={styles.navCounter}>
                      {me.unreadNotifications > 9 ? '9+' : me.unreadNotifications}
                    </span>
                  )}
                </NavLink>
              ),
            )}
          </nav>
          <div className={styles.actions}>
            {role !== 'admin' && !isGuest && (
              <Button
                variant="primary"
                to="/events/new"
                icon={<Plus size={20} weight="bold" aria-hidden />}
                className={styles.createDesktop}
              >
                Создать встречу
              </Button>
            )}
            {me ? (
              <>
                <span className={styles.notificationControl}>
                  <NotificationsBell unread={me.unreadNotifications} />
                </span>
                <AccountMenu />
              </>
            ) : (
              <div className={styles.guest}>
                <Button variant="secondary" size="sm" to={loginTo} className={styles.loginBtn}>
                  Войти
                </Button>
                <Button variant="primary" size="sm" to="/register" className={styles.joinBtn}>
                  Присоединиться
                </Button>
              </div>
            )}
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              popupRender={(menu) => (
                <div className={styles.menuPanel}>
                  {menu}
                  <div className={styles.menuTools}>
                    <div>
                      <span>Ваш город</span>
                      <CityPicker />
                    </div>
                    <div>
                      <span>Внешний вид</span>
                      <ThemeSwitch />
                    </div>
                    <div>
                      <span>Наши боты</span>
                      <SocialLinks variant="menu" />
                    </div>
                  </div>
                </div>
              )}
              menu={{
                items: [
                  ...navigation.map((item) => ({
                    key: item.to,
                    label: (
                      <Link to={item.to} aria-current={location.pathname === item.to ? 'page' : undefined}>
                        {item.label}
                      </Link>
                    ),
                  })),
                  { type: 'divider' },
                  { key: 'home', label: <Link to="/">Главная</Link> },
                  { key: 'assistant', label: <Link to="/assistant">Чат с помощником</Link> },
                  ...(isGuest
                    ? [{ key: 'register', label: <Link to="/register">Присоединиться</Link> }]
                    : [
                        { key: 'profile', label: <Link to={`/profile/${me?.id}`}>Мой профиль</Link> },
                        { key: 'notifications', label: <Link to="/notifications">Уведомления</Link> },
                        { key: 'settings', label: <Link to="/settings">Настройки</Link> },
                      ]),
                ],
              }}
            >
              <button type="button" className={styles.mobileMenu} aria-label="Открыть меню навигации">
                <List size={23} aria-hidden />
              </button>
            </Dropdown>
            <span className={styles.socialControl}>
              <SocialLinks />
            </span>
            <span className={styles.themeControl}>
              <ThemeSwitch />
            </span>
          </div>
        </div>
      </header>

      <main ref={mainRef} id="main" className={styles.main} tabIndex={-1}>
        {/* Экран заново строится в новом городе: без событий и времени прежнего города из кэша. */}
        <Fragment key={city.id}>{children ?? <Outlet />}</Fragment>
      </main>

      <footer className={styles.footer}>
        <div className={['container', styles.footerInner].join(' ')}>
          <Logo />
          <nav className={styles.footerNav} aria-label="Дополнительно">
            <Link to="/assistant">Чат с помощником</Link>
            <Link to="/rules">Правила платформы</Link>
            <Link to="/legal/terms">Пользовательское соглашение</Link>
            <Link to="/legal/privacy">Политика обработки персональных данных</Link>
            <Link to={isGuest ? `/login?to=${encodeURIComponent('/org/new')}` : '/org/new'}>
              Для клубов и организаций
            </Link>
            {me && <Link to="/settings">Настройки</Link>}
          </nav>
          <p className={styles.footerNote}>© «Спорт и точка». Все права защищены.</p>
        </div>
      </footer>

      <TabBar isGuest={isGuest} isAdmin={role === 'admin'} profileId={me?.id ?? null} loginTo={loginTo} />
      {me && <NotificationPopups key={me.id} />}
    </div>
  );
}

function NotificationsBell({ unread }: { unread: number }) {
  const label = unread ? `Уведомления: ${count(unread, WORDS.notification)} не прочитано` : 'Уведомления';
  return (
    <Link to="/notifications" className={styles.iconBtn} aria-label={label} title="Уведомления">
      <Bell size={24} weight={unread ? 'fill' : 'regular'} aria-hidden />
      {unread > 0 && (
        <span key={unread} className={[styles.counter, 'status-flash'].join(' ')} aria-hidden>
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

function AccountMenu() {
  const { me } = useMe();
  const navigate = useNavigate();
  const { mutate: logout } = useLogout();
  if (!me) return null;

  const orgItems: MenuProps['items'] = me.orgs.length
    ? me.orgs.map((o) => ({ key: `/org/${o.id}`, icon: <Buildings size={20} />, label: o.name }))
    : me.role !== 'admin'
      ? [{ key: '/org/new', icon: <Buildings size={20} />, label: 'Зарегистрировать организацию' }]
      : [];

  const items: MenuProps['items'] = [
    { key: 'who', type: 'group', label: me.name },
    ...(me.role === 'admin'
      ? [{ key: '/admin', icon: <ShieldCheck size={20} />, label: 'Администрирование' }]
      : []),
    { key: `/profile/${me.id}`, icon: <User size={20} />, label: 'Мой профиль' },
    ...(me.role !== 'admin' ? [{ key: '/me', icon: <CalendarCheck size={20} />, label: 'Мои занятия' }] : []),
    ...(me.role !== 'admin'
      ? [{ key: '/me/money', icon: <WalletIcon size={20} />, label: 'Мои деньги' }]
      : []),
    ...orgItems,
    { key: '/settings', icon: <GearSix size={20} />, label: 'Настройки' },
    { type: 'divider' },
    { key: 'logout', icon: <SignOut size={20} />, label: 'Выйти' },
  ];

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      menu={{
        items,
        onClick: ({ key }) => {
          if (key === 'logout') logout();
          else navigate(key);
        },
      }}
    >
      <button type="button" className={styles.account} aria-label={`Меню аккаунта: ${me.name}`}>
        <Avatar name={me.name} initials={me.initials} src={me.avatarUrl} size={40} />
        <span className={styles.accountName}>{me.name.split(' ')[0]}</span>
        <CaretDown size={16} aria-hidden className={styles.accountCaret} />
      </button>
    </Dropdown>
  );
}

/** Нижняя панель на телефоне. Для левши главная кнопка «Создать» стоит слева. */
function TabBar({
  isGuest,
  isAdmin,
  profileId,
  loginTo,
}: {
  isGuest: boolean;
  isAdmin: boolean;
  profileId: string | null;
  loginTo: string;
}) {
  const { pathname } = useLocation();
  const authed = (path: string) => (isGuest ? `/login?to=${encodeURIComponent(path)}` : path);
  const items = [
    { to: '/events', match: '/events', label: 'Найти', icon: MagnifyingGlass },
    { to: '/companions', match: '/companions', label: 'Компания', icon: UsersThree },
    isAdmin
      ? { to: '/admin', match: '/admin', label: 'Админка', icon: ShieldCheck }
      : { to: authed('/events/new'), match: '/events/new', label: 'Создать', icon: Plus, primary: true },
    { to: authed('/me'), match: '/me', label: 'Мои', icon: CalendarCheck },
    profileId
      ? { to: `/profile/${profileId}`, match: '/profile', label: 'Профиль', icon: User, profile: true }
      : { to: loginTo, match: '/login', label: 'Войти', icon: User, profile: true },
  ];
  const activeMatch = items
    .map((i) => i.match)
    .filter((m) => pathname === m || pathname.startsWith(`${m}/`))
    .sort((a, b) => b.length - a.length)[0];
  return (
    <nav className={styles.tabbar} aria-label="Нижнее меню">
      {items.map(({ to, match, label, icon: Icon, primary, profile }) => {
        const active = match === activeMatch;
        return (
          <Link
            key={label}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={[
              styles.tab,
              primary && styles.tabPrimary,
              active && styles.tabActive,
              profile && 'not-simple',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className={styles.tabIcon}>
              <Icon size={primary ? 26 : 24} weight={primary ? 'bold' : 'regular'} aria-hidden />
            </span>
            <span className={styles.tabLabel}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
