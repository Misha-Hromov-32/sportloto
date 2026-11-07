import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { NoAccessState, PageSkeleton } from '@/components';
import { useMe } from '@/lib/api';
import type { AccessRole } from '@/types/domain';

import { guestPageHeld } from './guestHold';

/** Только для вошедших. Гостя отправляем на вход и возвращаем обратно после входа. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { me, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <PageSkeleton />;
  if (!me) {
    const to = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?to=${encodeURIComponent(to)}`} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

const ROLE_TEXT: Record<AccessRole, string> = {
  guest: 'гостям',
  user: 'участникам',
  org: 'представителям организаций',
  admin: 'администратору',
};

/** Доступ по ролям. Объясняем, почему нельзя и куда пойти. */
export function RequireRole({ roles, children }: { roles: AccessRole[]; children?: ReactNode }) {
  const { me, role, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <PageSkeleton />;
  if (!me)
    return <Navigate to={`/login?to=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!roles.includes(role)) {
    const allowed = roles.map((r) => ROLE_TEXT[r]).join(' и ');
    return (
      <div className="container">
        <NoAccessState title="Этот раздел вам недоступен">
          Раздел открыт только {allowed}. Сейчас вы вошли как {me.name}.
        </NoAccessState>
      </div>
    );
  }
  return <>{children ?? <Outlet />}</>;
}

/** Только для гостей: вошедшего со страницы входа возвращаем в приложение. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { me, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return null;
  if (me && !guestPageHeld()) {
    const to = new URLSearchParams(location.search).get('to');
    return (
      <Navigate
        to={to && to.startsWith('/') && !to.startsWith('//') ? to : me.role === 'admin' ? '/admin' : '/me'}
        replace
      />
    );
  }
  return <>{children}</>;
}
