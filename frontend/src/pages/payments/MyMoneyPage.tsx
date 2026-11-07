import { BankIcon, WalletIcon } from '@phosphor-icons/react';
import { Segmented } from 'antd';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import {
  Button,
  EmptyState,
  ErrorState,
  NoAccessState,
  Section,
  SkeletonBlock,
  StatusBadge,
} from '@/components';
import { useMe } from '@/lib/api';
import { dayjs } from '@/lib/dates';
import { formatRub } from '@/lib/money';
import { PAY_METHOD_LABEL, payReturnPath } from '@/lib/payments';
import { usePaymentAvailability } from '@/lib/payments';
import { OrdersSection } from '@/pages/inventory/orders/OrdersSection';
import { PillTabs } from '@/pages/me/parts/PillTabs';
import type { BalanceSummary, BalanceView, PaymentView } from '@/types/payments';

import { PersonalPage } from '../shared/PersonalPage';
import styles from './parts/money.module.css';
import { PayoutDialog } from './parts/PayoutDialog';
import { PAYMENT_STATUS, PAYOUT_STATUS, sentence } from './parts/status';
import { listOf, useBalance, useBalances, useMyPayments, useOpenConfirmation } from './parts/usePayments';

type TabKey = 'payments' | 'orders' | 'income';
const TABS: TabKey[] = ['payments', 'orders', 'income'];

/** Мои деньги: что я оплатил, мои покупки и продажи, баланс за встречи и вещи, вывод по СБП. */
export default function MyMoneyPage() {
  const availability = usePaymentAvailability();
  const { role } = useMe();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as TabKey | null;
  const tab: TabKey = raw && TABS.includes(raw) ? raw : 'payments';
  const setTab = (next: TabKey) =>
    setParams(next === 'payments' ? {} : { tab: next }, { replace: true, preventScrollReset: true });
  const balances = useBalances(role !== 'admin');
  const summaries = listOf(balances.data);
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const owner = summaries.find((s) => s.owner.key === ownerKey) ?? summaries[0] ?? null;
  const available = summaries.reduce((sum, s) => sum + s.available, 0);

  if (availability.data?.enabled === false)
    return (
      <div className="container">
        <EmptyState title="Оплата на сайте отключена">
          Платежи, покупки и вывод средств через сайт недоступны. Финансовая история сохранена.
        </EmptyState>
        <Button to="/events" variant="secondary">
          Найти встречу
        </Button>
      </div>
    );
  if (role === 'admin') {
    return (
      <div className="container">
        <NoAccessState
          title="Платежи сервиса собраны в администрировании"
          actions={
            <Button variant="primary" to="/admin/payments">
              Открыть оплату в администрировании
            </Button>
          }
        >
          У администратора нет своего баланса. Все платежи, возвраты и выплаты собраны в разделе «Оплата».
        </NoAccessState>
      </div>
    );
  }

  return (
    <PersonalPage
      title="Мои деньги"
      description="Что вы оплатили на сайте, покупки и продажи на полке, деньги за ваши встречи и вывод на карту по СБП."
      icon={<WalletIcon size={28} />}
      summary={
        <>
          <strong>{balances.isLoading ? 'Считаем…' : formatRub(available)}</strong>
          Доступно к выводу
        </>
      }
    >
      <BalancePanel
        summaries={summaries}
        owner={owner}
        loading={balances.isLoading}
        error={balances.isError}
        onRetry={() => void balances.refetch()}
        onOwner={setOwnerKey}
      />

      <PillTabs<TabKey>
        label="Мои деньги"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'payments', label: 'Платежи' },
          { key: 'orders', label: 'Покупки и продажи' },
          { key: 'income', label: 'Зачисления и выводы' },
        ]}
      >
        {tab === 'payments' ? (
          <PaymentsTab />
        ) : tab === 'orders' ? (
          <div className={styles.tab}>
            <OrdersSection role="buyer" hideEmpty={false} />
            <OrdersSection role="seller" hideEmpty={false} />
          </div>
        ) : owner ? (
          <IncomeTab ownerKey={owner.owner.key} />
        ) : (
          <div className={styles.tab}>
            <EmptyState title="Зачислений пока нет" icon={<WalletIcon size={28} aria-hidden />}>
              Здесь появятся деньги за ваши встречи с оплатой на сайте и за проданные вещи.
            </EmptyState>
          </div>
        )}
      </PillTabs>
    </PersonalPage>
  );
}

