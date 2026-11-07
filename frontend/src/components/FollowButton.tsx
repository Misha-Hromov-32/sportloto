import { BellIcon, CheckIcon } from '@phosphor-icons/react';
import { useLocation } from 'react-router';

import { ENGAGEMENT_API, useAction, useLiveGet, useMe } from '@/lib/api';
import { Button } from './Button/Button';

interface FollowState {
  following: boolean;
  followers: number;
  reason: string;
}

export function FollowButton({ kind, id }: { kind: 'org' | 'user'; id: string }) {
  const { me, role } = useMe();
  const location = useLocation();
  const url = ENGAGEMENT_API.follow(kind, id);
  const state = useLiveGet<FollowState>(url, ['users', 'organizations'], role !== 'admin');
  const { run, isPending } = useAction();
  if (role === 'admin') return null;
  if (!me)
    return (
      <Button
        variant="secondary"
        to={`/login?to=${encodeURIComponent(location.pathname)}`}
        icon={<BellIcon size={18} aria-hidden />}
      >
        Подписаться
      </Button>
    );
  if (state.data?.reason) return null;
  if (state.isError)
    return (
      <Button variant="quiet" onClick={() => void state.refetch()}>
        Загрузить подписку
      </Button>
    );
  const following = state.data?.following ?? false;
  const toggle = async () => {
    try {
      await run(
        url,
        {},
        {
          method: following ? 'delete' : 'put',
          success: following ? 'Подписка отменена' : 'Сообщим о новых встречах организатора',
        },
      );
      await state.refetch();
    } catch {
      /* useAction показывает ошибку; текущее состояние сохраняется. */
    }
  };
  return (
    <Button
      variant="secondary"
      loading={isPending || state.isLoading}
      disabled={!state.data}
      onClick={() => void toggle()}
      icon={following ? <CheckIcon size={18} aria-hidden /> : <BellIcon size={18} aria-hidden />}
    >
      {following ? 'Отписаться' : 'Подписаться'}
    </Button>
  );
}
