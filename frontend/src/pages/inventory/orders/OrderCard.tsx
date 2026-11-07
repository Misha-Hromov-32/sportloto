import { CheckIcon, EnvelopeSimpleIcon, PhoneIcon, ShoppingBagIcon } from '@phosphor-icons/react';
import { App, Input } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router';

import { Button, StatusBadge } from '@/components';
import type { StatusMeta } from '@/lib/labels';
import { useAction } from '@/lib/api';
import { dayjs } from '@/lib/dates';
import { formatRub } from '@/lib/money';
import { PAYMENTS_API } from '@/lib/payments';
import { count } from '@/lib/plural';
import { ORDER_STATUS, sentence } from '@/pages/payments/parts/status';
import type { OrderView } from '@/types/payments';

import styles from './orders.module.css';
import { OrderPayDialog } from './BuyDialog';

const PIECES = ['штука', 'штуки', 'штук'] as const;

function when(iso: string): string {
  const d = dayjs(iso);
  return d.isSame(dayjs(), 'day') ? `сегодня в ${d.format('HH:mm')}` : d.format('D MMMM в HH:mm');
}

/** Как статус заказа видит продавец. */
function sellerMeta(o: OrderView): StatusMeta {
  if (o.status === 'awaiting_payment') return { label: 'Покупатель платит', tone: 'wait', icon: 'clock' };
  if (o.status === 'paid') return { label: 'Оплачено, передайте вещь', tone: 'ok', icon: 'check' };
  if (o.status === 'received') return { label: 'Продано', tone: 'ok', icon: 'check' };
  return ORDER_STATUS[o.status];
}

function Contact({ o }: { o: OrderView }) {
  const c = o.counterpart;
  if (!c) return null;
  const mail = c.contact?.includes('@');
  return (
    <div className={styles.contact}>
      <p className={styles.contactWho}>
        {o.isBuyer ? 'Продавец' : 'Покупатель'}: <Link to={c.link}>{c.name}</Link>
      </p>
      {c.contact ? (
        <a
          className={styles.contactLink}
          href={mail ? `mailto:${c.contact}` : `tel:${c.contact.replace(/[^\d+]/g, '')}`}
        >
          {mail ? <EnvelopeSimpleIcon size={20} aria-hidden /> : <PhoneIcon size={20} aria-hidden />}
          {c.contact}
        </a>
      ) : (
        <p className={styles.muted}>
          Контакта нет, напишите через страницу {o.isBuyer ? 'продавца' : 'покупателя'}.
        </p>
      )}
    </div>
  );
}

/** Покупка или продажа вещи с полки: статус, с кем договориться и что нажать. */
export function OrderCard({ order: o }: { order: OrderView }) {
  const { run, isPending } = useAction<OrderView>();
  const { modal } = App.useApp();
  const [paying, setPaying] = useState(false);
  const meta = o.isBuyer ? ORDER_STATUS[o.status] : sellerMeta(o);
  const paidTotal = o.payment ? o.payment.total : null;

  const received = () =>
    modal.confirm({
      title: `Вы получили «${o.itemName}»?`,
      content: `Деньги ${formatRub(o.amount)} уйдут продавцу. Отменить покупку после этого будет нельзя.`,
      okText: 'Получил',
      cancelText: 'Ещё нет',
      onOk: () => run(PAYMENTS_API.orderReceived(o.id), {}, { success: 'Деньги переданы продавцу' }),
    });

  const cancel = () => {
    let reason = '';
    modal.confirm({
      title: o.isBuyer ? `Отменить покупку «${o.itemName}»?` : `Отменить продажу «${o.itemName}»?`,
      content: (
        <div className={styles.confirm}>
          <p>
            {o.status === 'paid'
              ? `Покупателю вернём всё: ${formatRub(paidTotal ?? o.amount)}. Вещь снова появится на полке.`
              : 'Заказ отменится, вещь снова появится на полке.'}
          </p>
          {o.isSeller && (
            <Input.TextArea
              aria-label="Причина, её увидит покупатель"
              placeholder="Причина, её увидит покупатель (необязательно)"
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={300}
              onChange={(e) => {
                reason = e.target.value;
              }}
            />
          )}
        </div>
      ),
      okText: o.isBuyer ? 'Отменить покупку' : 'Отменить продажу',
      okButtonProps: { danger: true },
      cancelText: 'Оставить',
      onOk: () =>
        run(PAYMENTS_API.orderCancel(o.id), reason.trim() ? { reason: reason.trim() } : {}, {
          success: o.status === 'paid' ? 'Заказ отменён, деньги вернутся покупателю' : 'Заказ отменён',
        }),
    });
  };

  return (
    <article className={styles.card} aria-labelledby={`order-${o.id}`}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden>
          <ShoppingBagIcon size={24} />
        </span>
        <div className={styles.headText}>
          <h3 id={`order-${o.id}`} className={styles.title}>
            {o.itemName}
          </h3>
          <p className={styles.sub}>
            {count(o.quantity, PIECES)}, {formatRub(o.amount)}
            {o.isBuyer &&
              paidTotal !== null &&
              paidTotal !== o.amount &&
              ` (со сбором ${formatRub(paidTotal)})`}
          </p>
        </div>
        <StatusBadge kind="custom" meta={meta} />
      </div>

      {o.isBuyer ? <BuyerBody o={o} /> : <SellerBody o={o} />}

      {(o.status === 'paid' || o.status === 'received') && <Contact o={o} />}

      {(o.can.pay || o.can.received || o.can.cancel) && (
        <div className={styles.actions}>
          {o.can.pay && (
            <Button variant="primary" onClick={() => setPaying(true)}>
              Оплатить
            </Button>
          )}
          {o.can.received && (
            <Button
              variant="primary"
              icon={<CheckIcon size={20} weight="bold" aria-hidden />}
              loading={isPending}
              onClick={received}
            >
              Получил
            </Button>
          )}
          {o.can.cancel && (
            <Button variant="quiet" onClick={cancel} disabled={isPending}>
              {o.isBuyer ? 'Отменить покупку' : 'Отменить продажу'}
            </Button>
          )}
        </div>
      )}
      {o.can.pay && <OrderPayDialog order={o} open={paying} onClose={() => setPaying(false)} />}
    </article>
  );
}

