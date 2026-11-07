import { CaretDownIcon, InfoIcon } from '@phosphor-icons/react';
import { Checkbox, InputNumber } from 'antd';
import { useId, useState } from 'react';

import { Button, ErrorState, Section, SkeletonBlock } from '@/components';
import { errorMessage, useAction, useLiveGet } from '@/lib/api';
import { formatRub } from '@/lib/money';
import { formatMoney, PAY_METHOD_LABEL, PAYMENTS_API, paymentSettings, quote } from '@/lib/payments';
import { Field } from '@/pages/events/create/fields';
import type { PaymentSettings, PayMethod } from '@/types/payments';

import styles from './payments.module.css';

const METHODS: PayMethod[] = ['sbp', 'bank_card'];

/** Доли храним как 0.038, в форме показываем проценты: 3,8. */
const toPercent = (rate: number) => Math.round(rate * 10_000) / 100;
const fromPercent = (value: number | null) => (value === null ? 0 : Math.round(value * 100) / 10_000);

export function SettingsTab() {
  const { data, isLoading, isError, refetch } = useLiveGet<PaymentSettings>(PAYMENTS_API.admin.settings, [
    'payments',
    'admin',
  ]);
  if (isError) return <ErrorState title="Не удалось загрузить ставки" onRetry={() => void refetch()} />;
  if (isLoading || !data) {
    return (
      <div className={styles.stack} role="status" aria-live="polite">
        <span className="sr-only">Загружаем ставки…</span>
        <SkeletonBlock height={320} />
      </div>
    );
  }
  return <SettingsForm key={JSON.stringify(data)} saved={paymentSettings(data)} />;
}

