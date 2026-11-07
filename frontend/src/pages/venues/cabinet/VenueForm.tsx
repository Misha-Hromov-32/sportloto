import { useCreate, useList, useUpdate } from '@refinedev/core';
import { App, Input, InputNumber, Modal, Segmented, Select } from 'antd';
import { lazy, Suspense, useId, useState } from 'react';

import { Button, Chip, SkeletonBlock } from '@/components';
import { errorMessage } from '@/lib/api';
import { cityLocationFilters } from '@/lib/cities';
import { choosable, WITH_HIDDEN } from '@/lib/sportChoices';
import { useSelectedCity } from '@/lib/useSelectedCity';
import { VENUE_FEATURE, VENUE_FEATURES, VENUE_KIND } from '@/lib/venues';
import type { SportView, VenueDetails } from '@/types/api';
import type { District, GeoPoint, VenueFeature, VenueKind } from '@/types/domain';
import type { VenueInput } from '@/types/inputs';

import { Field, FieldGroup } from '../../events/create/fields';
import { FEATURE_ICON } from '../parts/icons';
import styles from './cabinet.module.css';

const PointPicker = lazy(() => import('../../events/create/PointPicker'));

const HOURS = Array.from({ length: 19 }, (_, i) => `${String(i + 6).padStart(2, '0')}:00`);
const KINDS = Object.keys(VENUE_KIND) as VenueKind[];

interface Values {
  name: string;
  kind: VenueKind;
  description: string;
  address: string;
  landmark: string;
  districtId: string | null;
  point: GeoPoint | null;
  sportIds: string[];
  indoor: boolean;
  pricePerHour: number | null;
  peakPricePerHour: number | null;
  features: VenueFeature[];
  photoUrl: string;
  phone: string;
  email: string;
  site: string;
  open: string;
  close: string;
}

function initialValues(v: VenueDetails | null, contacts: { phone: string; email: string }): Values {
  return {
    name: v?.name ?? '',
    kind: v?.kind ?? 'hall',
    description: v?.description ?? '',
    address: v?.address ?? '',
    landmark: v?.landmark ?? '',
    districtId: v?.districtId ?? null,
    point: v ? { lat: v.lat, lng: v.lng } : null,
    sportIds: v?.sportIds ?? [],
    indoor: v?.indoor ?? true,
    pricePerHour: v?.pricePerHour ?? null,
    peakPricePerHour: v?.peakPricePerHour ?? null,
    features: v?.features ?? [],
    photoUrl: v?.photoUrl ?? '',
    phone: v?.contacts.phone ?? contacts.phone,
    email: v?.contacts.email ?? contacts.email,
    site: v?.contacts.site ?? '',
    open: v?.hours.open ?? '08:00',
    close: v?.hours.close ?? '22:00',
  };
}

