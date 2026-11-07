import { useCreate, useList, type HttpError } from '@refinedev/core';
import { Input, Modal, Select } from 'antd';
import { useId, useState } from 'react';

import { Button } from '@/components';
import { errorMessage } from '@/lib/api';
import { dayjs, formatEventDate } from '@/lib/dates';
import type { EventView } from '@/types/api';
import type { InventoryOrg, SupportNeedInput, SupportNeedView } from '@/types/inventory';
import { Field } from '@/pages/events/create/fields';

import styles from './needs.module.css';

export interface NeedPreset {
  orgId: string;
  eventId?: string | null;
  title?: string;
}

/** Просьба о помощи от клуба: что нужно и к какому сроку. Её увидят все допущенные партнёры. */
export function NeedDialog({
  open,
  clubs,
  preset,
  onClose,
}: {
  open: boolean;
  clubs: InventoryOrg[];
  preset: NeedPreset | null;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onCancel={onClose} title="Попросить партнёров о помощи" footer={null} destroyOnHidden width={600}>
      {open && preset && <NeedForm clubs={clubs} preset={preset} onClose={onClose} />}
    </Modal>
  );
}

function NeedForm({ clubs, preset, onClose }: { clubs: InventoryOrg[]; preset: NeedPreset; onClose: () => void }) {
  const [orgId, setOrgId] = useState(preset.orgId);
  const [eventId, setEventId] = useState<string | null>(preset.eventId ?? null);
  const [title, setTitle] = useState(preset.title ?? '');
  const [details, setDetails] = useState('');
  const [deadline, setDeadline] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, mutation } = useCreate<SupportNeedView, HttpError, SupportNeedInput>();
  const { result: events } = useList<EventView>({
    resource: 'events',
    filters: [
      { field: 'scope', operator: 'eq', value: 'org' },
      { field: 'orgId', operator: 'eq', value: orgId },
    ],
    pagination: { mode: 'off' },
  });
  const upcoming = (events.data ?? []).filter((e) => e.state === 'upcoming');
  const ids = { org: useId(), event: useId(), title: useId(), details: useId(), deadline: useId() };

  const submit = async () => {
    setError(null);
    if (title.trim().length < 5) {
      setErrors({ title: 'Напишите, что нужно и сколько' });
      return;
    }
    setErrors({});
    try {
      await mutateAsync({
        resource: 'support-needs',
        values: {
          orgId,
          eventId,
          title: title.trim(),
          details: details.trim(),
          deadline: deadline ? dayjs(`${deadline}T23:59`).toISOString() : null,
        },
        successNotification: { type: 'success', message: 'Просьба опубликована. Партнёры получили уведомление' },
        errorNotification: false,
      });
      onClose();
    } catch (e) {
      const fields = (e as { errors?: Record<string, string> }).errors;
      if (fields) setErrors(fields);
      setError(errorMessage(e));
    }
  };

  return (
    <div className={styles.dialog}>
      {clubs.length > 1 && (
        <Field label="Клуб" htmlFor={ids.org}>
          <Select
            id={ids.org}
            size="large"
            value={orgId}
            onChange={(v) => {
              setOrgId(v);
              setEventId(null);
            }}
            options={clubs.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
      )}
      <Field
        label="Что нужно"
        htmlFor={ids.title}
        error={errors.title}
        hint="Коротко и с количеством, чтобы партнёр сразу понял, сможет ли помочь"
      >
        <Input
          id={ids.title}
          size="large"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={140}
          placeholder="Нужны 2 мяча и 10 мест в зале для детской группы"
        />
      </Field>
      <Field label="Подробности" htmlFor={ids.details} optional>
        <Input.TextArea
          id={ids.details}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 5 }}
          maxLength={600}
          placeholder="Для кого, где занимаетесь, как удобно передать"
        />
      </Field>
      <div className={styles.formRow}>
        <Field label="Для какого события" htmlFor={ids.event} optional error={errors.eventId}>
          <Select
            id={ids.event}
            size="large"
            allowClear
            placeholder="Для клуба в целом"
            value={eventId ?? undefined}
            onChange={(v) => setEventId((v as string | undefined) ?? null)}
            options={upcoming.map((e) => ({ value: e.id, label: `${e.title}, ${formatEventDate(e.startsAt)}` }))}
          />
        </Field>
        <Field label="Нужно до" htmlFor={ids.deadline} optional error={errors.deadline}>
          <Input
            id={ids.deadline}
            size="large"
            type="date"
            min={dayjs().format('YYYY-MM-DD')}
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </Field>
      </div>
      <p className={styles.dialogNote}>Здесь просят вещи, место или помощь руками. Деньги и оплату не собираем.</p>
      {error && (
        <p className={styles.dialogError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.dialogActions}>
        <Button variant="primary" loading={mutation.isPending} loadingText="Публикуем…" onClick={submit}>
          Опубликовать просьбу
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
