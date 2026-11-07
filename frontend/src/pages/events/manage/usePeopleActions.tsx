import { ProhibitIcon, UserMinusIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { MoreMenu, StopAddDialog, ownerMeetings, stopOwnerOf, type MoreMenuItem } from '@/components';
import type { EventDetails, ParticipantView } from '@/types/api';

import { RemoveParticipantDialog } from './PersonActions';

/** Меню «⋯» у человека в управлении и окна «Убрать из участников» и «Не пускать». */
export function usePeopleActions(event: EventDetails) {
  const [removing, setRemoving] = useState<ParticipantView | null>(null);
  const [stopping, setStopping] = useState<ParticipantView | null>(null);
  const owner = stopOwnerOf(event.organizer);
  const upcoming = event.state === 'upcoming';

  const menu = (p: ParticipantView) => {
    const items: MoreMenuItem[] = [];
    if (upcoming && ['confirmed', 'pending', 'waitlist'].includes(p.status))
      items.push({
        key: 'remove',
        label: p.status === 'waitlist' ? 'Убрать из листа ожидания' : 'Убрать из участников',
        icon: <UserMinusIcon size={18} aria-hidden />,
      });
    items.push({
      key: 'stop',
      label: p.stopListed ? 'Изменить запись в стоп-листе' : `Не пускать на ${ownerMeetings(owner)}`,
      icon: <ProhibitIcon size={18} aria-hidden />,
      danger: !p.stopListed,
    });
    return (
      <MoreMenu
        label={`Действия: ${p.user.name}`}
        items={items}
        onSelect={(key) => (key === 'remove' ? setRemoving(p) : setStopping(p))}
      />
    );
  };

  const dialogs = (
    <>
      <RemoveParticipantDialog
        event={event}
        owner={owner}
        person={removing}
        onClose={() => setRemoving(null)}
      />
      <StopAddDialog
        open={Boolean(stopping)}
        owner={owner}
        userId={stopping?.userId ?? null}
        onClose={() => setStopping(null)}
      />
    </>
  );

  return { menu, dialogs };
}
