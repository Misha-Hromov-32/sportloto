import { CreditCardIcon, HandCoinsIcon } from '@phosphor-icons/react';
import { InputNumber } from 'antd';
import { useEffect, useId } from 'react';

import { formatRub } from '@/lib/money';
import { DEFAULT_PAYMENT_SETTINGS, quote, splitMaxShare } from '@/lib/payments';
import { usePaymentAvailability } from '@/lib/payments';
import { count, WORDS } from '@/lib/plural';

import { FieldError, FieldGroup, OptionCards } from './fields';
import type { EventForm, FormErrors } from './model';
import styles from './sections.module.css';

interface PaymentModeFieldProps {
  form: EventForm;
  set: (patch: Partial<EventForm>) => void;
  errors: FormErrors;
  edit?: boolean;
}

const S = DEFAULT_PAYMENT_SETTINGS;

/** «Как платят»: на месте или на сайте. При оплате на сайте объясняем организатору, как идут деньги. */
export function PaymentModeField({ form, set, errors, edit }: PaymentModeFieldProps) {
  const availability = usePaymentAvailability();
  useEffect(() => {
    if (availability.data?.enabled === false && form.paymentMode === 'online')
      set({ paymentMode: 'offline' });
  }, [availability.data?.enabled, form.paymentMode, set]);
  if (form.priceKind === 'free') return null;
  if (availability.data?.enabled !== true)
    return <p>Оплата на сайте отключена. Стоимость и порядок оплаты укажите в условиях встречи.</p>;
  const online = form.paymentMode === 'online';
  return (
    <FieldGroup
      legend="Как платят"
      error={online ? undefined : errors.paymentMode}
      hint={
        edit
          ? 'Включить оплату на сайте можно, пока на встречу никто не записан. Выключить или поменять цену можно, пока никто не заплатил.'
          : undefined
      }
    >
      <OptionCards
        label="Как платят"
        columns={2}
        size="sm"
        value={form.paymentMode}
        onChange={(paymentMode) => set({ paymentMode })}
        options={[
          {
            value: 'offline',
            title: 'На месте или переводом организатору',
            text: 'Деньги собираете сами, сайт в расчётах не участвует',
            icon: <HandCoinsIcon size={20} aria-hidden />,
          },
          {
            value: 'online',
            title: 'Онлайн на сайте',
            text: 'Участник платит по СБП или картой, когда записывается',
            icon: <CreditCardIcon size={20} aria-hidden />,
          },
        ]}
      />
      {online && <OnlineExplain form={form} set={set} errors={errors} />}
    </FieldGroup>
  );
}

function OnlineExplain({ form, set, errors }: Omit<PaymentModeFieldProps, 'edit'>) {
  const minId = useId();
  const split = form.priceKind === 'split';
  const total = Number(form.priceTotal ?? 0);
  const amount = Number(form.priceAmount ?? 0);
  const share = split
    ? total > 0 && form.minParticipants
      ? splitMaxShare(total, form.minParticipants)
      : 0
    : amount;
  const sbp = share > 0 ? quote(share, 'sbp', S) : null;
  const card = share > 0 ? quote(share, 'bank_card', S) : null;

  return (
    <div className={styles.payExplain} aria-live="polite">
      <p className={styles.payLead}>
        {split
          ? 'Участник платит свою долю и сбор сервиса. Сбор покрывает комиссию банка, вы получаете всю сумму складчины.'
          : 'Участник платит вашу цену и сбор сервиса. Сбор покрывает комиссию банка, вы получаете свою сумму полностью.'}
      </p>
      {sbp && card && (
        <p className={styles.payExample}>
          {split ? `Доля ${formatRub(share)}` : `Цена ${formatRub(share)}`}: участник заплатит ≈{' '}
          {formatRub(sbp.total)} по СБП или ≈ {formatRub(card.total)} картой.
        </p>
      )}
      {split && (
        <>
          <p>
            Деньги заморозим на карте и спишем итоговую долю перед встречей. Если порог не наберётся, деньги
            вернутся.
          </p>
          <div className={styles.payMin}>
            <label htmlFor={minId} className={styles.payMinLabel}>
              Встреча состоится, если придут
            </label>
            <InputNumber
              id={minId}
              size="large"
              min={2}
              max={form.capacity ?? 500}
              precision={0}
              value={form.minParticipants}
              onChange={(v) => set({ minParticipants: v === null ? null : Number(v) })}
              status={errors.paymentMode || errors.minParticipants ? 'error' : undefined}
              aria-describedby={`${minId}-hint`}
            />
            <span id={`${minId}-hint`} className={styles.payMinHint}>
              {form.minParticipants && share > 0
                ? `Если придут ${count(form.minParticipants, WORDS.person)}, доля ${formatRub(share)}. Придёт больше людей, и доля станет меньше.`
                : 'Без порога долю не посчитать: укажите, сколько человек нужно.'}
            </span>
          </div>
          <FieldError error={errors.paymentMode ?? errors.minParticipants} />
          <p>Оплата откроется за {count(S.splitOpenDays, WORDS.day)} до встречи, мы напомним участникам.</p>
        </>
      )}
      <ul className={styles.payFacts}>
        {!split && (
          <li>
            {form.joinMode === 'approval'
              ? `Платят после вашего одобрения, на оплату ${count(S.approvalHours, WORDS.hour)}.`
              : `После записи место держим ${count(S.holdMinutes, WORDS.minute)}. Если участник не оплатит, место освободится.`}
          </li>
        )}
        <li>Деньги придут на ваш баланс после встречи. Вывести их можно по СБП в разделе «Мои деньги».</li>
        <li>Если вы отмените встречу, участникам вернём всё.</li>
      </ul>
    </div>
  );
}