function BuyerBody({ o }: { o: OrderView }) {
  switch (o.status) {
    case 'awaiting_payment':
      return (
        <p className={styles.text}>
          {o.can.pay
            ? `Оплатите до ${when(o.payDueAt)}, иначе заказ отменится и вещь вернётся на полку.`
            : 'Срок оплаты вышел. Заказ скоро отменится.'}
        </p>
      );
    case 'paid':
      return (
        <div className={styles.text}>
          <p className={styles.lead}>Договоритесь с продавцом о передаче.</p>
          <p>
            Когда заберёте вещь, нажмите «Получил». До подтверждения оплата удерживается
            {o.autoCompleteAt ? `, а ${when(o.autoCompleteAt)} будут перечислены продавцу автоматически` : ''}
            .
          </p>
        </div>
      );
    case 'received':
      return <p className={styles.text}>Вы получили вещь{o.receivedAt ? ` ${when(o.receivedAt)}` : ''}.</p>;
    default:
      return <Canceled o={o} />;
  }
}

function SellerBody({ o }: { o: OrderView }) {
  switch (o.status) {
    case 'awaiting_payment':
      return (
        <p className={styles.text}>
          Покупка оформлена, ждём оплату от покупателя ({o.buyer.name}). Вещь отложена до {when(o.payDueAt)}.
        </p>
      );
    case 'paid':
      return (
        <div className={styles.text}>
          <p className={styles.lead}>Покупатель оплатил, передайте вещь.</p>
          <p>
            Вам придёт {formatRub(o.amount)}, когда покупатель нажмёт «Получил»
            {o.autoCompleteAt ? ` или ${when(o.autoCompleteAt)}` : ''}.
          </p>
        </div>
      );
    case 'received':
      return (
        <p className={styles.text}>
          Деньги {formatRub(o.amount)} зачислены на баланс. <Link to="/me/money">Вывести</Link>
        </p>
      );
    default:
      return <Canceled o={o} />;
  }
}

function Canceled({ o }: { o: OrderView }) {
  const who =
    o.canceledBy === 'buyer'
      ? o.isBuyer
        ? 'Вы отменили покупку'
        : 'Покупатель отменил покупку'
      : o.canceledBy === 'seller'
        ? o.isSeller
          ? 'Вы отменили продажу'
          : 'Продавец отменил продажу'
        : o.canceledBy === 'admin'
          ? 'Заказ отменил администратор'
          : 'Оплата не пришла вовремя, заказ отменился';
  return (
    <div className={styles.text}>
      <p>
        {who}
        {o.reason ? `: ${sentence(o.reason)}` : '.'}
      </p>
      {o.status === 'refunded' && o.isBuyer && <p>Деньги вернутся туда же, откуда вы платили.</p>}
    </div>
  );
}
