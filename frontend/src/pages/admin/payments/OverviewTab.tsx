import { CheckCircleIcon, FlaskIcon, MinusCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Button, ErrorState, Section, SkeletonBlock } from '@/components';
import { useLiveGet } from '@/lib/api';
import { formatRub } from '@/lib/money';
import { PAYMENTS_API, PAYMENTS_LIVE } from '@/lib/payments';
import { count } from '@/lib/plural';
import type { PaymentsOverview, ProviderStatus } from '@/types/payments';

import styles from './payments.module.css';

const PAYOUTS = ['выплата', 'выплаты', 'выплат'] as const;

export function OverviewTab({ onTab }: { onTab: (tab: 'payments' | 'payouts' | 'settings') => void }) {
  const {
    data: o,
    isLoading,
    isError,
    refetch,
  } = useLiveGet<PaymentsOverview>(PAYMENTS_API.admin.overview, [...PAYMENTS_LIVE, 'admin']);
  if (isError)
    return <ErrorState title="Не удалось загрузить сводку оплаты" onRetry={() => void refetch()} />;
  if (isLoading || !o) {
    return (
      <div className={styles.stack} role="status" aria-live="polite">
        <span className="sr-only">Загружаем сводку…</span>
        <SkeletonBlock height={120} />
        <SkeletonBlock height={200} />
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <ProviderPanel provider={o.provider} onSettings={() => onTab('settings')} />

      {(o.payoutsWaitingCount > 0 || o.counts.failedOps > 0) && (
        <div className={styles.attention} role="status">
          {o.payoutsWaitingCount > 0 && (
            <div className={styles.attentionRow}>
              <p>
                <b>Ждут перевода: {count(o.payoutsWaitingCount, PAYOUTS)}</b> на {formatRub(o.payoutsWaiting)}
                .
              </p>
              <Button size="sm" variant="primary" onClick={() => onTab('payouts')}>
                Открыть выплаты
              </Button>
            </div>
          )}
          {o.counts.failedOps > 0 && (
            <div className={styles.attentionRow}>
              <p>
                <b>Операции с ошибкой: {o.counts.failedOps}.</b> ЮKassa не приняла списание, возврат или
                выплату.
              </p>
              <Button size="sm" variant="secondary" onClick={() => onTab('payments')}>
                Посмотреть платежи
              </Button>
            </div>
          )}
        </div>
      )}

      <Section title="Деньги через сайт">
        <dl className={styles.big}>
          <Big label="Оборот" value={o.turnover} hint="Заплатили люди, за вычетом возвратов" main />
          <Big label="Комиссия банка" value={o.bankFees} hint="Оценка по ставкам ЮKassa" />
          <Big label="Сбор сервиса" value={o.serviceFees} hint="Покрывает комиссию банка и выплаты" />
          <Big label="Наценка с вещей" value={o.platformIncome} hint="Доход сервиса с продаж на полке" />
          <Big label="Резерв округления" value={o.reserve} hint="Копейки от округления, на возвраты" />
          <Big label="Возвращено" value={o.refunded} hint={`Возвратов: ${o.counts.refunds}`} />
        </dl>
      </Section>

      <Section title="Получателям">
        <dl className={styles.big}>
          <Big
            label="К выплате"
            value={o.balancesDue}
            hint="Доступно к выводу у организаторов и продавцов"
            main
          />
          <Big
            label="Ожидает зачисления"
            value={o.pendingCredits}
            hint="Встречи ещё не прошли, вещи не получены"
          />
          <Big
            label="Выплаты в работе"
            value={o.payoutsWaiting}
            hint={o.payoutsWaitingCount ? count(o.payoutsWaitingCount, PAYOUTS) : 'Нет заявок'}
          />
        </dl>
      </Section>

      <Section title="Платежи">
        <dl className={styles.small}>
          <div>
            <dt>Всего</dt>
            <dd>{o.counts.payments}</dd>
          </div>
          <div>
            <dt>Оплачено</dt>
            <dd>{o.counts.paid}</dd>
          </div>
          <div>
            <dt>Заморожено на картах</dt>
            <dd>{o.counts.held}</dd>
          </div>
          <div className={o.counts.failedOps ? styles.smallBad : undefined}>
            <dt>Операции с ошибкой</dt>
            <dd>{o.counts.failedOps}</dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}

function Big({ label, value, hint, main }: { label: string; value: number; hint: string; main?: boolean }) {
  return (
    <div className={main ? styles.bigMain : undefined}>
      <dt>{label}</dt>
      <dd>{formatRub(value)}</dd>
      <span>{hint}</span>
    </div>
  );
}

function Flag({ on, children, warn }: { on: boolean; children: ReactNode; warn?: boolean }) {
  return (
    <li className={on ? styles.flagOn : warn ? styles.flagWarn : styles.flagOff}>
      {on ? (
        <CheckCircleIcon size={20} weight="fill" aria-hidden />
      ) : warn ? (
        <WarningCircleIcon size={20} weight="fill" aria-hidden />
      ) : (
        <MinusCircleIcon size={20} aria-hidden />
      )}
      <span>{children}</span>
    </li>
  );
}

function ProviderPanel({ provider: p, onSettings }: { provider: ProviderStatus; onSettings: () => void }) {
  const fake = p.provider === 'fake';
  return (
    <section className={styles.provider} aria-labelledby="provider-title">
      <div className={styles.providerHead}>
        <h2 id="provider-title" className={styles.providerTitle}>
          {fake ? 'Встроенная тестовая оплата' : 'ЮKassa подключена'}
        </h2>
        {(fake || p.test) && (
          <span className={styles.testTag}>
            <FlaskIcon size={18} weight="bold" aria-hidden />
            {fake ? 'Деньги не списываются' : 'Тестовый магазин'}
          </span>
        )}
      </div>
      <p className={styles.providerText}>
        {fake
          ? 'Люди проходят оплату на тестовой странице, настоящие деньги не списываются. Чтобы принимать оплату, задайте PAYMENTS_PROVIDER=yookassa и ключи магазина.'
          : p.test
            ? 'Магазин ЮKassa в тестовом режиме: платежи проходят по тестовым картам, деньги не настоящие.'
            : 'Платежи принимает ЮKassa. Статус каждой оплаты сервер перепроверяет запросом в ЮKassa.'}
      </p>
      <ul className={styles.flags}>
        <Flag on={p.shopConfigured} warn={!fake}>
          {p.shopConfigured ? 'Ключи магазина заданы' : 'Ключи магазина не заданы'}
        </Flag>
        <Flag on={p.receipts}>
          {p.receipts ? 'Чеки от ЮKassa прикладываются к платежам' : 'Чеки не прикладываются'}
        </Flag>
        <Flag on={p.payouts === 'auto'}>
          {p.payouts === 'auto'
            ? 'Выплаты уходят через ЮKassa сами'
            : 'Выплаты переводит администратор вручную'}
        </Flag>
        <Flag on={p.checkIp}>
          {p.checkIp ? 'Уведомления принимаются только с адресов ЮKassa' : 'Адрес уведомлений не проверяется'}
        </Flag>
      </ul>
      <div>
        <Button size="sm" variant="secondary" onClick={onSettings}>
          Ставки и сроки
        </Button>
      </div>
    </section>
  );
}
