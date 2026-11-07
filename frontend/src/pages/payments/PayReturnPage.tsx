import { ArrowsClockwiseIcon, CircleNotchIcon, WalletIcon } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import { Button, ErrorState, GoneState, NoAccessState, StatusBadge } from '@/components';
import { errorMessage, useMe } from '@/lib/api';
import { dayjs } from '@/lib/dates';
import { formatRub } from '@/lib/money';
import { PAY_METHOD_LABEL } from '@/lib/payments';
import type { PaymentView } from '@/types/payments';

import { SportsPattern } from '../landing/parts/SportsPattern';
import styles from './pay.module.css';
import { PAYMENT_STATUS, sentence } from './parts/status';
import { useOpenConfirmation, usePayment, useStartPayment } from './parts/usePayments';

const POLL_MS = 2000;
const POLL_FOR_MS = 30_000;

/** Сюда банк возвращает человека после оплаты: проверяем статус и говорим, что дальше. */
export default function PayReturnPage() {
  const [params] = useSearchParams();
  const id = params.get('payment') ?? params.get('id') ?? '';
  const { isGuest, isLoading: meLoading } = useMe();
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const waiting = now - startedAt < POLL_FOR_MS;
  const { payment, isLoading, isError, error, refetch } = usePayment(
    id,
    waiting ? POLL_MS : 0,
    (p) => !p || isPending(p),
  );
  const pending = payment ? isPending(payment) : false;

  useEffect(() => {
    if (!pending || !waiting) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [pending, waiting]);

  const checkAgain = () => {
    setStartedAt(Date.now());
    setNow(Date.now());
    void refetch();
  };

  if (!meLoading && isGuest) {
    return (
      <div className="container">
        <NoAccessState
          guest
          loginTo={`/pay/return?payment=${encodeURIComponent(id)}`}
          title="Войдите, чтобы увидеть оплату"
        >
          Статус платежа видит только тот, кто платил.
        </NoAccessState>
      </div>
    );
  }
  if (!id || error?.statusCode === 404) {
    return (
      <div className="container">
        <GoneState
          title="Платёж не найден"
          actions={
            <Button variant="primary" to="/me/money">
              Мои деньги
            </Button>
          }
        >
          Возможно, ссылка неполная. Все ваши оплаты собраны в разделе «Мои деньги».
        </GoneState>
      </div>
    );
  }
  if (isError && !payment) {
    return (
      <div className="container">
        <ErrorState layout="page" title="Не удалось проверить оплату" onRetry={checkAgain}>
          Проверьте интернет и нажмите «Повторить». Если деньги списались, они не потеряются.
        </ErrorState>
      </div>
    );
  }
  if (isLoading || !payment) return <Checking />;
  if (pending && waiting) return <Checking payment={payment} />;
  return <Result payment={payment} onCheckAgain={checkAgain} />;
}

const isPending = (p: PaymentView) => p.status === 'pending' || p.processing;

function Shell({
  title,
  tone,
  lead,
  actions,
  payment,
}: {
  title: string;
  tone: 'ok' | 'wait' | 'off' | 'danger';
  lead: ReactNode;
  actions?: ReactNode;
  payment?: PaymentView | null;
}) {
  return (
    <section className={styles.page} aria-labelledby="pay-title">
      <SportsPattern />
      <div className={styles.copy}>
        <h1 id="pay-title" className={styles[`title-${tone}`]} tabIndex={-1}>
          {title}
          <span>.</span>
        </h1>
        <div className={styles.lead} aria-live="polite">
          {lead}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {payment && <Receipt payment={payment} />}
    </section>
  );
}

function Receipt({ payment: p }: { payment: PaymentView }) {
  const forWhom = p.kind === 'event_share' ? 'Организатору' : 'Продавцу';
  return (
    <aside className={styles.receipt} aria-label="Платёж">
      <div className={styles.receiptHead}>
        <WalletIcon size={24} aria-hidden />
        <span>Платёж от {dayjs(p.createdAt).format('D MMMM, HH:mm')}</span>
      </div>
      <p className={styles.receiptTitle}>{p.title}</p>
      <StatusBadge kind="custom" meta={PAYMENT_STATUS[p.status]} />
      <dl className={styles.receiptRows}>
        <div>
          <dt>Способ</dt>
          <dd>{PAY_METHOD_LABEL[p.method]}</dd>
        </div>
        <div>
          <dt>{forWhom}</dt>
          <dd>{formatRub(p.base)}</dd>
        </div>
        <div>
          <dt>Сбор сервиса</dt>
          <dd>{formatRub(p.fee)}</dd>
        </div>
        <div className={styles.receiptTotal}>
          <dt>{p.status === 'held' ? 'Заморожено' : 'Сумма'}</dt>
          <dd>{formatRub(p.status === 'held' ? p.initialTotal : p.total)}</dd>
        </div>
        {p.refundedAmount > 0 && (
          <div>
            <dt>Вернули</dt>
            <dd>{formatRub(p.refundedAmount)}</dd>
          </div>
        )}
      </dl>
      {p.test && <p className={styles.testNote}>Тестовая оплата: деньги не списывались.</p>}
    </aside>
  );
}

function Checking({ payment }: { payment?: PaymentView }) {
  return (
    <Shell
      title="Проверяем оплату"
      tone="wait"
      payment={payment}
      lead={
        <p className={styles.checking} role="status">
          <CircleNotchIcon size={22} weight="bold" className={styles.spin} aria-hidden />
          Банк подтверждает платёж. Обычно это несколько секунд, страницу закрывать не нужно.
        </p>
      }
    />
  );
}

function Result({ payment: p, onCheckAgain }: { payment: PaymentView; onCheckAgain: () => void }) {
  const event = p.kind === 'event_share';
  const open = useOpenConfirmation();
  const { start, isPending } = useStartPayment();
  const [retryError, setRetryError] = useState<string | null>(null);
  const backLabel = event ? 'Открыть встречу' : 'Открыть покупку';

  const retry = async () => {
    setRetryError(null);
    try {
      await start({ kind: p.kind, targetId: p.targetId, method: p.method });
    } catch (e) {
      setRetryError(errorMessage(e));
    }
  };

  if (p.status === 'pending' || p.processing) {
    return (
      <Shell
        title="Банк ещё не ответил"
        tone="wait"
        payment={p}
        lead={
          <>
            <p>Как только оплата пройдёт, придёт уведомление. Деньги не потеряются.</p>
            <p>Если вы закрыли страницу банка, не завершив оплату, вернитесь к ней.</p>
          </>
        }
        actions={
          <>
            <Button
              variant="primary"
              icon={<ArrowsClockwiseIcon size={20} aria-hidden />}
              onClick={onCheckAgain}
            >
              Проверить ещё раз
            </Button>
            {p.confirmationUrl && (
              <Button variant="secondary" onClick={() => open(p.confirmationUrl!)}>
                Вернуться к оплате
              </Button>
            )}
            <Button variant="quiet" to={p.link}>
              {backLabel}
            </Button>
          </>
        }
      />
    );
  }

  if (p.status === 'held') {
    return (
      <Shell
        title="Деньги заморожены до встречи"
        tone="ok"
        payment={p}
        lead={
          <>
            <p>
              Вы записаны. На карте заморожено {formatRub(p.initialTotal)}: деньги остаются у вас, пока идёт
              сбор.
            </p>
            <p>
              Перед встречей спишем итоговую долю, остальное разморозится само. Если встреча не состоится,
              заморозку снимем.
            </p>
          </>
        }
        actions={
          <>
            <Button variant="primary" to={p.link}>
              {backLabel}
            </Button>
            <Button variant="secondary" to="/me/money">
              Мои деньги
            </Button>
          </>
        }
      />
    );
  }

  if (p.status === 'paid') {
    return (
      <Shell
        title={event ? 'Оплачено, вы записаны' : 'Оплачено'}
        tone="ok"
        payment={p}
        lead={
          event ? (
            <p>
              Списали {formatRub(p.total)}. Организатор получит свою долю после встречи. Если встречу отменят,
              деньги вернутся полностью.
            </p>
          ) : (
            <>
              <p>Договоритесь с продавцом о передаче: его контакты в покупке.</p>
              <p>Когда заберёте вещь, нажмите «Получил». До подтверждения оплата удерживается.</p>
            </>
          )
        }
        actions={
          <>
            <Button variant="primary" to={p.link}>
              {backLabel}
            </Button>
            <Button variant="secondary" to="/me/money">
              Мои деньги
            </Button>
          </>
        }
      />
    );
  }

  if (p.status === 'refunded' || p.status === 'partially_refunded') {
    return (
      <Shell
        title="Деньги вернули"
        tone="off"
        payment={p}
        lead={
          <p>
            {sentence(p.reason) || 'Возврат оформлен.'} Деньги придут туда же, откуда вы платили. Срок зависит
            от банка.
          </p>
        }
        actions={
          <Button variant="primary" to={p.link}>
            {backLabel}
          </Button>
        }
      />
    );
  }

  return (
    <Shell
      title="Оплата не прошла"
      tone="danger"
      payment={p}
      lead={
        <>
          <p>
            {sentence(p.reason) || 'Деньги не списаны.'} Можно попробовать ещё раз или выбрать другой способ.
          </p>
          {retryError && (
            <p className={styles.error} role="alert">
              {retryError}
            </p>
          )}
        </>
      }
      actions={
        <>
          <Button
            variant="primary"
            loading={isPending}
            loadingText="Открываем оплату…"
            onClick={() => void retry()}
          >
            Оплатить ещё раз
          </Button>
          <Button variant="secondary" to={p.link}>
            Выбрать другой способ
          </Button>
        </>
      }
    />
  );
}
