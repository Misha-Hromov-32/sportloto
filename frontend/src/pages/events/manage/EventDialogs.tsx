import { CalendarXIcon, ClockClockwiseIcon } from '@phosphor-icons/react';
import { useUpdate, type HttpError } from '@refinedev/core';
import { Input, Modal } from 'antd';
import { useId, useState } from 'react';

import { Button } from '@/components';
import { API, errorMessage, useAction } from '@/lib/api';
import { dayjs, formatEventDate } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import type { EventDetails } from '@/types/api';
import type { EventPatch } from '@/types/inputs';

import styles from './manage.module.css';

function notifiedCount(event: EventDetails): number {
  return event.counts.confirmed + event.counts.pending + event.counts.waitlist;
}

export function RescheduleDialog({
  event,
  open,
  onClose,
}: {
  event: EventDetails;
  open: boolean;
  onClose: () => void;
}) {
  const [date, setDate] = useState(() => dayjs(event.startsAt).format('YYYY-MM-DD'));
  const [time, setTime] = useState(() => dayjs(event.startsAt).format('HH:mm'));
  const value = dayjs(`${date}T${time}`);
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, mutation } = useUpdate<EventDetails, HttpError, EventPatch>();
  const dateId = useId();
  const timeId = useId();
  const people = notifiedCount(event);
  const same = !value.isValid() || value.isSame(dayjs(event.startsAt), 'minute');

  const submit = async () => {
    setError(null);
    try {
      await mutateAsync({
        resource: 'events',
        id: event.id,
        values: { startsAt: value.toISOString() },
        successNotification: {
          type: 'success',
          message: people ? 'Встреча перенесена. Участники получили уведомление' : 'Встреча перенесена',
        },
        errorNotification: false,
      });
      onClose();
    } catch (e) {
      const fields = (e as { errors?: Record<string, string> }).errors;
      setError(fields?.startsAt ?? errorMessage(e, 'Не получилось перенести. Попробуйте ещё раз'));
    }
  };

  return (
    <Modal open={open} onCancel={onClose} title="Перенести встречу" footer={null} destroyOnHidden>
      <div className={styles.dialog}>
        <p className={styles.dialogNote}>Сейчас: {formatEventDate(event.startsAt)}</p>
        <div className={styles.dateRow}>
          <div>
            <label htmlFor={dateId} className={styles.fieldLabel}>
              Новая дата
            </label>
            <Input
              id={dateId}
              type="date"
              value={date}
              min={dayjs().format('YYYY-MM-DD')}
              onChange={(e) => setDate(e.target.value)}
              status={error ? 'error' : undefined}
            />
          </div>
          <div>
            <label htmlFor={timeId} className={styles.fieldLabel}>
              Время начала
            </label>
            <Input
              id={timeId}
              type="time"
              step={300}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              status={error ? 'error' : undefined}
            />
          </div>
        </div>
        {value.isValid() && !same && (
          <p className={styles.dialogNote}>Станет: {formatEventDate(value.toISOString())}</p>
        )}
        <p className={styles.dialogNote}>
          {people
            ? `Уведомим ${count(people, WORDS.person)}: участников, заявки и лист ожидания. В карточке они увидят, что было и что стало, и подтвердят, что в курсе.`
            : 'Пока никто не записан, уведомлять некого.'}
        </p>
        {error && (
          <p className={styles.dialogError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <Button
            variant="primary"
            icon={<ClockClockwiseIcon size={20} aria-hidden />}
            disabled={same}
            loading={mutation.isPending}
            loadingText="Переносим…"
            onClick={submit}
          >
            {people ? 'Перенести и уведомить' : 'Перенести'}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Не переносить
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function CancelDialog({
  event,
  open,
  onClose,
}: {
  event: EventDetails;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const { run, isPending } = useAction();
  const fieldId = useId();
  const people = notifiedCount(event);
  const paid = event.price.kind !== 'free';

  const submit = async () => {
    try {
      await run(API.cancelEvent(event.id), { reason: reason.trim() }, { success: 'Встреча отменена' });
      onClose();
    } catch {
      /* текст ошибки показан сообщением */
    }
  };

  return (
    <Modal open={open} onCancel={onClose} title={`Отменить «${event.title}»?`} footer={null} destroyOnHidden>
      <div className={styles.dialog}>
        <p>
          {people
            ? `${count(people, WORDS.person)} получат уведомление об отмене.`
            : 'Записавшихся нет, уведомлять некого.'}{' '}
          Вернуть встречу после отмены нельзя, но можно создать новую.
        </p>
        {paid && (
          <p className={styles.dialogNote}>
            Встреча платная. Участникам напишем, что деньги вернут полностью: верните их сами, как
            договаривались.
          </p>
        )}
        <div>
          <label htmlFor={fieldId} className={styles.fieldLabel}>
            Причина, необязательно
          </label>
          <Input.TextArea
            id={fieldId}
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например, зал закрыли на ремонт. Перенесу на следующую неделю"
          />
        </div>
        <div className={styles.dialogActions}>
          <Button
            variant="danger"
            icon={<CalendarXIcon size={20} aria-hidden />}
            loading={isPending}
            loadingText="Отменяем…"
            onClick={submit}
          >
            Отменить встречу
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Не отменять
          </Button>
        </div>
      </div>
    </Modal>
  );
}