/** Сведения о площадке: добавить новую или изменить. Права и проверки — на стороне API. */
export function VenueForm({
  orgId,
  venue,
  contacts,
  onClose,
  onSaved,
}: {
  orgId: string;
  venue: VenueDetails | null;
  contacts: { phone: string; email: string };
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const city = useSelectedCity();
  const { message } = App.useApp();
  const ids = { name: useId(), address: useId(), landmark: useId(), price: useId(), peak: useId(), desc: useId() };
  const [values, setValues] = useState<Values>(() => initialValues(venue, contacts));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<Values>) => setValues((v) => ({ ...v, ...patch }));
  const { mutateAsync: create, mutation: creating } = useCreate<VenueDetails>();
  const { mutateAsync: update, mutation: updating } = useUpdate<VenueDetails>();
  const allSports =
    useList<SportView>({ resource: 'sports', filters: WITH_HIDDEN, pagination: { mode: 'off' } }).result.data ?? [];
  const sports = choosable(allSports, values.sportIds);
  const districts =
    useList<District>({ resource: 'districts', filters: cityLocationFilters(city, ''), pagination: { mode: 'off' } })
      .result.data ?? [];
  const district = districts.find((d) => d.id === values.districtId);

  const toggleFeature = (f: VenueFeature) =>
    set({ features: values.features.includes(f) ? values.features.filter((x) => x !== f) : [...values.features, f] });

  const submit = async () => {
    const input: VenueInput = {
      name: values.name,
      kind: values.kind,
      description: values.description,
      address: values.address,
      landmark: values.landmark,
      districtId: values.districtId,
      ...(values.point ? { lat: values.point.lat, lng: values.point.lng } : {}),
      sportIds: values.sportIds,
      indoor: values.indoor,
      pricePerHour: values.pricePerHour ?? 0,
      peakPricePerHour: values.peakPricePerHour,
      features: values.features,
      photoUrl: values.photoUrl.trim() || null,
      contacts: { phone: values.phone, email: values.email, site: values.site },
      hours: { open: values.open, close: values.close },
    };
    setErrors({});
    try {
      const res = venue
        ? await update({
            resource: 'venues',
            id: venue.id,
            values: input,
            successNotification: false,
            errorNotification: false,
          })
        : await create({
            resource: 'venues',
            values: { ...input, orgId },
            successNotification: false,
            errorNotification: false,
          });
      message.success(venue ? 'Сведения о площадке сохранены' : 'Площадка добавлена. Теперь отметьте занятые окна');
      onSaved(String(res.data.id));
    } catch (error) {
      setErrors((error as { errors?: Record<string, string> }).errors ?? {});
      message.error(errorMessage(error, 'Не получилось сохранить. Проверьте поля'));
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      width={760}
      title={venue ? 'Сведения о площадке' : 'Новая площадка'}
      destroyOnHidden
      footer={
        <div className={styles.formFooter}>
          <Button variant="quiet" onClick={onClose}>
            Не сохранять
          </Button>
          <Button
            variant="primary"
            loading={creating.isPending || updating.isPending}
            loadingText="Сохраняем…"
            onClick={() => void submit()}
          >
            {venue ? 'Сохранить сведения' : 'Добавить площадку'}
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <Field label="Название" htmlFor={ids.name} error={errors.name}>
          <Input
            id={ids.name}
            size="large"
            value={values.name}
            onChange={(e) => set({ name: e.target.value })}
            maxLength={80}
            placeholder="Например: «Енисей-Арена», малый зал"
            status={errors.name ? 'error' : undefined}
          />
        </Field>
        <FieldGroup legend="Тип площадки" error={errors.kind}>
          <div className={styles.chips}>
            {KINDS.map((k) => (
              <Chip key={k} selected={values.kind === k} onClick={() => set({ kind: k })}>
                {VENUE_KIND[k]}
              </Chip>
            ))}
          </div>
          <Segmented<'in' | 'out'>
            aria-label="Крытая или открытая"
            value={values.indoor ? 'in' : 'out'}
            onChange={(v) => set({ indoor: v === 'in' })}
            options={[
              { value: 'in', label: 'Крытая' },
              { value: 'out', label: 'Открытая' },
            ]}
          />
        </FieldGroup>
        <FieldGroup legend="Направления" error={errors.sportIds} hint="Чем можно заниматься на площадке.">
          <Select
            mode="multiple"
            size="large"
            value={values.sportIds}
            onChange={(sportIds: string[]) => set({ sportIds })}
            options={sports.map((s) => ({ value: s.id, label: s.name }))}
            optionFilterProp="label"
            placeholder="Волейбол, баскетбол…"
            aria-label="Направления"
            status={errors.sportIds ? 'error' : undefined}
          />
        </FieldGroup>
        <div className={styles.grid2}>
          <Field label="Адрес" htmlFor={ids.address} error={errors.address}>
            <Input
              id={ids.address}
              size="large"
              value={values.address}
              onChange={(e) => set({ address: e.target.value })}
              maxLength={160}
              placeholder="Улица, дом"
              status={errors.address ? 'error' : undefined}
            />
          </Field>
          <FieldGroup legend="Район">
            <Select
              size="large"
              value={values.districtId ?? undefined}
              onChange={(v: string | undefined) => set({ districtId: v ?? null })}
              allowClear
              placeholder="Выберите район"
              options={districts.map((d) => ({ value: d.id, label: d.name }))}
              aria-label="Район"
            />
          </FieldGroup>
        </div>
        <Field label="Как найти вход" htmlFor={ids.landmark} optional>
          <Input
            id={ids.landmark}
            size="large"
            value={values.landmark}
            onChange={(e) => set({ landmark: e.target.value })}
            maxLength={160}
            placeholder="Вход со двора, лифт справа"
          />
        </Field>
        <FieldGroup legend="Точка на карте" hint="Нажмите на карту, где вход. По точке считаем, кому ближе.">
          <Suspense fallback={<SkeletonBlock height={240} radius="media" />}>
            <PointPicker
              point={values.point}
              center={values.point ?? district ?? city.center}
              onChange={(point) => set({ point })}
            />
          </Suspense>
        </FieldGroup>
        <div className={styles.grid2}>
          <Field label="Цена за час, ₽" htmlFor={ids.price} error={errors.pricePerHour} hint="Если площадка бесплатная, поставьте 0.">
            <InputNumber
              id={ids.price}
              size="large"
              min={0}
              max={100000}
              step={100}
              value={values.pricePerHour}
              onChange={(v) => set({ pricePerHour: v === null ? null : Number(v) })}
              style={{ width: '100%' }}
            />
          </Field>
          <Field
            label="Вечером и в выходные, ₽"
            htmlFor={ids.peak}
            optional
            error={errors.peakPricePerHour}
            hint="С 18:00 и в субботу и воскресенье."
          >
            <InputNumber
              id={ids.peak}
              size="large"
              min={0}
              max={100000}
              step={100}
              value={values.peakPricePerHour}
              onChange={(v) => set({ peakPricePerHour: v === null ? null : Number(v) })}
              style={{ width: '100%' }}
            />
          </Field>
        </div>
        <FieldGroup legend="Часы работы" error={errors.hours} hint="Окна по 2 часа от открытия до закрытия.">
          <div className={styles.row}>
            <Select
              size="large"
              value={values.open}
              onChange={(open: string) => set({ open })}
              options={HOURS.map((h) => ({ value: h, label: `с ${h}` }))}
              aria-label="Открытие"
              className={styles.hours}
            />
            <Select
              size="large"
              value={values.close}
              onChange={(close: string) => set({ close })}
              options={HOURS.map((h) => ({ value: h, label: `до ${h}` }))}
              aria-label="Закрытие"
              className={styles.hours}
            />
          </div>
        </FieldGroup>
        <FieldGroup
          legend="Условия"
          error={errors.features}
          hint="Первые четыре — для маломобильных гостей. По ним ищут в фильтре «Доступная среда»."
        >
          <div className={styles.chips}>
            {VENUE_FEATURES.map((f) => {
              const I = FEATURE_ICON[f];
              return (
                <Chip
                  key={f}
                  selected={values.features.includes(f)}
                  icon={<I size={18} aria-hidden />}
                  onClick={() => toggleFeature(f)}
                >
                  {VENUE_FEATURE[f].label}
                </Chip>
              );
            })}
          </div>
        </FieldGroup>
        <Field label="Описание" htmlFor={ids.desc} optional>
          <Input.TextArea
            id={ids.desc}
            value={values.description}
            onChange={(e) => set({ description: e.target.value })}
            autoSize={{ minRows: 3, maxRows: 6 }}
            maxLength={1000}
            placeholder="Размер зала, покрытие, что выдаёте на месте"
          />
        </Field>
        <FieldGroup legend="Контакты для аренды" error={errors.contacts}>
          <div className={styles.grid2}>
            <Input
              size="large"
              value={values.phone}
              onChange={(e) => set({ phone: e.target.value })}
              placeholder="Телефон"
              aria-label="Телефон"
            />
            <Input
              size="large"
              value={values.email}
              onChange={(e) => set({ email: e.target.value })}
              placeholder="Почта"
              aria-label="Почта"
            />
          </div>
          <Input
            size="large"
            value={values.site}
            onChange={(e) => set({ site: e.target.value })}
            placeholder="Сайт или группа, необязательно"
            aria-label="Сайт или группа"
          />
        </FieldGroup>
        <Field label="Ссылка на фото" optional hint="Фото зала или поля: так проще узнать место.">
          <Input
            size="large"
            value={values.photoUrl}
            onChange={(e) => set({ photoUrl: e.target.value })}
            placeholder="https://…"
            aria-label="Ссылка на фото"
          />
        </Field>
      </div>
    </Modal>
  );
}
