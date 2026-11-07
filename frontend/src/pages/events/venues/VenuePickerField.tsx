import {
  ArrowSquareOutIcon,
  BuildingsIcon,
  MagnifyingGlassIcon,
  MapPinAreaIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useList, useOne } from '@refinedev/core';
import { App, Input, Modal } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button, Chip, ErrorState, SkeletonBlock } from '@/components';
import { cityLocationFilters } from '@/lib/cities';
import { zonedParts } from '@/lib/timezone';
import { useSelectedCity } from '@/lib/useSelectedCity';
import { ACCESS_EXTRA, basePrice, SLOT_MIN, venuePriceLine, venueTime, windowShort } from '@/lib/venues';
import type { BestPlaceOption, VenueDetails, VenueSlotView, VenueView } from '@/types/api';
import type { EventAccessExtra } from '@/types/domain';

import { FeatureTags } from '../../venues/parts/features';
import { EXTRA_ICON } from '../../venues/parts/icons';
import { DayPicker, SlotList } from '../../venues/parts/Schedule';
import { FieldGroup } from '../create/fields';
import { startsAtOf, type EventForm } from '../create/model';
import { BestPlaceDialog } from '../manage/bestplace/BestPlaceDialog';
import styles from './VenuePicker.module.css';

const VENUE_PRICE_NOTE = 'на аренду площадки';

interface Props {
  form: EventForm;
  set: (patch: Partial<EventForm>) => void;
}

type VenueLike = Pick<
  VenueView,
  'id' | 'address' | 'landmark' | 'districtId' | 'lat' | 'lng' | 'timeZone' | 'pricePerHour' | 'peakPricePerHour' | 'name'
>;

/** Поля формы, которые подставляет площадка: адрес, точка, район, пояс и цена аренды. */
function venuePatch(form: EventForm, v: VenueLike, pricePerHour?: number): Partial<EventForm> {
  const patch: Partial<EventForm> = {
    venueId: v.id,
    address: v.address,
    districtId: v.districtId,
    point: { lat: v.lat, lng: v.lng },
    timeZone: v.timeZone,
  };
  if (!form.howToFind.trim()) patch.howToFind = v.landmark;
  const start = startsAtOf({ ...form, timeZone: v.timeZone });
  const price = pricePerHour ?? (start ? basePrice(v, start) : v.pricePerHour);
  const rentable = form.priceKind === 'free' || (form.priceKind === 'split' && form.priceNote === VENUE_PRICE_NOTE);
  if (price > 0 && rentable) {
    patch.priceKind = 'split';
    patch.priceTotal = Math.round((price * (form.durationMin || SLOT_MIN)) / 60);
    patch.priceNote = VENUE_PRICE_NOTE;
  }
  return patch;
}

/**
 * В4: «Выбрать площадку» на шаге «Где». Подставляет адрес, точку и цену аренды, показывает свободные окна
 * выбранного дня. Н1: условия доступности площадки и что добавляет организатор.
 */
export function VenuePickerField({ form, set }: Props) {
  const { message } = App.useApp();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bestOpen, setBestOpen] = useState(false);
  const venueId = form.venueId ?? null;
  const { result: venue, query } = useOne<VenueDetails>({
    resource: 'venues',
    id: venueId ?? '',
    queryOptions: { enabled: Boolean(venueId), retry: false },
    errorNotification: false,
  });

  // Пришли со страницы площадки («Предложить встречу здесь»): адрес ещё пустой — подставляем сами
  const filled = useRef<string | null>(null);
  useEffect(() => {
    if (!venue || filled.current === venue.id) return;
    filled.current = venue.id;
    if (!form.address.trim()) set(venuePatch(form, venue));
  }, [venue, form, set]);

  const choose = (v: VenueLike, pricePerHour?: number) => {
    filled.current = v.id;
    const patch = venuePatch(form, v, pricePerHour);
    set(patch);
    message.success(
      patch.priceKind === 'split'
        ? `Подставили адрес и аренду: ${patch.priceTotal?.toLocaleString('ru-RU')} ₽ делим на всех. Цену можно поменять на шаге «Первый шаг и деньги»`
        : 'Подставили адрес и точку на карте',
    );
  };

  const pickWindow = (slot: VenueSlotView) => {
    if (!venue) return;
    const durationMin = form.durationMin > SLOT_MIN ? SLOT_MIN : form.durationMin;
    const next = {
      ...form,
      date: zonedParts(slot.startsAt, venue.timeZone).date,
      time: venueTime(slot.startsAt, venue.timeZone),
      timeZone: venue.timeZone,
      durationMin,
    };
    set({ date: next.date, time: next.time, timeZone: next.timeZone, durationMin, ...venuePatch(next, venue, slot.price) });
  };

  return (
    <div className={styles.root}>
      <FieldGroup
        legend="Площадка"
        optional
        hint="Выберите площадку из списка: подставим адрес, точку на карте и цену аренды, покажем свободные окна."
      >
        {!venueId ? (
          <div className={styles.actions}>
            <Button variant="secondary" icon={<BuildingsIcon size={20} aria-hidden />} onClick={() => setPickerOpen(true)}>
              Выбрать площадку
            </Button>
            {form.companionId && (
              <Button
                variant="secondary"
                icon={<MapPinAreaIcon size={20} aria-hidden />}
                onClick={() => setBestOpen(true)}
              >
                Подобрать место для всех
              </Button>
            )}
          </div>
        ) : query.isLoading ? (
          <SkeletonBlock height={160} />
        ) : query.isError || !venue ? (
          <ErrorState onRetry={() => void query.refetch()}>
            Не удалось загрузить площадку. Можно выбрать другую или указать адрес вручную.
          </ErrorState>
        ) : (
          <SelectedVenue
            venue={venue}
            form={form}
            onPickWindow={pickWindow}
            onDate={(date) => set({ date })}
            onChange={() => setPickerOpen(true)}
            onBest={form.companionId ? () => setBestOpen(true) : undefined}
            onRemove={() => {
              filled.current = null;
              set({ venueId: null });
            }}
          />
        )}
      </FieldGroup>

      {pickerOpen && (
        <VenuePickerModal
          sportId={form.sport?.id ?? null}
          sportName={form.sport?.name ?? null}
          date={form.date || null}
          onClose={() => setPickerOpen(false)}
          onPick={(v) => {
            choose(v);
            setPickerOpen(false);
          }}
        />
      )}
      {bestOpen && form.companionId && (
        <BestPlaceDialog
          open
          onClose={() => setBestOpen(false)}
          input={{
            companionId: form.companionId,
            sportId: form.sport?.id ?? null,
            startsAt: startsAtOf(form),
            durationMin: form.durationMin,
          }}
          mode={{
            kind: 'pick',
            onPick: (o: BestPlaceOption) => choose(o.venue, o.window?.price),
          }}
        />
      )}
    </div>
  );
}

