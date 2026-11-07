import { useCreate, useList, useUpdate, type HttpError } from '@refinedev/core';
import { Input, InputNumber, Modal, Select } from 'antd';
import { useId, useState } from 'react';

import { Button, Chip } from '@/components';
import { errorMessage } from '@/lib/api';
import type { SportView } from '@/types/api';
import { districtsOf } from '@/lib/cities';
import { choosable, WITH_HIDDEN } from '@/lib/sportChoices';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { District } from '@/types/domain';
import type {
  GearKind,
  InventoryMe,
  ShelfCondition,
  ShelfItemInput,
  ShelfItemView,
  ShelfTerm,
} from '@/types/inventory';
import { Field, FieldGroup, OptionCards } from '@/pages/events/create/fields';
import { formatRub } from '@/lib/money';
import { DEFAULT_PAYMENT_SETTINGS, quote } from '@/lib/payments';
import { count, WORDS } from '@/lib/plural';

import styles from './inventory.module.css';
import { CONDITION, GEAR_KIND, GEAR_KIND_ORDER, TERM } from './labels';

const TERM_ORDER: ShelfTerm[] = ['return_after', 'no_deposit', 'pickup', 'bring_to_place', 'kids_only'];
const CONDITION_ORDER: ShelfCondition[] = ['new', 'good', 'used'];
const SALE_TERMS: ShelfTerm[] = ['pickup', 'bring_to_place'];
const MIN_PRICE = 50;
const MAX_PRICE = 300_000;

/** Поделиться вещью или изменить её. `item` — правка, `null` при `open` — новая вещь. */
export function ShelfItemDialog({
  open,
  item,
  me,
  defaultOrgId,
  onClose,
}: {
  open: boolean;
  item: ShelfItemView | null;
  me: InventoryMe | null;
  defaultOrgId?: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={item ? 'Изменить вещь' : 'Поделиться вещью'}
      footer={null}
      destroyOnHidden
      width={640}
    >
      {open && <ItemForm item={item} me={me} defaultOrgId={defaultOrgId ?? null} onClose={onClose} />}
    </Modal>
  );
}

interface FormState {
  orgId: string | null;
  name: string;
  kind: GearKind | null;
  sportId: string | null;
  quantity: number;
  condition: ShelfCondition;
  districtId: string | null;
  terms: ShelfTerm[];
  note: string;
  /** Даю на время или продаю. */
  mode: 'lend' | 'sell';
  price: number | null;
}

