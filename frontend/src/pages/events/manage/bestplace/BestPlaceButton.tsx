import { MapPinAreaIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { Button } from '@/components';
import type { EventDetails } from '@/types/api';

import { BestPlaceDialog } from './BestPlaceDialog';

/** В5: кнопка в управлении событием. Перенос — через обычное изменение места с уведомлением участников. */
export function BestPlaceButton({ event }: { event: EventDetails }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        disabled={event.state !== 'upcoming'}
        icon={<MapPinAreaIcon size={20} aria-hidden />}
        onClick={() => setOpen(true)}
      >
        Подобрать место для всех
      </Button>
      {open && (
        <BestPlaceDialog
          open
          onClose={() => setOpen(false)}
          input={{ eventId: event.id }}
          mode={{ kind: 'move', event }}
        />
      )}
    </>
  );
}