/** Н1: условия доступной среды площадки и что добавляет организатор. */
export function AccessExtrasField({ form, set }: Props) {
  const venueId = form.venueId ?? null;
  const { result: venue } = useOne<VenueDetails>({
    resource: 'venues',
    id: venueId ?? '',
    queryOptions: { enabled: Boolean(venueId), retry: false },
    errorNotification: false,
  });
  const toggleExtra = (x: EventAccessExtra) => {
    const list = form.accessExtras ?? [];
    set({ accessExtras: list.includes(x) ? list.filter((y) => y !== x) : [...list, x] });
  };
  return (
    <FieldGroup
      legend="Доступная среда"
      optional
      hint={
        venue
          ? 'Условия площадки покажем на карточке. Добавьте то, что даёте вы сами.'
          : 'Отметьте, если поможете людям с инвалидностью и тем, кому трудно ходить.'
      }
    >
      {venue && <FeatureTags features={venue.features} onlyAccess />}
      <div className={styles.extras} role="group" aria-label="Что даёте вы">
        {(Object.keys(ACCESS_EXTRA) as EventAccessExtra[]).map((x) => {
          const I = EXTRA_ICON[x];
          return (
            <Chip
              key={x}
              selected={(form.accessExtras ?? []).includes(x)}
              icon={<I size={18} aria-hidden />}
              onClick={() => toggleExtra(x)}
            >
              {ACCESS_EXTRA[x].label}
            </Chip>
          );
        })}
      </div>
    </FieldGroup>
  );
}

