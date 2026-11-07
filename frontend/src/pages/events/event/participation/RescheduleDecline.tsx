import { App } from 'antd';
import { useState } from 'react';

import { Button, type ButtonSize } from '@/components';
import { API, useAction } from '@/lib/api';
import type { EventView } from '@/types/api';

/** Есть ли у человека неподтверждённый перенос времени. */
function rescheduled(e: EventView): boolean {
  const ids = e.my?.unackedChangeIds ?? [];
  return e.changes.some((c) => ids.includes(c.id) && c.items.some((i) => i.field === 'startsAt'));
}

/**
 * С6: «Не смогу в новое время» рядом с «Я в курсе». Запись отменяется без отметки
 * о поздней отмене, организатор видит причину, человеку показываем похожие встречи.
 */
export function RescheduleDecline({
  event: e,
  size = 'md',
  onDone,
}: {
  event: EventView;
  size?: ButtonSize;
  onDone?: () => void;
}) {
  const { run } = useAction();
  const { modal } = App.useApp();
  const [busy, setBusy] = useState(false);
  if (e.state !== 'upcoming' || !rescheduled(e)) return null;

  const confirm = () =>
    modal.confirm({
      title: `Не сможете на «${e.title}» в новое время?`,
      content:
        'Запись отменится, организатор увидит, что вам не подошло новое время. Мы сразу покажем похожие встречи.',
      okText: 'Отменить запись',
      cancelText: 'Оставить запись',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true);
        try {
          await run(API.declineReschedule(e.id), {}, { success: 'Запись отменена' });
          onDone?.();
        } catch {
          /* текст ошибки уже показан */
        } finally {
          setBusy(false);
        }
      },
    });

  return (
    <Button variant="quiet" size={size} loading={busy} loadingText="Отменяем…" onClick={confirm}>
      Не смогу в новое время
    </Button>
  );
}
