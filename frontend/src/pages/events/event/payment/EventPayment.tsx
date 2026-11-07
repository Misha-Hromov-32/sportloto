import {
  ArrowCounterClockwiseIcon,
  CalendarDotsIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  CreditCardIcon,
  SnowflakeIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components';
import { dayjs, formatEventDate } from '@/lib/dates';
import { formatRub, freeCancelDeadline } from '@/lib/money';
import { payReturnPath } from '@/lib/payments';
import { count, WORDS } from '@/lib/plural';
import { PayDialog } from '@/pages/payments/parts/PayDialog';
import { sentence } from '@/pages/payments/parts/status';
import { useOpenConfirmation } from '@/pages/payments/parts/usePayments';
import type { EventDetails } from '@/types/api';

import styles from '../EventPage.module.css';
import local from './payment.module.css';

function useNow(stepMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(t);
  }, [stepMs, active]);
  return now;
}

/** «18:40» сегодня, иначе «21 октября, 18:40». */
function deadline(iso: string): string {
  const d = dayjs(iso);
  return d.isSame(dayjs(), 'day') ? d.format('HH:mm') : d.format('D MMMM, HH:mm');
}

function leftText(iso: string, now: number): string {
  const min = Math.max(1, Math.floor((Date.parse(iso) - now) / 60_000));
  if (min < 60) return `Осталось ${count(min, WORDS.minute)}`;
  const h = Math.floor(min / 60);
  if (h < 48) return `Осталось ${count(h, WORDS.hour)}`;
  return `Осталось ${count(Math.floor(h / 24), WORDS.day)}`;
}

type Tone = 'ok' | 'wait' | 'off' | 'danger';

function Note({
  tone,
  icon,
  title,
  children,
}: {
  tone: Tone;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={[styles.state, styles[`state-${tone}`]].join(' ')}>
      <p className={styles.stateTitle}>
        {icon}
        {title}
      </p>
      {children && <div className={styles.stateText}>{children}</div>}
    </div>
  );
}

/** Что с оплатой участия: срок, заморозка, оплачено, возврат. Кнопка «Оплатить», когда пора. */
export function EventPaymentState({ event: e, onPay }: { event: EventDetails; onPay: () => void }) {
  const pay = e.my?.payment ?? null;
  const ticking = pay?.status === 'required' || pay?.status === 'pending';
  const now = useNow(30_000, ticking);
  const open = useOpenConfirmation();
  const hasPay = Boolean(pay);
  // Ссылка из уведомления «Оплатите участие» ведёт на #pay: блок появляется после загрузки встречи
  useEffect(() => {
    if (hasPay && window.location.hash === '#pay')
      document.getElementById('pay')?.scrollIntoView({ block: 'center' });
  }, [hasPay]);
  if (!pay) return null;
  const p = pay.payment;
  const share = pay.finalShare ?? pay.base;

  switch (pay.status) {
    case 'not_yet':
      return (
        <Note
          tone="off"
          icon={<CalendarDotsIcon size={20} aria-hidden />}
          title={
            pay.opensAt ? `Оплата откроется ${dayjs(pay.opensAt).format('D MMMM')}` : 'Оплата откроется позже'
          }
        >
          <p>
            {pay.opensAt
              ? `Оплата открывается за ${count(Math.max(1, Math.round(dayjs(e.startsAt).diff(pay.opensAt, 'day', true))), WORDS.day)} до встречи, мы напомним.`
              : 'Мы напомним, когда можно будет заплатить.'}
          </p>
          {pay.maxShare && <p>Ваша доля будет не больше {formatRub(pay.maxShare)} и сбора сервиса.</p>}
        </Note>
      );
    case 'required':
      return (
        <Note
          tone="wait"
          icon={<ClockCountdownIcon size={20} weight="fill" aria-hidden />}
          title={
            pay.dueAt ? `Оплатите до ${deadline(pay.dueAt)}, иначе место освободится` : 'Оплатите участие'
          }
        >
          {pay.dueAt && <p>{leftText(pay.dueAt, now)}.</p>}
          {pay.priceKind === 'split' && pay.maxShare ? (
            <p>
              Наибольшая доля {formatRub(pay.maxShare)}, сейчас {formatRub(share)}. Если придут ещё люди, доля
              станет меньше.
            </p>
          ) : (
            <p>Цена участия {formatRub(pay.base)} и сбор сервиса.</p>
          )}
          {pay.canPay && (
            <div className={local.actions}>
              <Button variant="primary" block icon={<CreditCardIcon size={20} aria-hidden />} onClick={onPay}>
                Оплатить
              </Button>
            </div>
          )}
        </Note>
      );
    case 'pending':
      return (
        <Note
          tone="wait"
          icon={<ClockCountdownIcon size={20} weight="fill" aria-hidden />}
          title="Оплата не завершена"
        >
          <p>Вы начали оплату, но банк её ещё не подтвердил.</p>
          {pay.dueAt && (
            <p>
              Завершите до {deadline(pay.dueAt)}, иначе место освободится. {leftText(pay.dueAt, now)}.
            </p>
          )}
          <div className={local.actions}>
            {p?.confirmationUrl && (
              <Button variant="primary" block onClick={() => open(p.confirmationUrl!)}>
                Продолжить оплату
              </Button>
            )}
            {p && (
              <Button variant="quiet" to={payReturnPath(p.id)}>
                Проверить оплату
              </Button>
            )}
          </div>
        </Note>
      );
    case 'held':
      return (
        <Note
          tone="ok"
          icon={<SnowflakeIcon size={20} weight="bold" aria-hidden />}
          title={`Деньги заморожены: ${formatRub(p?.initialTotal ?? 0)}`}
        >
          <p>
            {pay.collectAt
              ? `${dayjs(pay.collectAt).format('D MMMM в HH:mm')} спишем вашу долю, остальное разморозится само.`
              : 'Перед встречей спишем вашу долю, остальное разморозится само.'}{' '}
            Сейчас доля {formatRub(share)}.
          </p>
          <p>Если не наберётся нужное число людей, заморозку снимем.</p>
        </Note>
      );
    case 'paid':
      return (
        <Note
          tone="ok"
          icon={<CheckCircleIcon size={20} weight="fill" aria-hidden />}
          title={`Оплачено: ${formatRub(p?.total ?? pay.base)}`}
        >
          {p && p.refundedAmount > 0 ? (
            <p>
              Итоговая доля {formatRub(share)}. Разницу {formatRub(p.refundedAmount)} вернули туда же, откуда
              вы платили.
            </p>
          ) : pay.priceKind === 'split' && !pay.finalShare ? (
            <p>Перед встречей пересчитаем долю. Если людей будет больше, разницу вернём.</p>
          ) : (
            <p>Организатор получит деньги после встречи. Если встречу отменят, вернём всё.</p>
          )}
        </Note>
      );
    case 'refunded':
      return (
        <Note
          tone="off"
          icon={<ArrowCounterClockwiseIcon size={20} aria-hidden />}
          title={`Возврат ${formatRub(p?.refundedAmount ?? 0)} оформлен`}
        >
          <p>{sentence(p?.reason || pay.hint || 'Деньги вернутся туда же, откуда вы платили.')}</p>
        </Note>
      );
    case 'canceled':
      return (
        <Note tone="off" icon={<XCircleIcon size={20} aria-hidden />} title="Списания не будет">
          <p>{sentence(p?.reason || pay.hint || 'Заморозку на карте сняли, деньги остались у вас.')}</p>
        </Note>
      );
    case 'expired':
      return (
        <Note tone="off" icon={<XCircleIcon size={20} aria-hidden />} title="Оплата не пришла вовремя">
          <p>{sentence(pay.hint || 'Запись отменили, место ушло следующему в очереди.')}</p>
        </Note>
      );
  }
}