function SelectedVenue({
  venue: v,
  form,
  onPickWindow,
  onDate,
  onChange,
  onBest,
  onRemove,
}: {
  venue: VenueDetails;
  form: EventForm;
  onPickWindow: (slot: VenueSlotView) => void;
  onDate: (date: string) => void;
  onChange: () => void;
  onBest?: () => void;
  onRemove: () => void;
}) {
  const day = v.days.find((d) => d.date === form.date);
  const start = startsAtOf({ ...form, timeZone: v.timeZone });
  const warning = useMemo(() => {
    if (!start) return null;
    const from = new Date(start).getTime();
    const to = from + form.durationMin * 60_000;
    const slots = v.days.flatMap((d) => d.slots);
    const covering = slots.filter((s) => new Date(s.startsAt).getTime() < to && new Date(s.endsAt).getTime() > from);
    if (!covering.length) return `В это время площадка не работает. Часы работы: ${v.hours.open}–${v.hours.close}.`;
    const first = new Date(covering[0]!.startsAt).getTime();
    const last = new Date(covering[covering.length - 1]!.endsAt).getTime();
    if (first > from || last < to) return `Встреча выходит за часы работы площадки: ${v.hours.open}–${v.hours.close}.`;
    if (covering.some((s) => s.status !== 'free'))
      return 'В это время площадка отмечена как занятая. Выберите свободное окно или договоритесь с площадкой.';
    return null;
  }, [start, form.durationMin, v]);

  return (
    <div className={styles.selected}>
      <div className={styles.selectedHead}>
        <div className={styles.selectedText}>
          <a href={`/venues/${v.id}`} target="_blank" rel="noreferrer" className={styles.selectedName}>
            {v.name}
            <ArrowSquareOutIcon size={16} aria-hidden />
            <span className="sr-only">(в новой вкладке)</span>
          </a>
          <span className={styles.muted}>
            {v.address}
            {v.districtName && `, район ${v.districtName}`}
          </span>
          <span className={styles.price}>{venuePriceLine(v)}</span>
          {v.contacts.phone && (
            <span className={styles.muted}>Договориться об аренде: {v.contacts.phone}</span>
          )}
        </div>
        <div className={styles.selectedActions}>
          <Button variant="quiet" size="sm" onClick={onChange}>
            Сменить площадку
          </Button>
          {onBest && (
            <Button variant="quiet" size="sm" onClick={onBest}>
              Подобрать для всех
            </Button>
          )}
          <Button variant="quiet" size="sm" onClick={onRemove}>
            Убрать площадку
          </Button>
        </div>
      </div>

      <div className={styles.windows}>
        <p className={styles.windowsTitle}>
          {form.date ? 'Свободные окна в выбранный день' : 'Выберите день, чтобы увидеть свободные окна'}
        </p>
        <DayPicker days={v.days} value={form.date} onChange={onDate} timeZone={v.timeZone} />
        {form.date && (
          <SlotList
            day={day}
            timeZone={v.timeZone}
            empty={day ? undefined : 'Расписание площадки ведётся на две недели вперёд. Выберите день поближе.'}
            action={(slot) => {
              if (slot.status !== 'free') return null;
              const chosen = start === slot.startsAt;
              return chosen ? (
                <span className={styles.chosen}>Выбрано</span>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => onPickWindow(slot)}>
                  Выбрать
                </Button>
              );
            }}
          />
        )}
        {warning && (
          <p className={styles.warning} role="status">
            <WarningCircleIcon size={20} aria-hidden />
            {warning}
          </p>
        )}
      </div>
    </div>
  );
}

function VenuePickerModal({
  sportId,
  sportName,
  date,
  onClose,
  onPick,
}: {
  sportId: string | null;
  sportName: string | null;
  date: string | null;
  onClose: () => void;
  onPick: (v: VenueView) => void;
}) {
  const city = useSelectedCity();
  const [q, setQ] = useState('');
  const [bySport, setBySport] = useState(Boolean(sportId));
  const { result, query } = useList<VenueView>({
    resource: 'venues',
    filters: [
      ...(bySport && sportId ? [{ field: 'sportIds', operator: 'eq' as const, value: [sportId] }] : []),
      ...(q.trim() ? [{ field: 'q', operator: 'eq' as const, value: q.trim() }] : []),
      ...cityLocationFilters(city, ''),
    ],
    pagination: { mode: 'off' },
  });
  const venues = result.data ?? [];

  return (
    <Modal open onCancel={onClose} footer={null} width={760} title="Выбрать площадку" destroyOnHidden>
      <div className={styles.modal}>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Название или адрес: Енисей-Арена, Копылова…"
          prefix={<MagnifyingGlassIcon size={18} aria-hidden />}
          allowClear
          size="large"
          aria-label="Найти площадку"
        />
        {sportId && (
          <div className={styles.extras}>
            <Chip selected={bySport} onClick={() => setBySport(true)}>
              Для «{sportName}»
            </Chip>
            <Chip selected={!bySport} onClick={() => setBySport(false)}>
              Все площадки
            </Chip>
          </div>
        )}
        {query.isLoading ? (
          <div className={styles.list}>
            <SkeletonBlock height={96} />
            <SkeletonBlock height={96} />
            <SkeletonBlock height={96} />
          </div>
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()}>Не удалось загрузить площадки.</ErrorState>
        ) : venues.length === 0 ? (
          <div className={styles.empty}>
            <p>
              {bySport && sportName
                ? `Площадок для «${sportName}» не нашлось.`
                : 'Ничего не нашлось. Попробуйте другое слово.'}
            </p>
            {bySport && (
              <Button variant="secondary" onClick={() => setBySport(false)}>
                Показать все площадки
              </Button>
            )}
          </div>
        ) : (
          <ul className={styles.list}>
            {venues.map((v) => (
              <li key={v.id} className={styles.row}>
                <div className={styles.rowText}>
                  <b>{v.name}</b>
                  <span className={styles.muted}>
                    {v.address}
                    {v.districtName && `, район ${v.districtName}`}
                  </span>
                  <span className={styles.price}>{venuePriceLine(v)}</span>
                  <FeatureTags features={v.features} onlyAccess max={3} />
                  <span className={styles.muted}>
                    {v.nextWindows.length
                      ? `Свободно: ${v.nextWindows
                          .slice(0, 2)
                          .map((w) => windowShort(w, v.timeZone))
                          .join('; ')}`
                      : 'Свободных окон на две недели нет'}
                    {date ? '. Окна выбранного дня покажем после выбора' : ''}
                  </span>
                </div>
                <Button variant="secondary" onClick={() => onPick(v)}>
                  Выбрать
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
