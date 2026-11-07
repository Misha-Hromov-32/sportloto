import { ArrowSquareOutIcon, EyeIcon, EyeSlashIcon, PencilSimpleIcon, PlusIcon } from '@phosphor-icons/react';
import { useList, useOne, useUpdate } from '@refinedev/core';
import { App, InputNumber, Modal } from 'antd';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button, Chip, EmptyState, ErrorState, SkeletonBlock } from '@/components';
import { API, errorMessage, useAction, useLiveRefetch } from '@/lib/api';
import { hourPrice, updatedLabel, venuePriceLine, venueTime } from '@/lib/venues';
import type { OrganizationView, VenueDetails, VenueSlotView, VenueView } from '@/types/api';

import { FeatureTags } from '../parts/features';
import { DayPicker, SlotList } from '../parts/Schedule';
import styles from './cabinet.module.css';
import { VenueForm } from './VenueForm';

/**
 * В4: кабинет организации-площадки. Владелец ведёт площадки и отмечает окна на две недели:
 * свободно или занято и цену за час. Бронирования нет — люди звонят по контактам.
 */
export function VenueCabinet({ org }: { org: OrganizationView }) {
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState<'new' | 'edit' | null>(null);
  const list = useList<VenueView>({
    resource: 'venues',
    filters: [
      { field: 'scope', operator: 'eq', value: 'mine' },
      { field: 'orgId', operator: 'eq', value: org.id },
    ],
    pagination: { mode: 'off' },
  });
  useLiveRefetch(['venues'], () => void list.query.refetch());
  const venues = list.result.data ?? [];
  const selectedId = venues.some((v) => v.id === params.get('venue')) ? params.get('venue')! : venues[0]?.id;
  const select = (id: string) => {
    const p = new URLSearchParams(params);
    p.set('venue', id);
    setParams(p, { replace: true, preventScrollReset: true });
  };

  return (
    <section className={styles.root} aria-labelledby="venues-title">
      <header className={styles.head}>
        <div>
          <h2 id="venues-title" className={styles.title}>
            Площадки и свободные окна
          </h2>
          <p className={styles.muted}>
            Отмечайте, когда площадка свободна: люди увидят окна в разделе «Площадки» и предложат встречу. Звонки об
            аренде придут на ваши контакты.
          </p>
        </div>
        <Button variant="secondary" icon={<PlusIcon size={20} aria-hidden />} onClick={() => setForm('new')}>
          Добавить площадку
        </Button>
      </header>

      {list.query.isLoading ? (
        <SkeletonBlock height={320} />
      ) : list.query.isError ? (
        <ErrorState onRetry={() => void list.query.refetch()}>Не удалось загрузить площадки.</ErrorState>
      ) : venues.length === 0 ? (
        <EmptyState
          title="Площадок пока нет"
          actions={
            <Button variant="primary" onClick={() => setForm('new')}>
              Добавить площадку
            </Button>
          }
        >
          Добавьте зал, корт или поле: адрес, цену за час и условия. Окна на две недели сразу будут свободны, занятые
          отметите одним нажатием.
        </EmptyState>
      ) : (
        <>
          {venues.length > 1 && (
            <div className={styles.tabs} role="group" aria-label="Площадка">
              {venues.map((v) => (
                <Chip key={v.id} selected={v.id === selectedId} onClick={() => select(v.id)}>
                  {v.name}
                </Chip>
              ))}
            </div>
          )}
          {selectedId && <VenueManager key={selectedId} id={selectedId} onEdit={() => setForm('edit')} />}
        </>
      )}

      {form && (
        <FormLoader
          orgId={org.id}
          venueId={form === 'edit' ? (selectedId ?? null) : null}
          contacts={{ phone: org.contacts.phone, email: org.contacts.email }}
          onClose={() => setForm(null)}
          onSaved={(id) => {
            setForm(null);
            select(id);
          }}
        />
      )}
    </section>
  );
}

