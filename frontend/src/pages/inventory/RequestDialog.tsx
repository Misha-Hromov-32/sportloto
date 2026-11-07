import { PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { Input, InputNumber, Modal, Select } from 'antd';
import { useId, useState } from 'react';

import { Button } from '@/components';
import { errorMessage, INVENTORY_API, useAction } from '@/lib/api';
import { formatEventDate } from '@/lib/dates';
import type { InventoryMe, LoanView, ShelfItemView } from '@/types/inventory';
import { Field } from '@/pages/events/create/fields';

import styles from './inventory.module.css';

export interface RequestContext {
  eventId: string;
  eventTitle: string;
  lineId: string | null;
  missing: number;
}

/** «Попросить на событие»: сколько, на какое событие и пара слов владельцу. Владелец примет или откажет. */
export function RequestDialog({
  item,
  context,
  me,
  onClose,
}: {
  item: ShelfItemView | null;
  context: RequestContext | null;
  me: InventoryMe | null;
  onClose: () => void;
}) {
  return (
    <Modal open={Boolean(item)} onCancel={onClose} title={item ? `Попросить «${item.name}»` : ''} footer={null} destroyOnHidden>
      {item && <RequestForm item={item} context={context} me={me} onClose={onClose} />}
    </Modal>
  );
}

function RequestForm({
  item,
  context,
  me,
  onClose,
}: {
  item: ShelfItemView;
  context: RequestContext | null;
  me: InventoryMe | null;
  onClose: () => void;
}) {
  const events = me?.events ?? [];
  const [eventId, setEventId] = useState<string | null>(context?.eventId ?? events[0]?.id ?? null);
  const [quantity, setQuantity] = useState<number>(() =>
    Math.max(1, Math.min(item.available, context?.missing || 1)),
  );
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useAction<LoanView>();
  const eventFieldId = useId();
  const qtyId = useId();
  const commentId = useId();

  if (!context && events.length === 0)
    return (
      <div className={styles.dialog}>
        <p>
          Вещь просят на конкретное событие, где вы участник или организатор. Запишитесь на событие или создайте
          своё, и возвращайтесь на полку.
        </p>
        <div className={styles.dialogActions}>
          <Button variant="primary" to="/events">
            Найти событие
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    );

  const submit = async () => {
    setError(null);
    setErrors({});
    try {
      await run(
        INVENTORY_API.requestItem(item.id),
        { eventId, lineId: context?.lineId ?? null, quantity, comment: comment.trim() },
        { silent: true, success: 'Просьба отправлена. Ответ владельца придёт в уведомления' },
      );
      onClose();
    } catch (e) {
      const fields = (e as { errors?: Record<string, string> }).errors;
      if (fields) setErrors(fields);
      setError(errorMessage(e, 'Не получилось отправить просьбу. Попробуйте ещё раз'));
    }
  };

  return (
    <div className={styles.dialog}>
      <p className={styles.dialogNote}>
        Владелец: {item.ownerView.name}. Свободно {item.available} из {item.quantity}.
      </p>
      {context ? (
        <p>
          На событие <b>«{context.eventTitle}»</b>
          {context.missing > 0 && `. Не хватает: ${context.missing}`}
        </p>
      ) : (
        <Field label="На какое событие" htmlFor={eventFieldId} error={errors.eventId}>
          <Select
            id={eventFieldId}
            size="large"
            value={eventId ?? undefined}
            onChange={setEventId}
            options={events.map((e) => ({
              value: e.id,
              label: `${e.title}, ${formatEventDate(e.startsAt)}`,
            }))}
          />
        </Field>
      )}
      <Field label="Сколько нужно" htmlFor={qtyId} error={errors.quantity} hint={`Не больше ${item.available}`}>
        <InputNumber
          id={qtyId}
          size="large"
          min={1}
          max={Math.max(1, item.available)}
          precision={0}
          value={quantity}
          onChange={(v) => setQuantity(Number(v) || 1)}
        />
      </Field>
      <Field label="Пара слов владельцу" htmlFor={commentId} optional hint="Когда удобно забрать и вернуть">
        <Input.TextArea
          id={commentId}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 4 }}
          maxLength={300}
          placeholder="Заберу в пятницу вечером, верну сразу после игры"
        />
      </Field>
      {error && (
        <p className={styles.dialogError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.dialogActions}>
        <Button
          variant="primary"
          icon={<PaperPlaneTiltIcon size={20} aria-hidden />}
          loading={isPending}
          loadingText="Отправляем…"
          disabled={!eventId}
          onClick={submit}
        >
          Отправить просьбу
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Не просить
        </Button>
      </div>
    </div>
  );
}
