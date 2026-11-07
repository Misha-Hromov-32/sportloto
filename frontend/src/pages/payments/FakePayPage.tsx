import { CreditCardIcon, DeviceMobileIcon, FlaskIcon, LockSimpleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Button, ErrorState, GoneState, NoAccessState, PageSkeleton } from '@/components';
import { errorMessage, useAction, useMe } from '@/lib/api';
import { formatRub } from '@/lib/money';
import { PAY_METHOD_LABEL, PAYMENTS_API, payReturnPath } from '@/lib/payments';
import type { PaymentView } from '@/types/payments';

import styles from './pay.module.css';
import { usePayment } from './parts/usePayments';

/** Тестовая страница оплаты (провайдер fake): как страница банка, но без списания денег. */
export default function FakePayPage() {
  const { paymentId = '' } = useParams();
  const { isGuest, isLoading: meLoading } = useMe();
  const { payment, isLoading, isError, error, refetch } = usePayment(paymentId);

  let body;
  if (!meLoading && isGuest) {
    body = (
      <NoAccessState guest loginTo={`/pay/fake/${paymentId}`} title="Войдите, чтобы оплатить" layout="inline">
        Оплатить может только тот, кто начал платёж.
      </NoAccessState>
    );
  } else if (isLoading || meLoading) {
    body = <PageSkeleton />;
  } else if (error?.statusCode === 404 || (payment && payment.provider !== 'fake')) {
    body = (
      <GoneState
        layout="inline"
        title="Платёж не найден"
        actions={
          <Button variant="primary" to="/me/money">
            Мои деньги
          </Button>
        }
      >
        Ссылка устарела или платёж оформлен через другой банк.
      </GoneState>
    );
  } else if (isError || !payment) {
    body = (
      <ErrorState layout="inline" title="Не удалось открыть оплату" onRetry={() => void refetch()}>
        Проверьте интернет и попробуйте ещё раз. Деньги не списаны.
      </ErrorState>
    );
  } else {
    body = <Checkout payment={payment} />;
  }

  return (
    <div className={styles.bank}>
      <p className={styles.testBar} role="note">
        <FlaskIcon size={22} weight="bold" aria-hidden />
        Тестовая оплата: деньги не списываются
      </p>
      <main className={styles.bankWrap}>
        <div className={styles.bankBrand}>
          <span className={styles.bankBrandName}>
            <LockSimpleIcon size={20} weight="bold" aria-hidden />
            Безопасная оплата
          </span>
          <span>Тестовый магазин</span>
        </div>
        {body}
      </main>
    </div>
  );
}

function Checkout({ payment: p }: { payment: PaymentView }) {
  const navigate = useNavigate();
  const { run } = useAction();
  const [busy, setBusy] = useState<'succeeded' | 'canceled' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = p.status !== 'pending';
  const hold = !p.capture;
  const amount = p.initialTotal || p.total;

  const finish = async (outcome: 'succeeded' | 'canceled') => {
    setBusy(outcome);
    setError(null);
    try {
      await run(PAYMENTS_API.fakeOutcome(p.id), { outcome }, { silent: true });
      navigate(payReturnPath(p.id), { replace: true });
    } catch (e) {
      setError(errorMessage(e, 'Не получилось. Попробуйте ещё раз'));
      setBusy(null);
    }
  };

  return (
    <section className={styles.bankCard} aria-labelledby="bank-sum">
      <div className={styles.bankSum}>
        <span>{hold ? 'Будет заморожено на карте' : 'К оплате'}</span>
        <strong id="bank-sum">{formatRub(amount)}</strong>
      </div>
      <dl className={styles.bankRows}>
        <div>
          <dt>Получатель</dt>
          <dd>Спорт и точка</dd>
        </div>
        <div>
          <dt>За что</dt>
          <dd>{p.title}</dd>
        </div>
        <div>
          <dt>Способ</dt>
          <dd>{PAY_METHOD_LABEL[p.method]}</dd>
        </div>
      </dl>
      <p className={styles.bankMethod}>
        {p.method === 'sbp' ? (
          <DeviceMobileIcon size={28} aria-hidden />
        ) : (
          <CreditCardIcon size={28} aria-hidden />
        )}
        {p.method === 'sbp'
          ? 'Обычно оплату по СБП подтверждают в приложении банка. Здесь достаточно нажать «Оплатить».'
          : hold
            ? 'Деньги заморозятся на карте и спишутся позже. Вводить данные карты здесь не нужно.'
            : 'Вводить данные карты здесь не нужно: нажмите «Оплатить».'}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {done ? (
        <div className={styles.bankActions}>
          <p>Этот платёж уже обработан.</p>
          <Button variant="primary" size="lg" block to={payReturnPath(p.id)}>
            Посмотреть результат
          </Button>
        </div>
      ) : (
        <div className={styles.bankActions}>
          <Button
            variant="primary"
            size="lg"
            block
            loading={busy === 'succeeded'}
            loadingText="Оплачиваем…"
            disabled={busy !== null}
            onClick={() => void finish('succeeded')}
          >
            Оплатить {formatRub(amount)}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            block
            loading={busy === 'canceled'}
            loadingText="Отменяем…"
            disabled={busy !== null}
            onClick={() => void finish('canceled')}
          >
            Отказаться
          </Button>
        </div>
      )}
      <p className={styles.bankFoot}>После оплаты вернём вас на сайт «Спорт и точка».</p>
    </section>
  );
}