function BalancePanel({
  summaries,
  owner,
  loading,
  error,
  onRetry,
  onOwner,
}: {
  summaries: BalanceSummary[];
  owner: BalanceSummary | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onOwner: (key: string) => void;
}) {
  if (loading) {
    return (
      <div className={styles.balance} role="status" aria-live="polite">
        <span className="sr-only">Загружаем баланс…</span>
        <SkeletonBlock height={96} />
      </div>
    );
  }
  if (error) return <ErrorState title="Не удалось загрузить баланс" onRetry={onRetry} />;
  if (!owner) return null;
  return (
    <section className={styles.balance} aria-labelledby="balance-title">
      <div className={styles.balanceHead}>
        <h2 id="balance-title" className={styles.balanceTitle}>
          Баланс
        </h2>
        {summaries.length > 1 && (
          <Segmented
            aria-label="Чей баланс"
            value={owner.owner.key}
            onChange={(v) => onOwner(String(v))}
            options={summaries.map((s) => ({
              value: s.owner.key,
              label: s.owner.kind === 'user' ? 'Мой' : s.owner.name,
            }))}
          />
        )}
      </div>
      <BalanceNumbers ownerKey={owner.owner.key} summary={owner} />
    </section>
  );
}

function BalanceNumbers({ ownerKey, summary }: { ownerKey: string; summary: BalanceSummary }) {
  const { data } = useBalance(ownerKey);
  const [open, setOpen] = useState(false);
  const b: BalanceView | null = data;
  const next = b?.pendingItems.find((x) => x.availableAt);
  return (
    <>
      <dl className={styles.numbers}>
        <div className={styles.numberMain}>
          <dt>Доступно к выводу</dt>
          <dd>{formatRub(summary.available)}</dd>
        </div>
        <div>
          <dt>Ожидает зачисления</dt>
          <dd>{formatRub(summary.pending)}</dd>
          {next?.availableAt && (
            <span className={styles.numberSub}>
              Ближайшее: {formatRub(next.amount)}, {dayjs(next.availableAt).format('D MMMM')}
            </span>
          )}
        </div>
        {b && b.inPayout > 0 && (
          <div>
            <dt>Выводится сейчас</dt>
            <dd>{formatRub(b.inPayout)}</dd>
          </div>
        )}
      </dl>
      <div className={styles.balanceActions}>
        <Button
          variant="primary"
          icon={<BankIcon size={20} aria-hidden />}
          disabled={!b?.canPayout}
          onClick={() => setOpen(true)}
        >
          Вывести
        </Button>
        <p className={styles.muted}>
          {b && !b.canPayout && b.payoutHint
            ? `${b.payoutHint}.`
            : 'Деньги за встречу приходят после её окончания, за вещь после того, как покупатель её получил.'}
        </p>
      </div>
      {b && <PayoutDialog balance={b} open={open} onClose={() => setOpen(false)} />}
    </>
  );
}

function PaymentsTab() {
  const { data, isLoading, isError, refetch } = useMyPayments();
  const list = listOf(data);
  if (isLoading) {
    return (
      <div className={styles.tab} role="status" aria-live="polite">
        <span className="sr-only">Загружаем платежи…</span>
        <SkeletonBlock height={88} />
        <SkeletonBlock height={88} />
      </div>
    );
  }
  if (isError) return <ErrorState title="Не удалось загрузить платежи" onRetry={() => void refetch()} />;
  if (!list.length) {
    return (
      <div className={styles.tab}>
        <EmptyState
          title="Вы ещё ничего не оплачивали на сайте"
          icon={<WalletIcon size={28} aria-hidden />}
          actions={
            <Button variant="primary" to="/events">
              Найти встречу
            </Button>
          }
        >
          Здесь появятся оплаты за встречи и покупки на полке, с суммой и статусом.
        </EmptyState>
      </div>
    );
  }
  return (
    <ul className={[styles.tab, styles.rows].join(' ')}>
      {list.map((p) => (
        <PaymentRow key={p.id} p={p} />
      ))}
    </ul>
  );
}

