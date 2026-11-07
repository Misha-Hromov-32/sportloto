import calendarDayjs from 'dayjs';
import { publicDiscussion } from '@/lib/eventRules';
import { MapPinLineIcon } from '@phosphor-icons/react';
import { useList } from '@refinedev/core';
import { AutoComplete, DatePicker, Input, InputNumber, Select, Switch, TimePicker } from 'antd';
import { lazy, Suspense, useId, useRef, useState, type ReactNode } from 'react';

import { AssistantMark, Button, Chip, SkeletonBlock } from '@/components';
import { dayjs } from '@/lib/dates';
import { CITIES, cityLocationFilters, pointInCity } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import { EVENT_LEVEL, EVENT_LEVEL_HINT, INTENSITY } from '@/lib/labels';
import { cancelPolicyText, formatRub } from '@/lib/money';
import { count, WORDS } from '@/lib/plural';
import { capitalize } from '@/lib/text';
import type { SportView } from '@/types/api';
import type { District, EventLevel, Intensity } from '@/types/domain';

import { ChoiceChips, Field, FieldGroup, OptionCards, ToggleRow } from './fields';
import {
  AMENITY_OPTIONS,
  formatDateInput,
  formTimeCity,
  cancelPolicyOf,
  MAX_REPEAT_WEEKS,
  seriesCount,
  startsAtOf,
  type EventForm,
  type FormErrors,
} from './model';
import styles from './sections.module.css';
import { AccessExtrasField, VenuePickerField } from '../venues/VenuePickerField'; // В4, Н1
import { SportPicker } from './SportPicker';
import { useAddressPoint, type GeoPlace } from './addressPoint';
import { GearFields } from '../event/inventory/GearFields'; // В3
import { PaymentModeField } from './PaymentModeField';

const PointPicker = lazy(() => import('./PointPicker'));

export interface SectionProps {
  form: EventForm;
  set: (patch: Partial<EventForm>) => void;
  errors: FormErrors;
  edit?: boolean;
  detailsOnly?: boolean;
  /** Поля, которые заполнил помощник, и «почему так». */
  marks?: Record<string, string>;
}

function Mark({ marks, field }: { marks?: Record<string, string>; field: string }) {
  const why = marks?.[field];
  return why !== undefined ? <AssistantMark why={why} /> : null;
}

// ---------- Что ----------

export function SportField({ form, set, errors, edit, marks }: SectionProps) {
  return (
    <div className={styles.withMark}>
      <SportPicker
        value={form.sport}
        newName={form.newSportName}
        query={form.sportQuery}
        onQueryChange={(sportQuery) => set({ sportQuery })}
        onSelect={(sport) =>
          set({ sport, newSportName: '', confirmNewSport: false, sportQuery: '', extra: {} })
        }
        onCreate={(name) =>
          set({
            sport: null,
            newSportName: capitalize(name.trim()),
            confirmNewSport: true,
            sportQuery: '',
            extra: {},
          })
        }
        onClear={() => set({ sport: null, newSportName: '', confirmNewSport: false, sportQuery: '' })}
        error={errors.sport}
        locked={
          edit ? 'Направление после публикации не меняется: люди записывались именно на него' : undefined
        }
      />
      <Mark marks={marks} field="sport" />
    </div>
  );
}

export function TitleField({ form, set, errors, marks }: SectionProps) {
  const id = useId();
  return (
    <Field
      label="Название"
      htmlFor={id}
      hint="Коротко и по делу: что и где. Например, «Футбол 6×6 у школы № 10»."
      error={errors.title}
      mark={<Mark marks={marks} field="title" />}
    >
      <Input
        id={id}
        size="large"
        value={form.title}
        maxLength={90}
        showCount
        onChange={(e) => set({ title: e.target.value })}
        placeholder="Например, Утренняя пробежка по Татышеву"
        status={errors.title ? 'error' : undefined}
      />
    </Field>
  );
}

export function DescriptionField({ form, set, errors, marks }: SectionProps) {
  const id = useId();
  return (
    <Field
      label="Описание"
      htmlFor={id}
      optional
      hint="Как проходит встреча, кого ждёте, что будет после."
      error={errors.description}
      mark={<Mark marks={marks} field="description" />}
    >
      <Input.TextArea
        id={id}
        value={form.description}
        onChange={(e) => set({ description: e.target.value })}
        autoSize={{ minRows: 3, maxRows: 10 }}
        maxLength={2000}
        placeholder="Бежим спокойно, 5 км по кругу. Ждём всех, кто может пробежать без остановки 20 минут."
      />
    </Field>
  );
}

