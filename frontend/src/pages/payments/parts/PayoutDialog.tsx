import { Input, InputNumber, Select } from 'antd';
import { useId, useState } from 'react';

import { Button } from '@/components';
import { errorMessage, useAction } from '@/lib/api';
import { formatRub } from '@/lib/money';
import { normalizeSbpPhone, PAYMENTS_API } from '@/lib/payments';
import { Field } from '@/pages/events/create/fields';
import type { BalanceView, PayoutView } from '@/types/payments';

import { PaySheet } from './PaySheet';
import styles from './money.module.css';
import { listOf, useSbpBanks } from './usePayments';

/** Вывести деньги по СБП: сумма, телефон и банк. */
export function PayoutDialog({
  balance,
  open,
  onClose,
}: {
  balance: BalanceView;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <PaySheet open={open} onClose={onClose} title="Вывести по СБП">
      {open && <PayoutForm balance={balance} onClose={onClose} />}
    </PaySheet>
  );
}

function PayoutForm({ balance: b, onClose }: { balance: BalanceView; onClose: () => void }) {
  const { data: bankData, isLoading: banksLoading } = useSbpBanks();
  const banks = listOf(bankData);
  const { run, isPending } = useAction<PayoutView>();
  const [amount, setAmount] = useState<number | null>(b.available);
  const [phone, setPhone] = useState('');
  const [bankId, setBankId] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const ids = { amount: useId(), phone: useId(), bank: useId() };

  const submit = async () => {
    setError(null);
    const local: Record<string, string> = {};
    const normalized = normalizeSbpPhone(phone);
    if (!normalized) local.phone = 'Введите номер, привязанный к СБП, например +7 912 345-67-89';
    if (!bankId) local.bankId = 'Выберите банк, в который придут деньги';
    if (!amount || amount < b.minPayout) local.amount = `Вывести можно от ${formatRub(b.minPayout)}`;
    else if (amount > b.available) local.amount = `Доступно ${formatRub(b.available)}`;
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      await run(
        PAYMENTS_API.payouts,
        { owner: b.owner.key, amount, phone: normalized, bankId },
        {
          silent: true,
          success:
            b.payoutMode === 'auto'
              ? 'Выплата отправлена. Придёт уведомление, когда деньги дойдут'
              : 'Заявка на вывод принята. Придёт уведомление, когда деньги переведут',
        },
      );
      onClose();
    } catch (e) {
      const fields = (e as { errors?: Record<string, string> }).errors;
      if (fields) setErrors(fields);
      setError(errorMessage(e, 'Не получилось отправить заявку. Попробуйте ещё раз'));
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit();
      }}
      noValidate
    >
      <p className={styles.formLead}>
        Доступно к выводу: <b>{formatRub(b.available)}</b>
        {b.owner.kind === 'org' && `, баланс «${b.owner.name}»`}
      </p>
      <Field
        label="Сколько вывести"
        htmlFor={ids.amount}
        error={errors.amount}
        hint={`От ${formatRub(b.minPayout)}`}
      >
        <InputNumber
          id={ids.amount}
          size="large"
          className={styles.amount}
          min={b.minPayout}
          max={b.available}
          precision={0}
          suffix="₽"
          value={amount}
          onChange={(v) => setAmount(v === null ? null : Number(v))}
          status={errors.amount ? 'error' : undefined}
        />
      </Field>
      <Field
        label="Телефон, привязанный к СБП"
        htmlFor={ids.phone}
        error={errors.phone}
        hint="На этот номер в выбранном банке придут деньги."
      >
        <Input
          id={ids.phone}
          size="large"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+7 912 345-67-89"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          status={errors.phone ? 'error' : undefined}
        />
      </Field>
      <Field label="Банк" htmlFor={ids.bank} error={errors.bankId}>
        <Select
          id={ids.bank}
          size="large"
          showSearch
          optionFilterProp="label"
          placeholder="Выберите банк"
          loading={banksLoading}
          value={bankId}
          onChange={setBankId}
          options={banks.map((x) => ({ value: x.id, label: x.name }))}
          status={errors.bankId ? 'error' : undefined}
          notFoundContent="Такого банка нет в списке"
        />
      </Field>
      <p className={styles.formNote}>
        {b.payoutMode === 'auto'
          ? 'Деньги уйдут по СБП сразу после заявки. Комиссию за перевод вы не платите.'
          : 'Администратор переведёт деньги по СБП и отметит перевод. Придёт уведомление. Комиссию за перевод вы не платите.'}
      </p>
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" size="lg" block loading={isPending} loadingText="Отправляем…">
          Вывести {amount ? formatRub(amount) : ''}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