function SettingsForm({ saved }: { saved: PaymentSettings }) {
  const [s, setS] = useState<PaymentSettings>(saved);
  const [example, setExample] = useState<number | null>(300);
  const [itemExample, setItemExample] = useState<number | null>(1000);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useAction<PaymentSettings>();
  const ids = {
    sbp: useId(),
    card: useId(),
    pp: useId(),
    pf: useId(),
    markup: useId(),
    ex: useId(),
    exItem: useId(),
    hold: useId(),
    approval: useId(),
    open: useId(),
    collect: useId(),
    auto: useId(),
    min: useId(),
  };
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const set = (patch: Partial<PaymentSettings>) => setS((prev) => ({ ...prev, ...patch }));
  const setRate = (m: PayMethod, v: number | null) => set({ rates: { ...s.rates, [m]: fromPercent(v) } });
  const toggleMethod = (m: PayMethod, on: boolean) =>
    set({
      methods: on
        ? METHODS.filter((x) => x === m || s.methods.includes(x))
        : s.methods.filter((x) => x !== m),
    });

  const save = async () => {
    setError(null);
    const local: Record<string, string> = {};
    if (!s.methods.length) local.methods = 'Оставьте хотя бы один способ оплаты';
    for (const m of METHODS)
      if (!(s.rates[m] >= 0 && s.rates[m] < 0.2)) local[`rates.${m}`] = 'Ставка от 0 до 20%';
    if (!(s.goodsMarkup >= 0 && s.goodsMarkup <= 0.3)) local.goodsMarkup = 'Наценка от 0 до 30%';
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      await run(
        PAYMENTS_API.admin.settings,
        { ...s },
        { method: 'put', silent: true, success: 'Ставки сохранены' },
      );
    } catch (e) {
      const fields = (e as { errors?: Record<string, string> }).errors;
      if (fields) setErrors(fields);
      setError(errorMessage(e, 'Не получилось сохранить ставки'));
    }
  };

  const base = Number(example) || 0;
  const itemBase = Number(itemExample) || 0;

  return (
    <form
      className={styles.stack}
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
      noValidate
    >
      <p className={styles.tip}>
        <InfoIcon size={22} aria-hidden />
        <span>
          Впишите ставки из договора с ЮKassa. Сбор сервиса считается так, чтобы после комиссии банка
          организатор и продавец получили свою сумму полностью. Новые ставки действуют для новых платежей.
        </span>
      </p>

      <div className={styles.settingsGrid}>
        <Section title="Комиссия ЮKassa за приём">
          <div className={styles.fields}>
            {METHODS.map((m) => (
              <div key={m} className={styles.methodRow}>
                <Checkbox checked={s.methods.includes(m)} onChange={(e) => toggleMethod(m, e.target.checked)}>
                  Принимать: {PAY_METHOD_LABEL[m]}
                </Checkbox>
                <Field
                  label={`Ставка, ${PAY_METHOD_LABEL[m]}`}
                  htmlFor={m === 'sbp' ? ids.sbp : ids.card}
                  error={errors[`rates.${m}`]}
                  hint={
                    m === 'bank_card'
                      ? 'По открытому тарифу 2,8% и ещё 1% за чеки от ЮKassa'
                      : 'Обычно не больше 0,7%'
                  }
                >
                  <InputNumber
                    id={m === 'sbp' ? ids.sbp : ids.card}
                    size="large"
                    className={styles.num}
                    min={0}
                    max={19.99}
                    step={0.1}
                    precision={2}
                    decimalSeparator=","
                    suffix="%"
                    value={toPercent(s.rates[m])}
                    onChange={(v) => setRate(m, v)}
                  />
                </Field>
              </div>
            ))}
            {errors.methods && (
              <p className={styles.formError} role="alert">
                {errors.methods}
              </p>
            )}
          </div>
        </Section>

        <Section title="Выплаты и наценка">
          <div className={styles.fields}>
            <Field
              label="Выплата получателю, процент"
              htmlFor={ids.pp}
              hint="Тариф «Выплат» ЮKassa, если подключены"
            >
              <InputNumber
                id={ids.pp}
                size="large"
                className={styles.num}
                min={0}
                max={10}
                step={0.1}
                precision={2}
                decimalSeparator=","
                suffix="%"
                value={toPercent(s.payoutPercent)}
                onChange={(v) => set({ payoutPercent: fromPercent(v) })}
              />
            </Field>
            <Field label="Выплата получателю, рублей с платежа" htmlFor={ids.pf}>
              <InputNumber
                id={ids.pf}
                size="large"
                className={styles.num}
                min={0}
                max={500}
                precision={2}
                decimalSeparator=","
                suffix="₽"
                value={s.payoutFixed}
                onChange={(v) => set({ payoutFixed: Number(v) || 0 })}
              />
            </Field>
            <Field
              label="Наценка сервиса на вещи"
              htmlFor={ids.markup}
              error={errors.goodsMarkup}
              hint="С продажи вещей на полке. У встреч наценки нет"
            >
              <InputNumber
                id={ids.markup}
                size="large"
                className={styles.num}
                min={0}
                max={30}
                step={0.5}
                precision={2}
                decimalSeparator=","
                suffix="%"
                value={toPercent(s.goodsMarkup)}
                onChange={(v) => set({ goodsMarkup: fromPercent(v) })}
              />
            </Field>
          </div>
        </Section>
      </div>

      <Section title="Как посчитается">
        <div className={styles.examples}>
          <div className={styles.example}>
            <Field label="Доля во встрече" htmlFor={ids.ex}>
              <InputNumber
                id={ids.ex}
                size="large"
                className={styles.num}
                min={1}
                max={100_000}
                precision={0}
                suffix="₽"
                value={example}
                onChange={(v) => setExample(v === null ? null : Number(v))}
              />
            </Field>
            <ExampleLines base={base} settings={s} markup={0} />
          </div>
          <div className={styles.example}>
            <Field label="Вещь с полки" htmlFor={ids.exItem}>
              <InputNumber
                id={ids.exItem}
                size="large"
                className={styles.num}
                min={1}
                max={300_000}
                precision={0}
                suffix="₽"
                value={itemExample}
                onChange={(v) => setItemExample(v === null ? null : Number(v))}
              />
            </Field>
            <ExampleLines base={itemBase} settings={s} markup={s.goodsMarkup} />
          </div>
        </div>
      </Section>

      <details className={styles.more}>
        <summary>
          <CaretDownIcon size={18} weight="bold" aria-hidden className={styles.caret} />
          Сроки оплаты
        </summary>
        <div className={styles.timings}>
          <Timing
            id={ids.hold}
            label="Держим место после записи"
            unit="минут"
            value={s.holdMinutes}
            min={5}
            max={120}
            onChange={(holdMinutes) => set({ holdMinutes })}
          />
          <Timing
            id={ids.approval}
            label="На оплату после одобрения заявки"
            unit="часов"
            value={s.approvalHours}
            min={1}
            max={72}
            onChange={(approvalHours) => set({ approvalHours })}
          />
          <Timing
            id={ids.open}
            label="Оплата складчины открывается за"
            unit="дней"
            value={s.splitOpenDays}
            min={1}
            max={7}
            hint="Не больше 7 дней: столько живёт заморозка на карте"
            onChange={(splitOpenDays) => set({ splitOpenDays })}
          />
          <Timing
            id={ids.collect}
            label="Собираем складчину до начала за"
            unit="часов"
            value={s.collectHoursBefore}
            min={1}
            max={48}
            onChange={(collectHoursBefore) => set({ collectHoursBefore })}
          />
          <Timing
            id={ids.auto}
            label="Деньги за вещь уходят продавцу через"
            unit="дней"
            value={s.autoCompleteDays}
            min={1}
            max={14}
            hint="Если покупатель не нажал «Получил»"
            onChange={(autoCompleteDays) => set({ autoCompleteDays })}
          />
          <Timing
            id={ids.min}
            label="Наименьший вывод"
            unit="₽"
            value={s.minPayout}
            min={1}
            max={10_000}
            onChange={(minPayout) => set({ minPayout })}
          />
        </div>
      </details>

      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.saveBar}>
        <Button
          type="submit"
          variant="primary"
          loading={isPending}
          loadingText="Сохраняем…"
          disabled={!dirty}
        >
          Сохранить ставки
        </Button>
        {dirty && (
          <Button variant="quiet" onClick={() => setS(saved)}>
            Вернуть как было
          </Button>
        )}
        {!dirty && <span className={styles.muted}>Изменений нет</span>}
      </div>
    </form>
  );
}

