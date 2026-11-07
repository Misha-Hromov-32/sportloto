import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useDataProvider } from '@refinedev/core';
import { App } from 'antd';
import { useState } from 'react';

import { Button } from '@/components';
import { ENGAGEMENT_API, errorMessage } from '@/lib/api';
import { count, WORDS } from '@/lib/plural';
import type { EventDetails } from '@/types/api';
import type { ParticipantsExport } from '@/types/engagement';

/** С14: список участников события таблицей (CSV): имя, статус, дата записи, отметки. Без контактов. */
export function ExportParticipants({ event }: { event: EventDetails }) {
  const dataProvider = useDataProvider();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const { data } = await dataProvider().custom!<ParticipantsExport>({
        url: ENGAGEMENT_API.participantsExport(event.id),
        method: 'get',
      });
      if (!data.rows) {
        message.info('Пока никто не записался, список пуст');
        return;
      }
      const url = URL.createObjectURL(new Blob([data.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = data.filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message.success(`Скачан список: ${count(data.rows, WORDS.person)}`);
    } catch (error) {
      message.error(errorMessage(error, 'Не удалось скачать список. Попробуйте ещё раз'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="quiet"
      icon={<DownloadSimpleIcon size={20} aria-hidden />}
      loading={busy}
      loadingText="Готовим список…"
      onClick={() => void download()}
    >
      Скачать список участников
    </Button>
  );
}
