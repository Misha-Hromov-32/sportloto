import { App } from 'antd';
import { useEffect } from 'react';

import { ENGAGEMENT_API, useAction, useMe } from '@/lib/api';
import { count, WORDS } from '@/lib/plural';

import { clearGuestSaved, guestSaved } from './deckStore';

/** После входа события, отложенные гостем в режиме «По одной», переносятся в избранное. */
export function useMoveGuestSaved() {
  const { me } = useMe();
  const { run } = useAction();
  const { message } = App.useApp();
  const userId = me && me.role !== 'admin' ? me.id : null;
  const admin = me?.role === 'admin';

  useEffect(() => {
    if (admin) clearGuestSaved();
    if (!userId) return;
    const ids = guestSaved();
    if (!ids.length) return;
    clearGuestSaved();
    void Promise.allSettled(
      ids.map((id) => run(ENGAGEMENT_API.favorite(id), {}, { method: 'put', silent: true })),
    ).then((results) => {
      const moved = results.filter((r) => r.status === 'fulfilled').length;
      if (moved) message.success(`Перенесли в избранное ${count(moved, WORDS.event)}`);
    });
    // Переносим один раз при появлении вошедшего человека.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, admin]);
}