function ExampleLines({
  base,
  settings,
  markup,
}: {
  base: number;
  settings: PaymentSettings;
  markup: number;
}) {
  if (!(base > 0)) return <p className={styles.muted}>Введите сумму, чтобы увидеть расчёт.</p>;
  return (
    <ul className={styles.exampleList} aria-live="polite">
      {METHODS.filter((m) => settings.methods.includes(m)).map((m) => {
        const q = quote(base, m, settings, markup);
        return (
          <li key={m}>
            <span className={styles.exampleMain}>
              {formatRub(base)} → <b>{formatRub(q.total)}</b>{' '}
              {PAY_METHOD_LABEL[m] === 'СБП' ? 'по СБП' : 'картой'}
            </span>
            <span className={styles.muted}>
              сбор {formatRub(q.fee)}: банку {formatMoney(q.feeParts.bank)}
              {q.feeParts.payout > 0 && `, выплата ${formatMoney(q.feeParts.payout)}`}
              {q.feeParts.platform > 0 && `, сервису ${formatMoney(q.feeParts.platform)}`}
              {q.feeParts.reserve > 0 && `, резерв ${formatMoney(q.feeParts.reserve)}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Timing({
  id,
  label,
  unit,
  value,
  min,
  max,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <InputNumber
        id={id}
        size="large"
        className={styles.num}
        min={min}
        max={max}
        precision={0}
        suffix={unit}
        value={value}
        onChange={(v) => onChange(Number(v) || min)}
      />
    </Field>
  );
}
