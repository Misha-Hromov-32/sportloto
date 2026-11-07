import {
  ArrowSquareOut,
  Buildings,
  CalendarDots,
  ChartBar,
  Chats,
  List,
  Scroll,
  SignOut,
  SquaresFour,
} from '@phosphor-icons/react';
import { ChartLineUpIcon, RobotIcon, UsersFourIcon } from '@phosphor-icons/react'; // В6, В8
import { WalletIcon } from '@phosphor-icons/react'; // оплата на сайте
import { BooksIcon } from '@phosphor-icons/react'; // справочники
import { useLogout } from '@refinedev/core';
import { Drawer, Menu, type MenuProps } from 'antd';
import { Fragment, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';

import { Avatar, Logo, NoAccessState, PageSkeleton, ThemeSwitch } from '@/components';
import { useAdminStats, useIdentitySync, useMe } from '@/lib/api';
import { useSelectedCity } from '@/lib/useSelectedCity';

import styles from './AdminLayout.module.css';
import { PublicLayout } from './PublicLayout';

/** Админ-контур: та же палитра и шрифты, но плотнее и спокойнее. Боковое меню, без фото. */
export function AdminLayout() {
  useIdentitySync();
  const { me, role, isLoading } = useMe();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="container">
        <PageSkeleton />
      </div>
    );
  }
  if (!me) {
    return (
      <PublicLayout>
        <div className="container">
          <NoAccessState guest loginTo={location.pathname} title="Войдите как администратор">
            Этот раздел доступен только администратору. Войдите с правами администратора.
          </NoAccessState>
        </div>
      </PublicLayout>
    );
  }
  if (role !== 'admin') {
    return (
      <PublicLayout>
        <div className="container">
          <NoAccessState title="Раздел только для администратора">
            Вы вошли как {me.name}. Для управления организациями и модерации нужны права администратора.
          </NoAccessState>
        </div>
      </PublicLayout>
    );
  }
  return <AdminShell />;
}

function AdminShell() {
  const { me } = useMe();
  const { stats } = useAdminStats();
  const location = useLocation();
  const navigate = useNavigate();
  const { mutate: logout } = useLogout();
  const [drawer, setDrawer] = useState(false);
  const city = useSelectedCity();

  const count = (n?: number) => (n ? <span className={styles.count}>{n}</span> : null);
  const items: MenuProps['items'] = [
    { key: '/admin', icon: <ChartBar size={20} />, label: 'Сводка' },
    {
      key: '/admin/organizations',
      icon: <Buildings size={20} />,
      label: <span className={styles.item}>Организации{count(stats?.pendingOrgs)}</span>,
    },
    {
      key: '/admin/events',
      icon: <CalendarDots size={20} />,
      label: <span className={styles.item}>События{count(stats?.flaggedEvents)}</span>,
    },
    {
      key: '/admin/messages',
      icon: <Chats size={20} />,
      label: <span className={styles.item}>Обсуждения{count(stats?.flaggedMessages)}</span>,
    },
    {
      key: '/admin/sports',
      icon: <SquaresFour size={20} />,
      label: <span className={styles.item}>Направления{count(stats?.customSports)}</span>,
    },
    { key: '/admin/references', icon: <BooksIcon size={20} />, label: 'Справочники' },
    // В8, В6: посты сообществ, спрос и инфраструктура
    { key: '/admin/imports', icon: <UsersFourIcon size={20} />, label: 'Из сообществ' },
    { key: '/admin/analytics', icon: <ChartLineUpIcon size={20} />, label: 'Спрос и инфраструктура' },
    { key: '/admin/assistant', icon: <RobotIcon size={20} />, label: 'ИИ на сайте' },
    { key: '/admin/payments', icon: <WalletIcon size={20} />, label: 'Оплата' },
    { key: '/admin/log', icon: <Scroll size={20} />, label: 'Журнал' },
  ];
  const selected = [...(items ?? [])]
    .map((i) => String(i?.key))
    .filter((k) => location.pathname === k || (k !== '/admin' && location.pathname.startsWith(k)))
    .sort((a, b) => b.length - a.length)[0];

  const menu = (
    <Menu
      mode="inline"
      items={items}
      selectedKeys={selected ? [selected] : []}
      onClick={({ key }) => {
        navigate(key);
        setDrawer(false);
      }}
      className={styles.menu}
    />
  );

  return (
    <div className={styles.shell}>
      <a href="#admin-main" className="skip-link">
        Перейти к содержанию
      </a>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.burger}
          onClick={() => setDrawer(true)}
          aria-label="Открыть меню"
        >
          <List size={24} aria-hidden />
        </button>
        <Logo to="/admin" />
        <span className={styles.section}>Администрирование</span>
        <div className={styles.headerActions}>
          <Link to="/events" className={styles.toSite}>
            <ArrowSquareOut size={20} aria-hidden />
            <span>На сайт</span>
          </Link>
          {me && (
            <span className={styles.me}>
              <Avatar name={me.name} initials={me.initials} size={40} />
              <span className={styles.meName}>{me.name}</span>
            </span>
          )}
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => logout()}
            aria-label="Выйти"
            title="Выйти"
          >
            <SignOut size={22} aria-hidden />
          </button>
          <span className={styles.theme}>
            <ThemeSwitch />
          </span>
        </div>
      </header>
      <div className={styles.body}>
        <aside className={styles.sider} aria-label="Разделы администрирования">
          {menu}
        </aside>
        <main id="admin-main" className={styles.main} tabIndex={-1}>
          <Fragment key={city.id}>
            <Outlet />
          </Fragment>
        </main>
      </div>
      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        placement="left"
        width={300}
        title="Администрирование"
      >
        {menu}
      </Drawer>
    </div>
  );
}
