import { useAction } from '@/lib/api';
import type { StopEntryView } from '@/types/api';

import { DecisionModal } from '../parts/DecisionModal';
import { STOP_ADMIN_API } from './api';

const LIFT_TEMPLATES = [
  'Запрет не связан с поведением на встречах.',
  'Организатор ограничивает людей без понятной причины.',
  'Человек объяснил, что случилось. Других жалоб на него нет.',
];

/** Снять запрет из стоп-листа организатора: причина обязательна, её увидят обе стороны. */
export function LiftStopDialog({
  entry,
  onClose,
  onLifted,
}: {
  entry: StopEntryView | null;
  onClose: () => void;
  onLifted?: (entry: StopEntryView) => void;
}) {
  const { run } = useAction<StopEntryView>();

  return (
    <DecisionModal
      open={Boolean(entry)}
      title={entry ? `Снять запрет: ${entry.user.name}?` : 'Снять запрет?'}
      confirmLabel="Снять запрет"
      consequences={
        entry
          ? [
              `${entry.user.name} снова сможет записываться на встречи, которые проводит ${entry.owner.name}.`,
              'Организатор и сам человек получат уведомление с вашей причиной.',
              'Записи, которые отменили раньше, не вернутся. Записаться можно будет заново.',
            ]
          : []
      }
      reason={{
        label: 'Причина',
        hint: 'Её увидят организатор и сам человек.',
        required: true,
        templates: LIFT_TEMPLATES,
        placeholder: 'Например: организатор не объяснил, чем человек нарушил правила',
      }}
      onConfirm={async ({ reason }) => {
        if (!entry) return;
        const lifted = await run(
          STOP_ADMIN_API.lift(entry.id),
          { reason },
          { success: 'Запрет снят. Организатор и человек получат уведомление' },
        );
        onLifted?.(lifted);
      }}
      onClose={onClose}
    />
  );
}