function FormLoader({
  orgId,
  venueId,
  contacts,
  onClose,
  onSaved,
}: {
  orgId: string;
  venueId: string | null;
  contacts: { phone: string; email: string };
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { result, query } = useOne<VenueDetails>({
    resource: 'venues',
    id: venueId ?? '',
    queryOptions: { enabled: Boolean(venueId) },
  });
  if (venueId && (query.isLoading || !result)) return null;
  return <VenueForm orgId={orgId} venue={venueId ? (result ?? null) : null} contacts={contacts} onClose={onClose} onSaved={onSaved} />;
}

function VenueManager({ id, onEdit }: { id: string; onEdit: () => void }) {
  const { message } = App.useApp();
  const { run, isPending } = useAction<VenueDetails>();
  const { mutateAsync: update, mutation: updating } = useUpdate<VenueDetails>();
  const { result: v, query } = useOne<VenueDetails>({ resource: 'venues', id });
  const [date, setDate] = useState<string | null>(null);
  const [priceSlot, setPriceSlot] = useState<VenueSlotView | null>(null);

  if (query.isLoading) return <SkeletonBlock height={320} />;
  if (query.isError || !v)
    return <ErrorState onRetry={() => void query.refetch()}>Не удалось загрузить площадку.</ErrorState>;

  const day = v.days.find((d) => d.date === (date ?? v.days[0]?.date)) ?? v.days[0];
  const editable = (day?.slots ?? []).filter((s) => s.status !== 'event');

  const save = (slots: { startsAt: string; free: boolean; price?: number | null }[], success: string) =>
    run(API.venueSlots(v.id), { slots }, { success }).catch(() => undefined);

  const toggleHidden = async () => {
    try {
      await update({
        resource: 'venues',
        id: v.id,
        values: { status: v.status === 'hidden' ? 'active' : 'hidden' },
        successNotification: false,
        errorNotification: false,
      });
      message.success(v.status === 'hidden' ? 'Площадка снова видна в поиске' : 'Площадка скрыта из поиска');
    } catch (error) {
      message.error(errorMessage(error));
    }
  };

  return (
    <div className={styles.manager}>
      <div className={styles.venueHead}>
        <div className={styles.venueText}>
          <h3 className={styles.venueName}>{v.name}</h3>
          <p className={styles.muted}>
            {v.address}. {venuePriceLine(v)}. Часы работы {v.hours.open}–{v.hours.close}
          </p>
          <p className={styles.status}>
            {v.status === 'hidden' ? (
              <span className={styles.statusOff}>
                <EyeSlashIcon size={18} aria-hidden /> Скрыта: в поиске её не видно
              </span>
            ) : (
              <span className={styles.statusOn}>
                <EyeIcon size={18} aria-hidden /> Видна всем
              </span>
            )}
            <span className={styles.muted}>{updatedLabel(v.ownerUpdatedDays)}</span>
          </p>
          <FeatureTags features={v.features} />
        </div>
        <div className={styles.venueActions}>
          <Button variant="secondary" size="sm" icon={<PencilSimpleIcon size={18} aria-hidden />} onClick={onEdit}>
            Изменить сведения
          </Button>
          <Button variant="quiet" size="sm" to={`/venues/${v.id}`} icon={<ArrowSquareOutIcon size={18} aria-hidden />}>
            Как видят люди
          </Button>
          <Button variant="quiet" size="sm" loading={updating.isPending} onClick={() => void toggleHidden()}>
            {v.status === 'hidden' ? 'Показать в поиске' : 'Скрыть из поиска'}
          </Button>
        </div>
      </div>

      <div className={styles.schedule}>
        <DayPicker days={v.days} value={day?.date ?? ''} onChange={setDate} timeZone={v.timeZone} />
        {editable.length > 0 && (
          <div className={styles.bulk}>
            <Button
              variant="quiet"
              size="sm"
              disabled={isPending}
              onClick={() =>
                void save(
                  editable.map((s) => ({ startsAt: s.startsAt, free: true })),
                  'Все окна дня отмечены свободными',
                )
              }
            >
              Весь день свободен
            </Button>
            <Button
              variant="quiet"
              size="sm"
              disabled={isPending}
              onClick={() =>
                void save(
                  editable.map((s) => ({ startsAt: s.startsAt, free: false })),
                  'Все окна дня отмечены занятыми',
                )
              }
            >
              Весь день занят
            </Button>
          </div>
        )}
        <SlotList
          day={day}
          timeZone={v.timeZone}
          action={(s) =>
            s.status === 'event' ? (
              <span className={styles.muted}>Занято встречей</span>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() =>
                    void save(
                      [{ startsAt: s.startsAt, free: s.status !== 'free' }],
                      s.status === 'free' ? 'Окно отмечено занятым' : 'Окно отмечено свободным',
                    )
                  }
                >
                  {s.status === 'free' ? 'Отметить занятым' : 'Отметить свободным'}
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setPriceSlot(s)}>
                  Цена
                </Button>
              </>
            )
          }
        />
      </div>

      {priceSlot && (
        <PriceDialog
          slot={priceSlot}
          timeZone={v.timeZone}
          onClose={() => setPriceSlot(null)}
          onSave={async (price) => {
            await save([{ startsAt: priceSlot.startsAt, free: priceSlot.status === 'free', price }], 'Цена окна сохранена');
            setPriceSlot(null);
          }}
        />
      )}
    </div>
  );
}

function PriceDialog({
  slot,
  timeZone,
  onClose,
  onSave,
}: {
  slot: VenueSlotView;
  timeZone: string;
  onClose: () => void;
  onSave: (price: number | null) => Promise<void>;
}) {
  const [price, setPrice] = useState<number | null>(slot.price);
  const [saving, setSaving] = useState(false);
  const submit = async (value: number | null) => {
    setSaving(true);
    await onSave(value);
    setSaving(false);
  };
  return (
    <Modal
      open
      onCancel={onClose}
      title={`Цена окна ${venueTime(slot.startsAt, timeZone)}–${venueTime(slot.endsAt, timeZone)}`}
      destroyOnHidden
      footer={
        <div className={styles.formFooter}>
          {slot.custom && (
            <Button variant="quiet" disabled={saving} onClick={() => void submit(null)}>
              Вернуть обычную цену
            </Button>
          )}
          <Button
            variant="primary"
            loading={saving}
            loadingText="Сохраняем…"
            disabled={price === null}
            onClick={() => void submit(price)}
          >
            Сохранить цену
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <p className={styles.muted}>Сейчас: {hourPrice(slot.price)}. Например, скидка на утро или на свободное окно сегодня.</p>
        <InputNumber
          size="large"
          min={0}
          max={100000}
          step={100}
          value={price}
          onChange={(v) => setPrice(v === null ? null : Number(v))}
          addonAfter="₽ в час"
          aria-label="Цена за час"
          style={{ width: '100%' }}
        />
      </div>
    </Modal>
  );
}