export function ExtraFields({ form, set, sport }: SectionProps & { sport: SportView | null }) {
  const fields = sport?.fields ?? [];
  if (!fields.length) return null;
  return (
    <div className={styles.grid2}>
      {fields.map((f) => (
        <ExtraField
          key={f.key}
          label={f.label}
          type={f.type}
          options={f.options}
          placeholder={f.placeholder}
          value={form.extra[f.key] ?? ''}
          onChange={(v) => set({ extra: { ...form.extra, [f.key]: v } })}
        />
      ))}
    </div>
  );
}

function ExtraField({
  label,
  type,
  options = [],
  placeholder,
  value,
  onChange,
}: {
  label: string;
  type: 'select' | 'text';
  options?: string[];
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} optional>
      {type === 'select' ? (
        <Select
          id={id}
          size="large"
          value={value || undefined}
          onChange={(v: string | undefined) => onChange(v ?? '')}
          allowClear
          placeholder="Выберите"
          options={options.map((o) => ({ value: o, label: o }))}
        />
      ) : (
        <Input
          id={id}
          size="large"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </Field>
  );
}

// ---------- Когда ----------

function dateOptions(): { value: string; label: string }[] {
  const now = dayjs();
  const opts = [
    { value: now.format('YYYY-MM-DD'), label: 'Сегодня' },
    { value: now.add(1, 'day').format('YYYY-MM-DD'), label: 'Завтра' },
  ];
  for (let i = 2; i < 8 && opts.length < 4; i++) {
    const d = now.add(i, 'day');
    if (d.isoWeekday() >= 6)
      opts.push({ value: d.format('YYYY-MM-DD'), label: capitalize(d.format('dd, D MMMM')) });
  }
  return opts;
}

const TIME_OPTIONS = ['08:00', '10:00', '12:00', '18:00', '19:00', '20:00'].map((t) => ({
  value: t,
  label: t,
}));

const DURATION_OPTIONS = [
  { value: 45, label: '45 минут' },
  { value: 60, label: '1 час' },
  { value: 90, label: '1,5 часа' },
  { value: 120, label: '2 часа' },
  { value: 180, label: '3 часа' },
];

export function DateTimeFields({ form, set, errors, edit, marks }: SectionProps) {
  const dateId = useId();
  const timeId = useId();
  const durationId = useId();
  const untilId = useId();
  const start = startsAtOf(form);
  const meetings = seriesCount(form);
  return (
    <div className={styles.stack}>
      <Field label="Дата" htmlFor={dateId} error={errors.date} mark={<Mark marks={marks} field="when" />}>
        <ChoiceChips
          label="Быстрый выбор даты"
          value={form.date || null}
          options={dateOptions()}
          onChange={(date) => set({ date })}
        />
        <DatePicker
          id={dateId}
          size="large"
          className={styles.picker}
          value={form.date ? calendarDayjs(form.date) : null}
          onChange={(d) => set({ date: d ? d.format('YYYY-MM-DD') : '' })}
          format={formatDateInput}
          placeholder="Другая дата"
          disabledDate={(d) => d.isBefore(dayjs().startOf('day'))}
          status={errors.date ? 'error' : undefined}
          inputReadOnly
        />
      </Field>
      <div className={styles.grid2}>
        <Field
          label="Начало"
          htmlFor={timeId}
          error={errors.time}
          hint={`Местное время встречи: ${formTimeCity(form).name}.`}
        >
          <ChoiceChips
            label="Быстрый выбор времени"
            value={form.time || null}
            options={TIME_OPTIONS}
            onChange={(time) => set({ time })}
          />
          <TimePicker
            id={timeId}
            size="large"
            className={styles.picker}
            value={form.time ? calendarDayjs(`2000-01-01T${form.time}`) : null}
            onChange={(t) => set({ time: t ? t.format('HH:mm') : '' })}
            format="HH:mm"
            minuteStep={5}
            needConfirm={false}
            placeholder="Другое время"
            status={errors.time ? 'error' : undefined}
            inputReadOnly
          />
        </Field>
        <Field label="Длительность" htmlFor={durationId} error={errors.durationMin}>
          <ChoiceChips
            label="Быстрый выбор длительности"
            value={form.durationMin}
            options={DURATION_OPTIONS}
            onChange={(durationMin) => set({ durationMin })}
          />
          <InputNumber
            id={durationId}
            size="large"
            className={styles.number}
            min={15}
            max={720}
            step={15}
            value={form.durationMin}
            onChange={(v) => set({ durationMin: Number(v ?? 0) })}
            suffix="минут"
          />
        </Field>
      </div>
      {!edit && (
        <ToggleRow
          title="Повторять каждую неделю"
          text="Создадим отдельную встречу на каждую неделю. Записываться на них можно по отдельности."
          control={
            <Switch
              checked={form.repeat}
              onChange={(repeat) => set({ repeat })}
              aria-label="Повторять каждую неделю"
            />
          }
        >
          {form.repeat && (
            <Field label="До какой даты" htmlFor={untilId} error={errors.repeatUntil}>
              <DatePicker
                id={untilId}
                size="large"
                className={styles.picker}
                value={form.repeatUntil ? dayjs(form.repeatUntil) : null}
                onChange={(d) => set({ repeatUntil: d ? d.format('YYYY-MM-DD') : '' })}
                format={formatDateInput}
                placeholder="Выберите дату"
                disabledDate={(d) =>
                  d.isBefore(dayjs(form.date || undefined).add(7, 'day'), 'day') ||
                  d.isAfter(dayjs(form.date || undefined).add(MAX_REPEAT_WEEKS, 'week'), 'day')
                }
                status={errors.repeatUntil ? 'error' : undefined}
                inputReadOnly
              />
              {start && form.repeatUntil && !errors.repeatUntil && (
                <p className={styles.note}>
                  Будет {count(meetings, WORDS.meeting)}: {dayjs(start).format('dd')} в {form.time}, с{' '}
                  {dayjs(start).format('D MMMM')} по {dayjs(form.repeatUntil).format('D MMMM')}.
                </p>
              )}
            </Field>
          )}
        </ToggleRow>
      )}
    </div>
  );
}

// ---------- Где ----------

function useFormCity(form: SectionProps['form']) {
  const selectedCity = useSelectedCity();
  return (form.point && CITIES.find((c) => pointInCity(form.point!, c))) || selectedCity;
}

function useCityDistricts(city: ReturnType<typeof useFormCity>) {
  return useList<District>({
    resource: 'districts',
    filters: cityLocationFilters(city, ''),
    pagination: { mode: 'off' },
  });
}

/** Адрес и точка на карте рядом: заполняют друг друга (addressPoint.ts). */
export function AddressMapField({ form, set, errors, marks }: SectionProps) {
  const city = useFormCity(form);
  const addressId = useId();
  const [mapOpen, setMapOpen] = useState(Boolean(form.point));
  const escapeAt = useRef(0);
  const districts = useCityDistricts(city);
  const district = districts.result.data.find((d) => d.id === form.districtId) ?? null;
  const geo = useAddressPoint({
    address: form.address,
    point: form.point,
    cityId: city.id,
    withAddress: true,
    set,
    showMap: () => setMapOpen(true),
  });
  return (
    <div className={styles.mapBlock}>
      <Field
        label="Адрес или место"
        htmlFor={addressId}
        hint={`Город: ${city.name}. Начните вводить, и мы подскажем адрес и поставим точку на карте. Можно наоборот: отметьте точку, адрес подставится сам.`}
        error={errors.address}
        mark={<Mark marks={marks} field="place" />}
      >
        <div className={styles.addressRow}>
          <AutoComplete
            className={styles.addressInput}
            value={form.address}
            options={geo.places.map((p, i) => ({
              key: `${p.label}|${p.detail}|${i}`,
              value: p.label,
              place: p,
              label: (
                <span className={styles.placeOption}>
                  <span>{p.label}</span>
                  {p.detail && <span className={styles.placeDetail}>{p.detail}</span>}
                </span>
              ),
            }))}
            onChange={(value: string) => {
              // Escape в списке подсказок стирает поле целиком: закрываем список, а текст оставляем.
              if (value === '' && Date.now() - escapeAt.current < 300) return;
              geo.type(value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') escapeAt.current = Date.now();
            }}
            onSelect={(_: string, option: { place: GeoPlace }) => geo.choose(option.place)}
            onBlur={() => void geo.settle()}
          >
            <Input
              id={addressId}
              size="large"
              placeholder="Улица, дом или название площадки"
              maxLength={160}
              status={errors.address ? 'error' : undefined}
            />
          </AutoComplete>
          <Button
            variant="secondary"
            size="lg"
            icon={<MapPinLineIcon size={20} aria-hidden />}
            aria-expanded={mapOpen}
            onClick={() => setMapOpen((open) => !open)}
          >
            {mapOpen ? 'Скрыть карту' : 'Точка на карте'}
          </Button>
        </div>
      </Field>
      {geo.status.kind !== 'idle' && (
        <p className={styles.geoStatus} aria-live="polite">
          {geo.status.kind === 'offer' ? (
            <>
              По точке это <strong>{geo.status.label}</strong>.{' '}
              <Button variant="quiet" size="sm" onClick={geo.acceptOffer}>
                Подставить этот адрес
              </Button>
            </>
          ) : (
            geo.status.text
          )}
        </p>
      )}
      {mapOpen && (
        <Suspense fallback={<SkeletonBlock height={280} radius="media" />}>
          <PointPicker
            point={form.point}
            center={form.point ?? district ?? city.center}
            onChange={(point) => void geo.movePoint(point)}
          />
        </Suspense>
      )}
    </div>
  );
}

/** Где встречаемся. `detailsOnly` — без адреса и карты: в быстрой форме они стоят в основном шаге. */
export function PlaceFields(props: SectionProps) {
  const { form, set, detailsOnly } = props;
  const city = useFormCity(form);
  const districtId = useId();
  const findId = useId();
  const districts = useCityDistricts(city);
  return (
    <div className={styles.stack}>
      {/* В4: выбрать площадку со свободными окнами */}
      <VenuePickerField form={form} set={set} />
      {!detailsOnly && <AddressMapField {...props} />}
      <div className={styles.grid2wide}>
        <Field
          label="Как найти на месте"
          htmlFor={findId}
          optional
          hint="Ориентир, вход, во что вы будете одеты."
        >
          <Input.TextArea
            id={findId}
            value={form.howToFind}
            onChange={(e) => set({ howToFind: e.target.value })}
            autoSize={{ minRows: 2, maxRows: 5 }}
            maxLength={200}
            placeholder="У синего забора возле лодочной станции. Я в красной куртке."
          />
        </Field>
        <Field
          label="Район"
          htmlFor={districtId}
          optional
          hint="По району встречу найдут те, кто живёт рядом."
        >
          <Select
            id={districtId}
            size="large"
            value={form.districtId ?? undefined}
            onChange={(v: string | undefined) => set({ districtId: v ?? null })}
            allowClear
            placeholder="Выберите район"
            loading={districts.query.isLoading}
            options={districts.result.data.map((d) => ({ value: d.id, label: d.name }))}
          />
        </Field>
      </div>
      {/* Н1: доступная среда */}
      <AccessExtrasField form={form} set={set} />
    </div>
  );
}

// ---------- Кто и как ----------

export function JoinModeField({ form, set, marks }: SectionProps) {
  return (
    <FieldGroup legend="Как записываться" mark={<Mark marks={marks} field="joinMode" />}>
      <OptionCards
        label="Как записываться"
        columns={2}
        value={form.joinMode}
        onChange={(joinMode) => set({ joinMode })}
        options={[
          {
            value: 'open',
            title: 'Свободная запись',
            text: 'Человек нажимает «Записаться» и сразу оказывается в списке. Решать ничего не нужно.',
          },
          {
            value: 'approval',
            title: 'По заявке',
            text: 'Человек отправляет заявку, вы решаете, кого принять. До вашего ответа он ещё не участник.',
          },
        ]}
      />
    </FieldGroup>
  );
}

export function CapacityFields({ form, set, errors, marks }: SectionProps) {
  const capId = useId();
  const minId = useId();
  return (
    <div className={styles.stack}>
      <ToggleRow
        title={
          <span className={styles.titleMark}>
            Ограничить число мест <Mark marks={marks} field="capacity" />
          </span>
        }
        text="Когда места закончатся, следующие встанут в лист ожидания."
        control={
          <Switch
            checked={form.capacity !== null}
            onChange={(on) => set({ capacity: on ? 12 : null })}
            aria-label="Ограничить число мест"
          />
        }
      >
        {form.capacity !== null && (
          <Field label="Сколько мест" htmlFor={capId} error={errors.capacity}>
            <InputNumber
              id={capId}
              size="large"
              className={styles.number}
              min={2}
              max={500}
              value={form.capacity}
              onChange={(v) => set({ capacity: v === null ? 2 : Number(v) })}
              suffix="мест"
              status={errors.capacity ? 'error' : undefined}
            />
          </Field>
        )}
      </ToggleRow>
      <ToggleRow
        title={
          <span className={styles.titleMark}>
            Встреча состоится, если наберётся… <Mark marks={marks} field="minParticipants" />
          </span>
        }
        text="Участники увидят, сколько людей ещё нужно. Если не наберётся, отмените встречу: всем придёт уведомление."
        control={
          <Switch
            checked={form.minParticipants !== null}
            onChange={(on) => set({ minParticipants: on ? Math.min(4, form.capacity ?? 4) : null })}
            aria-label="Порог сбора"
          />
        }
      >
        {form.minParticipants !== null && (
          <Field label="Сколько человек нужно" htmlFor={minId} error={errors.minParticipants}>
            <InputNumber
              id={minId}
              size="large"
              className={styles.number}
              min={2}
              max={form.capacity ?? 500}
              value={form.minParticipants}
              onChange={(v) => set({ minParticipants: v === null ? 2 : Number(v) })}
              suffix="человек"
              status={errors.minParticipants ? 'error' : undefined}
            />
          </Field>
        )}
      </ToggleRow>
    </div>
  );
}

const LEVEL_ORDER: EventLevel[] = ['any', 'beginner', 'amateur', 'experienced'];

export function LevelFields({ form, set, marks }: SectionProps) {
  const ageId = useId();
  return (
    <div className={styles.stack}>
      <FieldGroup legend="Уровень" mark={<Mark marks={marks} field="level" />}>
        <OptionCards
          label="Уровень"
          columns={2}
          size="sm"
          value={form.level}
          onChange={(level) =>
            set({ level, beginnersWelcome: level === 'experienced' ? false : form.beginnersWelcome })
          }
          options={LEVEL_ORDER.map((l) => ({ value: l, title: EVENT_LEVEL[l], text: EVENT_LEVEL_HINT[l] }))}
        />
      </FieldGroup>
      <ToggleRow
        title="Рады новичкам"
        text="В карточке появится метка, а новички найдут встречу по фильтру."
        control={
          <Switch
            checked={form.beginnersWelcome}
            onChange={(beginnersWelcome) => set({ beginnersWelcome })}
            aria-label="Рады новичкам"
          />
        }
      />
      <Field label="Возраст" htmlFor={ageId} optional>
        <Input
          id={ageId}
          size="large"
          value={form.age}
          onChange={(e) => set({ age: e.target.value })}
          maxLength={80}
          placeholder="Например, с 14 лет, дети со взрослыми"
        />
      </Field>
    </div>
  );
}

export function AccessFields({ form, set }: SectionProps) {
  const privateId = useId();
  return (
    <div className={styles.stack}>
      {publicDiscussion(form) ? (
        <p className={styles.note}>
          Под открытой встречей вопрос может задать любой, кто вошёл, ещё до записи.
        </p>
      ) : (
        <FieldGroup legend="Кто может писать в обсуждении">
          <OptionCards
            label="Кто может писать в обсуждении"
            columns={2}
            size="sm"
            value={form.discussion}
            onChange={(discussion) => set({ discussion })}
            options={[
              {
                value: 'everyone',
                title: 'Все, кто вошёл',
                text: 'Вопрос можно задать до записи. Так проще решиться прийти.',
              },
              {
                value: 'participants',
                title: 'Только участники',
                text: 'Остальные видят обсуждение, но написать не могут.',
              },
            ]}
          />
        </FieldGroup>
      )}
      <Field
        label="Только для участников"
        htmlFor={privateId}
        optional
        hint={
          form.joinMode === 'approval'
            ? 'Телефон, код домофона, номер корта. Увидят те, чью заявку вы примете.'
            : 'Телефон, код домофона, номер корта. Увидят только записавшиеся.'
        }
      >
        <Input.TextArea
          id={privateId}
          value={form.privateInfo}
          onChange={(e) => set({ privateInfo: e.target.value })}
          autoSize={{ minRows: 2, maxRows: 5 }}
          maxLength={500}
          placeholder="Мой телефон +7 900 000-00-00, пишите, если опаздываете"
        />
      </Field>
    </div>
  );
}

// ---------- Первый шаг ----------

const INTENSITY_ORDER: Intensity[] = ['low', 'medium', 'high'];

export function FirstStepFields({ form, set, errors, marks }: SectionProps) {
  const bringId = useId();
  const noteId = useId();
  const prepId = useId();
  const toggleAmenity = (a: string) =>
    set({
      amenities: form.amenities.includes(a) ? form.amenities.filter((x) => x !== a) : [...form.amenities, a],
    });
  return (
    <div className={styles.stack}>
      <Field
        label="Что взять с собой"
        htmlFor={bringId}
        optional
        mark={<Mark marks={marks} field="firstStep" />}
      >
        <Input
          id={bringId}
          size="large"
          value={form.bring}
          onChange={(e) => set({ bring: e.target.value })}
          maxLength={200}
          placeholder="Удобную обувь и воду"
        />
      </Field>
      {/* В3: что нужно для игры */}
      <GearFields value={form.gear} onChange={(gear) => set({ gear })} error={errors.gear} />
      <FieldGroup legend="Нагрузка">
        <OptionCards
          label="Нагрузка"
          columns={3}
          size="sm"
          value={form.intensity}
          onChange={(intensity) => set({ intensity })}
          options={INTENSITY_ORDER.map((i) => ({
            value: i,
            title: INTENSITY[i].label,
            text: INTENSITY[i].hint,
          }))}
        />
      </FieldGroup>
      <FieldGroup legend="Что есть на месте" optional>
        <div className={styles.chips}>
          {AMENITY_OPTIONS.map((a) => (
            <Chip key={a} selected={form.amenities.includes(a)} onClick={() => toggleAmenity(a)}>
              {a}
            </Chip>
          ))}
        </div>
      </FieldGroup>
      <Field label="Подготовка" htmlFor={prepId} optional>
        <Input
          id={prepId}
          size="large"
          value={form.preparation}
          onChange={(e) => set({ preparation: e.target.value })}
          maxLength={200}
          placeholder="Например, пробегать 3 км без остановки"
        />
      </Field>
      <Field
        label="Что сказать тому, кто придёт впервые"
        htmlFor={noteId}
        optional
        hint="Пара слов снимает неловкость первого прихода."
      >
        <Input.TextArea
          id={noteId}
          value={form.firstTimeNote}
          onChange={(e) => set({ firstTimeNote: e.target.value })}
          autoSize={{ minRows: 2, maxRows: 5 }}
          maxLength={300}
          placeholder="Подойдите ко мне перед началом, познакомлю со всеми"
        />
      </Field>
    </div>
  );
}

// ---------- Деньги ----------

function SplitCalc({ form }: { form: EventForm }) {
  const total = Number(form.priceTotal ?? 0);
  if (!(total > 0)) return null;
  const lines: string[] = [];
  if (form.capacity)
    lines.push(
      `≈ ${formatRub(Math.ceil(total / form.capacity))} с человека, если придут все ${form.capacity}`,
    );
  if (form.minParticipants)
    lines.push(
      `Не больше ${formatRub(Math.ceil(total / form.minParticipants))} с человека при пороге ${form.minParticipants}`,
    );
  if (!form.capacity && !form.minParticipants)
    lines.push(
      `≈ ${formatRub(Math.ceil(total / 10))} с человека, если придут 10. Доля пересчитывается по числу участников`,
    );
  return (
    <div className={styles.calc} aria-live="polite">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}

const HOURS_OPTIONS = [2, 3, 6, 12, 24].map((h) => ({ value: h, label: `За ${count(h, WORDS.hour)}` }));
const EVE_OPTIONS = ['18:00', '20:00', '21:00', '22:00'].map((t) => ({ value: t, label: `До ${t}` }));

export function PriceFields({ form, set, errors, marks, edit }: SectionProps) {
  const amountId = useId();
  const totalId = useId();
  const noteId = useId();
  const payId = useId();
  const start = startsAtOf(form);
  return (
    <div className={styles.stack}>
      <FieldGroup legend="Стоимость" error={errors.price} mark={<Mark marks={marks} field="price" />}>
        <OptionCards
          label="Стоимость"
          columns={3}
          size="sm"
          value={form.priceKind}
          onChange={(priceKind) => set({ priceKind })}
          options={[
            { value: 'free', title: 'Бесплатно', text: 'Платить ничего не нужно' },
            { value: 'fixed', title: 'Фиксированная цена', text: 'Каждый платит одну сумму' },
            { value: 'split', title: 'Скидываемся', text: 'Общую сумму делим на всех пришедших' },
          ]}
        />
      </FieldGroup>
      {form.priceKind === 'fixed' && (
        <Field label="Цена с человека" htmlFor={amountId}>
          <InputNumber
            id={amountId}
            size="large"
            className={styles.number}
            min={1}
            max={100000}
            value={form.priceAmount}
            onChange={(v) => set({ priceAmount: v === null ? null : Number(v) })}
            suffix="₽"
            status={errors.price ? 'error' : undefined}
          />
        </Field>
      )}
      {form.priceKind === 'split' && (
        <div className={styles.grid2}>
          <Field label="Общая сумма" htmlFor={totalId}>
            <InputNumber
              id={totalId}
              size="large"
              className={styles.number}
              min={1}
              max={1000000}
              step={100}
              value={form.priceTotal}
              onChange={(v) => set({ priceTotal: v === null ? null : Number(v) })}
              suffix="₽"
              status={errors.price ? 'error' : undefined}
            />
          </Field>
          <Field label="На что" htmlFor={noteId} optional>
            <Input
              id={noteId}
              size="large"
              value={form.priceNote}
              onChange={(e) => set({ priceNote: e.target.value })}
              maxLength={60}
              placeholder="на аренду зала"
            />
          </Field>
          <div className={styles.full}>
            <SplitCalc form={form} />
          </div>
        </div>
      )}
      <PaymentModeField form={form} set={set} errors={errors} edit={edit} />
      {form.priceKind !== 'free' && form.paymentMode !== 'online' && (
        <Field
          label="Что написать участникам об оплате"
          htmlFor={payId}
          optional
          hint="Например, кому и как перевести деньги."
        >
          <Input
            id={payId}
            size="large"
            value={form.paymentNote}
            onChange={(e) => set({ paymentNote: e.target.value })}
            maxLength={120}
            placeholder="Наличными или переводом на месте"
          />
        </Field>
      )}
      <FieldGroup
        legend="До какого времени можно отменить запись"
        hint="Участник увидит это правило до записи."
      >
        <OptionCards
          label="Правило отмены"
          columns={3}
          size="sm"
          value={form.cancelKind}
          onChange={(cancelKind) => set({ cancelKind })}
          options={[
            { value: 'anytime', title: 'В любой момент', text: 'Отменить можно хоть перед началом' },
            {
              value: 'hoursBefore',
              title: 'За несколько часов',
              text: 'Позже отменять не принято',
            },
            { value: 'eveBefore', title: 'До вечера накануне', text: 'Удобно, если бронируете зал' },
          ]}
        />
        {form.cancelKind === 'hoursBefore' && (
          <ChoiceChips
            label="За сколько часов"
            value={form.cancelHours}
            options={HOURS_OPTIONS}
            onChange={(cancelHours) => set({ cancelHours })}
          />
        )}
        {form.cancelKind === 'eveBefore' && (
          <ChoiceChips
            label="До какого времени накануне"
            value={form.cancelTime}
            options={EVE_OPTIONS}
            onChange={(cancelTime) => set({ cancelTime })}
          />
        )}
        {start && <p className={styles.note}>{cancelPolicyText(cancelPolicyOf(form), start)}.</p>}
      </FieldGroup>
    </div>
  );
}

export function StepIntro({ children }: { children: ReactNode }) {
  return <p className={styles.intro}>{children}</p>;
}