function ItemForm({
  item,
  me,
  defaultOrgId,
  onClose,
}: {
  item: ShelfItemView | null;
  me: InventoryMe | null;
  defaultOrgId: string | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    item
      ? {
          orgId: item.owner.kind === 'org' ? item.owner.id : null,
          name: item.name,
          kind: item.kind,
          sportId: item.sportId,
          quantity: item.quantity,
          condition: item.condition,
          districtId: item.districtId,
          terms: item.terms,
          note: item.note,
          mode: item.sale ? 'sell' : 'lend',
          price: item.sale?.price ?? null,
        }
      : {
          orgId: defaultOrgId,
          name: '',
          kind: null,
          sportId: null,
          quantity: 1,
          condition: 'good',
          districtId: null,
          terms: ['return_after', 'no_deposit'],
          note: '',
          mode: 'lend',
          price: null,
        },
  );
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: create, mutation: createState } = useCreate<
    ShelfItemView,
    HttpError,
    ShelfItemInput
  >();
  const { mutateAsync: update, mutation: updateState } = useUpdate<
    ShelfItemView,
    HttpError,
    Partial<ShelfItemInput>
  >();
  const { result: sports } = useList<SportView>({
    resource: 'sports',
    filters: WITH_HIDDEN,
    pagination: { mode: 'off' },
  });
  const { result: districts } = useList<District>({ resource: 'districts', pagination: { mode: 'off' } });
  const city = useSelectedCity();
  const ids = {
    as: useId(),
    name: useId(),
    kind: useId(),
    sport: useId(),
    qty: useId(),
    district: useId(),
    note: useId(),
    price: useId(),
  };
  const selling = form.mode === 'sell';
  const termOrder = selling ? SALE_TERMS : TERM_ORDER;
  const shareAs = me?.shareAs ?? [];

  const toggleTerm = (t: ShelfTerm) =>
    set({ terms: form.terms.includes(t) ? form.terms.filter((x) => x !== t) : [...form.terms, t] });

  const submit = async () => {
    setError(null);
    const local: Record<string, string> = {};
    if (form.name.trim().length < 2) local.name = 'Напишите, что даёте: например, «Волейбольный мяч»';
    if (!(form.quantity >= 1)) local.quantity = 'Укажите количество от 1 до 99';
    if (selling && !(Number(form.price) >= MIN_PRICE && Number(form.price) <= MAX_PRICE))
      local.sale = `Укажите цену от ${formatRub(MIN_PRICE)} до ${formatRub(MAX_PRICE)}`;
    setErrors(local);
    if (Object.keys(local).length) return;
    const values: ShelfItemInput = {
      name: form.name.trim(),
      kind: form.kind ?? undefined,
      sportId: form.sportId,
      quantity: form.quantity,
      condition: form.condition,
      districtId: form.districtId,
      terms: selling ? form.terms.filter((t) => SALE_TERMS.includes(t)) : form.terms,
      note: form.note.trim(),
      sale: selling ? { price: Number(form.price) } : null,
    };
    try {
      if (item) {
        await update({
          resource: 'shelf',
          id: item.id,
          values,
          successNotification: { type: 'success', message: 'Изменения сохранены' },
          errorNotification: false,
        });
      } else {
        await create({
          resource: 'shelf',
          values: { ...values, orgId: form.orgId },
          successNotification: {
            type: 'success',
            message: selling
              ? 'Вещь выставлена на продажу. Когда её купят, придёт уведомление'
              : 'Вещь на полке. Её видят все, кто ищет инвентарь',
          },
          errorNotification: false,
        });
      }
      onClose();
    } catch (e) {
      const fields = (e as { errors?: Record<string, string> }).errors;
      if (fields) setErrors(fields);
      setError(errorMessage(e, 'Не получилось сохранить. Попробуйте ещё раз'));
    }
  };

  return (
    <div className={styles.dialog}>
      {!item && shareAs.length > 0 && (
        <Field label="От чьего имени" htmlFor={ids.as}>
          <Select
            id={ids.as}
            size="large"
            value={form.orgId ?? ''}
            onChange={(v) => set({ orgId: v || null })}
            options={[
              { value: '', label: 'От себя' },
              ...shareAs.map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        </Field>
      )}
      <FieldGroup legend="Как отдаёте">
        <OptionCards
          label="Как отдаёте"
          columns={2}
          size="sm"
          value={form.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'lend', title: 'Даю на время', text: 'Бесплатно, на игру или тренировку' },
            { value: 'sell', title: 'Продаю', text: 'Покупатель платит на сайте, деньги придут вам' },
          ]}
        />
      </FieldGroup>
      {selling && (
        <Field label="Цена за штуку" htmlFor={ids.price} error={errors.sale}>
          <InputNumber
            id={ids.price}
            size="large"
            className={styles.priceInput}
            min={MIN_PRICE}
            max={MAX_PRICE}
            precision={0}
            step={100}
            suffix="₽"
            value={form.price}
            onChange={(v) => set({ price: v === null ? null : Number(v) })}
            status={errors.sale ? 'error' : undefined}
          />
          <SaleExplain price={Number(form.price) || 0} />
        </Field>
      )}
      <Field label={selling ? 'Что продаёте' : 'Что даёте'} htmlFor={ids.name} error={errors.name}>
        <Input
          id={ids.name}
          size="large"
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          maxLength={60}
          placeholder="Волейбольный мяч"
        />
      </Field>
      <div className={styles.formRow}>
        <Field label="Тип вещи" htmlFor={ids.kind} hint="Если не выбрать, определим по названию">
          <Select
            id={ids.kind}
            size="large"
            allowClear
            placeholder="По названию"
            value={form.kind ?? undefined}
            onChange={(v) => set({ kind: (v as GearKind | undefined) ?? null })}
            options={GEAR_KIND_ORDER.map((k) => ({ value: k, label: GEAR_KIND[k].label }))}
          />
        </Field>
        <Field label="Сколько штук" htmlFor={ids.qty} error={errors.quantity}>
          <InputNumber
            id={ids.qty}
            size="large"
            min={1}
            max={99}
            precision={0}
            value={form.quantity}
            onChange={(v) => set({ quantity: Number(v) || 0 })}
          />
        </Field>
      </div>
      <div className={styles.formRow}>
        <Field label="Для какого спорта" htmlFor={ids.sport} optional error={errors.sportId}>
          <Select
            id={ids.sport}
            size="large"
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Подойдёт для любого"
            value={form.sportId ?? undefined}
            onChange={(v) => set({ sportId: (v as string | undefined) ?? null })}
            options={choosable(sports.data ?? [], [form.sportId]).map((s) => ({ value: s.id, label: s.name }))}
          />
        </Field>
        <Field
          label="Район"
          htmlFor={ids.district}
          optional
          error={errors.districtId}
          hint="Без района возьмём ваш"
        >
          <Select
            id={ids.district}
            size="large"
            allowClear
            placeholder="Ваш район"
            value={form.districtId ?? undefined}
            onChange={(v) => set({ districtId: (v as string | undefined) ?? null })}
            options={districtsOf(districts.data ?? [], city, form.districtId).map((d) => ({
              value: d.id,
              label: d.name,
            }))}
          />
        </Field>
      </div>
      <FieldGroup legend="Состояние">
        <div className={styles.chips}>
          {CONDITION_ORDER.map((c) => (
            <Chip key={c} selected={form.condition === c} onClick={() => set({ condition: c })}>
              {CONDITION[c]}
            </Chip>
          ))}
        </div>
      </FieldGroup>
      <FieldGroup legend="Условия" optional error={errors.terms}>
        <div className={styles.chips}>
          {termOrder.map((t) => (
            <Chip key={t} selected={form.terms.includes(t)} onClick={() => toggleTerm(t)}>
              {TERM[t]}
            </Chip>
          ))}
        </div>
      </FieldGroup>
      <Field label="Что ещё важно знать" htmlFor={ids.note} optional>
        <Input.TextArea
          id={ids.note}
          value={form.note}
          onChange={(e) => set({ note: e.target.value })}
          autoSize={{ minRows: 2, maxRows: 4 }}
          maxLength={300}
          placeholder="Забрать можно по будням после 18:00"
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
          loading={createState.isPending || updateState.isPending}
          loadingText="Сохраняем…"
          onClick={submit}
        >
          {item ? 'Сохранить' : selling ? 'Выставить на продажу' : 'Выложить на полку'}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

/** Сколько заплатит покупатель и сколько получит продавец: та же формула, что на сервере. */
function SaleExplain({ price }: { price: number }) {
  if (!(price >= MIN_PRICE)) {
    return (
      <p className={styles.saleNote}>Покупатель заплатит цену и сбор сервиса. Вы получите цену полностью.</p>
    );
  }
  const s = DEFAULT_PAYMENT_SETTINGS;
  const sbp = quote(price, 'sbp', s, s.goodsMarkup);
  const card = quote(price, 'bank_card', s, s.goodsMarkup);
  return (
    <div className={styles.saleNote} aria-live="polite">
      <p>
        Покупатель заплатит ≈ {formatRub(sbp.total)} по СБП или ≈ {formatRub(card.total)} картой: цену и сбор
        сервиса.
      </p>
      <p>
        <b>Вам придёт {formatRub(price)} за штуку</b>, когда покупатель заберёт вещь и нажмёт «Получил». Если
        он забудет, деньги придут через {count(s.autoCompleteDays, WORDS.day)} после оплаты.
      </p>
    </div>
  );
}
