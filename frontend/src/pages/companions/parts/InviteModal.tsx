import { useList } from '@refinedev/core';
import { App, Modal } from 'antd';
import { useState } from 'react';

import { Button, EmptyState, ErrorState, SkeletonBlock } from '@/components';
import { API, useAction } from '@/lib/api';
import { formatEventDate } from '@/lib/dates';
import type { CompanionView, EventView } from '@/types/api';

import { OptionCards } from '../../events/create/fields';
import styles from './companions.module.css';

/** «Позвать»: выбрать своё предстоящее событие, человеку придёт приглашение. `onSent` — после отправки. */
export function InviteModal({
  companion,
  onClose,
  onSent,
}: {
  companion: CompanionView | null;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { message } = App.useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const { run, isPending } = useAction();
  const { result, query } = useList<EventView>({
    resource: 'events',
    filters: [{ field: 'scope', operator: 'eq', value: 'organizing' }],
    pagination: { mode: 'off' },
    sorters: [{ field: 'startsAt', order: 'asc' }],
    queryOptions: { enabled: Boolean(companion) },
  });
  const events = result.data.filter((e) => e.state === 'upcoming');
  const firstName = companion?.author.name.split(' ')[0] ?? '';

  const close = () => {
    setSelected(null);
    onClose();
  };

  const send = async () => {
    if (!companion || !selected) return;
    try {
      await run(API.inviteFromCompanion(companion.id), { eventId: selected, userId: companion.authorId });
      message.success(`Приглашение отправлено. ${firstName} получит уведомление`);
      setSelected(null);
      if (onSent) onSent();
      else onClose();
    } catch {
      /* текст ошибки уже показан */
    }
  };

  const createLink = companion
    ? `/events/new?sportId=${companion.sport.id}${companion.districtId ? `&districtId=${companion.districtId}` : ''}`
    : '/events/new';

  return (
    <Modal
      open={Boolean(companion)}
      onCancel={close}
      footer={null}
      title={`Позвать: ${companion?.author.name ?? ''}`}
      destroyOnHidden
    >
      <div className={styles.modalBody}>
        <p className="text-2">
          Выберите своё событие. {firstName} получит приглашение и сам решит, записываться ли.
        </p>
        {query.isLoading ? (
          <div className={styles.modalList} aria-hidden>
            <SkeletonBlock height={72} />
            <SkeletonBlock height={72} />
          </div>
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()}>Не удалось загрузить ваши события.</ErrorState>
        ) : events.length === 0 ? (
          <EmptyState
            title="У вас нет предстоящих событий"
            actions={
              <Button variant="primary" to={createLink}>
                Создать событие
              </Button>
            }
          >
            Создайте встречу, а потом позовите на неё.
          </EmptyState>
        ) : (
          <>
            <OptionCards<string>
              label="Ваши события"
              size="sm"
              value={selected ?? ''}
              onChange={setSelected}
              options={events.map((e) => ({
                value: e.id,
                title: e.title,
                text: `${formatEventDate(e.startsAt)}. ${e.place.address}`,
              }))}
            />
            <div className={styles.modalActions}>
              <Button
                variant="primary"
                onClick={send}
                disabled={!selected}
                loading={isPending}
                loadingText="Отправляем…"
              >
                Позвать на это событие
              </Button>
              <Button variant="quiet" onClick={close}>
                Не звать
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