/** Что вернётся при отмене записи — до подтверждения. */
export function LeaveRefundNote({ event: e }: { event: EventDetails }) {
  const pay = e.my?.payment;
  if (!pay) return null;
  const p = pay.payment;
  const late = Date.now() > freeCancelDeadline(e.cancelPolicy, e.startsAt).getTime();
  if (pay.status === 'required' || pay.status === 'pending' || pay.status === 'not_yet')
    return <p>Вы ещё не платили, списывать ничего не будем.</p>;
  if (!p) return null;
  if (pay.status === 'held') {
    return late ? (
      <p className={styles.warn}>
        Срок бесплатной отмены прошёл: вашу долю спишем с карты и передадим организатору.
      </p>
    ) : (
      <p>Заморозку {formatRub(p.initialTotal)} снимем, деньги останутся на карте.</p>
    );
  }
  if (pay.status === 'paid') {
    const back = Math.max(0, p.capturedAmount - p.refundedAmount - p.fee);
    return late ? (
      <p className={styles.warn}>
        Срок бесплатной отмены прошёл: деньги получит организатор, вернуть их не получится.
      </p>
    ) : (
      <p>
        Вернём {formatRub(back || p.base)}. Сбор сервиса {formatRub(p.fee)} не возвращается: он ушёл на
        комиссию банка.
      </p>
    );
  }
  return null;
}

/** Окно оплаты участия во встрече. */
export function EventPayDialog({
  event: e,
  open,
  onClose,
}: {
  event: EventDetails;
  open: boolean;
  onClose: () => void;
}) {
  const pay = e.my?.payment ?? null;
  const split =
    e.price.kind === 'split'
      ? {
          total: e.price.total,
          minParticipants: e.minParticipants,
          currentShare: pay?.base ?? Math.ceil(e.price.total / Math.max(e.counts.confirmed, 1)),
        }
      : null;
  return (
    <PayDialog
      open={open}
      onClose={onClose}
      kind="event_share"
      quoteTargetId={e.id}
      paymentTargetId={e.id}
      title={e.price.kind === 'split' ? 'Оплата доли' : 'Оплата участия'}
      what={e.title}
      when={formatEventDate(e.startsAt)}
      split={split}
      note={
        pay?.dueAt ? (
          <p>
            {e.price.kind === 'split' ? 'Оплатить нужно до' : 'Место держим до'} {deadline(pay.dueAt)}. Если
            передумаете, отмените запись, платить не придётся.
          </p>
        ) : undefined
      }
    />
  );
}