function PaymentRow({ p }: { p: PaymentView }) {
  const open = useOpenConfirmation();
  const held = p.status === 'held';
  const shown = held ? p.initialTotal : p.total;
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <Link to={p.link} className={styles.rowTitle}>
          {p.title}
        </Link>
        <span className={styles.rowMeta}>
          {dayjs(p.createdAt).format('D MMMM, HH:mm')} · {PAY_METHOD_LABEL[p.method]} ·{' '}
          {p.kind === 'event_share' ? 'организатору' : 'продавцу'} {formatRub(p.base)}, сбор{' '}
          {formatRub(p.fee)}
        </span>
        {p.refundedAmount > 0 && (
          <span className={styles.rowMeta}>Вернули {formatRub(p.refundedAmount)}</span>
        )}
        {p.reason && p.status !== 'paid' && <span className={styles.rowMeta}>{sentence(p.reason)}</span>}
        {p.processing && <span className={styles.rowMeta}>Банк обрабатывает операцию</span>}
        {p.status === 'pending' && p.confirmationUrl && (
          <span className={styles.rowActions}>
            <Button size="sm" variant="secondary" onClick={() => open(p.confirmationUrl!)}>
              Продолжить оплату
            </Button>
            <Button size="sm" variant="quiet" to={payReturnPath(p.id)}>
              Проверить
            </Button>
          </span>
        )}
      </div>
      <div className={styles.rowSide}>
        <strong className={styles.rowSum}>{formatRub(shown)}</strong>
        <StatusBadge kind="custom" meta={PAYMENT_STATUS[p.status]} />
      </div>
    </li>
  );
}

function IncomeTab({ ownerKey }: { ownerKey: string }) {
  const { data: b, isLoading, isError, refetch } = useBalance(ownerKey);
  if (isLoading) {
    return (
      <div className={styles.tab} role="status" aria-live="polite">
        <span className="sr-only">Загружаем зачисления…</span>
        <SkeletonBlock height={88} />
      </div>
    );
  }
  if (isError || !b)
    return <ErrorState title="Не удалось загрузить зачисления" onRetry={() => void refetch()} />;
  const empty = !b.pendingItems.length && !b.credits.length && !b.payouts.length;
  if (empty) {
    return (
      <div className={styles.tab}>
        <EmptyState title="Зачислений пока нет" icon={<WalletIcon size={28} aria-hidden />}>
          Когда участники оплатят вашу встречу на сайте или кто-то купит вашу вещь, деньги появятся здесь.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className={styles.tab}>
      {b.pendingItems.length > 0 && (
        <Section title="Ожидает зачисления" aside={formatRub(b.pending)}>
          <ul className={styles.rows}>
            {b.pendingItems.map((x) => (
              <li key={`${x.source}-${x.targetId}`} className={styles.row}>
                <div className={styles.rowMain}>
                  <Link to={x.link} className={styles.rowTitle}>
                    {x.title}
                  </Link>
                  <span className={styles.rowMeta}>
                    {x.source === 'event' ? 'Встреча' : 'Продажа'}
                    {x.availableAt
                      ? ` · придёт ${dayjs(x.availableAt).format('D MMMM')}${x.source === 'order' ? ' или раньше, когда покупатель нажмёт «Получил»' : ', после встречи'}`
                      : ''}
                  </span>
                </div>
                <div className={styles.rowSide}>
                  <strong className={styles.rowSum}>{formatRub(x.amount)}</strong>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {b.payouts.length > 0 && (
        <Section title="Выводы" aside={b.paidOut ? `выведено ${formatRub(b.paidOut)}` : undefined}>
          <ul className={styles.rows}>
            {b.payouts.map((po) => (
              <li key={po.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {po.bankName}, {po.phoneMasked}
                  </span>
                  <span className={styles.rowMeta}>
                    {dayjs(po.createdAt).format('D MMMM, HH:mm')}
                    {po.doneAt ? ` · переведено ${dayjs(po.doneAt).format('D MMMM')}` : ''}
                  </span>
                  {po.status === 'failed' && po.reason && (
                    <span className={styles.rowMeta}>{sentence(po.reason)} Деньги снова на балансе.</span>
                  )}
                </div>
                <div className={styles.rowSide}>
                  <strong className={styles.rowSum}>{formatRub(po.amount)}</strong>
                  <StatusBadge kind="custom" meta={PAYOUT_STATUS[po.status]} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {b.credits.length > 0 && (
        <Section title="Зачисления" aside={`всего ${formatRub(b.credited)}`}>
          <ul className={styles.rows}>
            {b.credits.map((c) => (
              <li key={c.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <Link
                    to={c.source === 'event' ? `/events/${c.targetId}/manage#money` : `/orders/${c.targetId}`}
                    className={styles.rowTitle}
                  >
                    {c.title}
                  </Link>
                  <span className={styles.rowMeta}>
                    {c.source === 'event' ? 'За встречу' : 'За вещь'} · {dayjs(c.at).format('D MMMM, HH:mm')}
                  </span>
                </div>
                <div className={styles.rowSide}>
                  <strong className={[styles.rowSum, styles.plus].join(' ')}>+{formatRub(c.amount)}</strong>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
