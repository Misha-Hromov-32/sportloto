import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  CreditCardIcon,
  DeviceMobileIcon,
  LockSimpleIcon,
  SnowflakeIcon,
} from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';

import { Button, ErrorState, SkeletonBlock } from '@/components';
import { errorMessage } from '@/lib/api';
import { formatRub } from '@/lib/money';
import { PAY_METHOD_LABEL } from '@/lib/payments';
import { count, WORDS } from '@/lib/plural';
import type { PaymentKind, PayMethod, QuoteLine, QuoteView } from '@/types/payments';

import { FeeTable } from './FeeTable';
import { PaySheet } from './PaySheet';
import styles from './payments.module.css';
import { useQuote, useStartPayment } from './usePayments';

export interface SplitInfo {
  /** Сумма складчины на всех. */
  total: number;
  minParticipants: number | null;
  /** Доля, если сбор был бы сейчас. */
  currentShare: number;
}

interface PayDialogProps {
  open: boolean;
  onClose: () => void;
  kind: PaymentKind;
  /** По чему считать сумму: встреча или вещь. */
  quoteTargetId: string;
  quantity?: number;
  title: string;
  /** Что оплачиваем и когда: «Волейбол в парке», «Суббота, 25 октября, 10:00». */
  what: string;
  when?: string;
  split?: SplitInfo | null;
  /** До оплаты: например, оформить заказ. Возвращает, за что платим. */
  prepare?: () => Promise<string>;
  /** За что платим, если подготовка не нужна. */
  paymentTargetId?: string;
  note?: ReactNode;
  /** Над выбором способа: например, сколько штук. */
  before?: ReactNode;
}

const METHOD_ICON: Record<PayMethod, ReactNode> = {
  sbp: <DeviceMobileIcon size={24} aria-hidden />,
  bank_card: <CreditCardIcon size={24} aria-hidden />,
};

const METHOD_TEXT: Record<PayMethod, string> = {
  sbp: 'Через приложение вашего банка',
  bank_card: 'Мир, Visa или Mastercard',
};

/** Окно оплаты: способ, итог у каждого способа, из чего сумма, и переход на страницу банка. */
export function PayDialog(props: PayDialogProps) {
  const { open, onClose, title } = props;
  return (
    <PaySheet open={open} onClose={onClose} title={title}>
      {open && <PayBody {...props} />}
    </PaySheet>
  );
}

function PayBody({
  onClose,
  kind,
  quoteTargetId,
  quantity = 1,
  what,
  when,
  split,
  prepare,
  paymentTargetId,
  note,
  before,
}: PayDialogProps) {
  const { data, isLoading, isError, refetch } = useQuote(kind, quoteTargetId, quantity);
  const lines = data?.lines ?? [];
  const [picked, setPicked] = useState<PayMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const { start, isPending } = useStartPayment();
  const groupId = useId();

  const method = picked ?? cheapest(lines)?.method ?? null;
  const line = lines.find((l) => l.method === method) ?? null;

  const pay = async () => {
    if (!line) return;
    setError(null);
    try {
      let target = paymentTargetId ?? '';
      if (prepare) {
        setPreparing(true);
        target = await prepare();
      }
      await start({ kind, targetId: target, method: line.method });
    } catch (e) {
      setError(errorMessage(e, 'Не получилось открыть оплату. Попробуйте ещё раз'));
    } finally {
      setPreparing(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.payBody} role="status" aria-live="polite">
        <span className="sr-only">Считаем сумму…</span>
        <SkeletonBlock height={24} width="60%" />
        <SkeletonBlock height={88} radius="media" />
        <SkeletonBlock height={88} radius="media" />
      </div>
    );
  }
  if (isError || !data || !lines.length) {
    return (
      <ErrorState title="Не удалось посчитать сумму" onRetry={() => void refetch()}>
        Проверьте интернет и попробуйте ещё раз. Деньги не списаны.
      </ErrorState>
    );
  }

  const sbp = lines.find((l) => l.method === 'sbp');
  const card = lines.find((l) => l.method === 'bank_card');
  const forWhom = kind === 'event_share' ? 'event' : 'item';

  return (
    <div className={styles.payBody}>
      <div className={styles.payWhat}>
        <p className={styles.payTitle}>{what}</p>
        {when && <p className={styles.payWhen}>{when}</p>}
      </div>

      {before}

      <div className={styles.methods} role="radiogroup" aria-labelledby={groupId}>
        <p id={groupId} className={styles.methodsLabel}>
          Как оплатить
        </p>
        {lines.map((l) => {
          const active = l.method === method;
          const cheaper = l.method === 'sbp' && card && sbp && sbp.total < card.total;
          return (
            <button
              key={l.method}
              type="button"
              role="radio"
              aria-checked={active}
              className={[styles.method, active && styles.methodActive].filter(Boolean).join(' ')}
              onClick={() => setPicked(l.method)}
            >
              <span className={styles.methodRadio} aria-hidden>
                {active && <CheckIcon size={14} weight="bold" />}
              </span>
              <span className={styles.methodIcon}>{METHOD_ICON[l.method]}</span>
              <span className={styles.methodBody}>
                <span className={styles.methodName}>
                  {PAY_METHOD_LABEL[l.method]}
                  {cheaper && <span className={styles.cheaper}>Дешевле</span>}
                </span>
                <span className={styles.methodText}>{METHOD_TEXT[l.method]}</span>
              </span>
              <span className={styles.methodSum}>
                <strong>{formatRub(l.total)}</strong>
                <span>сбор {formatRub(l.fee)}</span>
              </span>
            </button>
          );
        })}
        {sbp && card && sbp.total < card.total && (
          <p className={styles.methodsHint}>
            По СБП дешевле: сбор {formatRub(sbp.fee)} вместо {formatRub(card.fee)}.
          </p>
        )}
      </div>

      {line && (
        <FeeTable
          line={line}
          forWhom={forWhom}
          total={line.total}
          markup={data.markup}
          totalLabel={line.flow === 'hold' ? 'Заморозим на карте' : undefined}
        />
      )}

      {line && split && <SplitNote line={line} quote={data} split={split} />}

      {note && <div className={styles.payNote}>{note}</div>}

      <p className={styles.secure}>
        <LockSimpleIcon size={18} aria-hidden />
        Оплата пройдёт на странице банка. Данные карты сервис не видит.
      </p>

      {error && (
        <p className={styles.payError} role="alert">
          {error}
        </p>
      )}

      <div className={styles.payActions}>
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!line}
          loading={isPending || preparing}
          loadingText="Открываем оплату…"
          onClick={() => void pay()}
        >
          Перейти к оплате
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Не сейчас
        </Button>
      </div>
    </div>
  );
}

function cheapest(lines: QuoteLine[]): QuoteLine | null {
  return lines.reduce<QuoteLine | null>((best, l) => (!best || l.total < best.total ? l : best), null);
}

function SplitNote({ line, quote, split }: { line: QuoteLine; quote: QuoteView; split: SplitInfo }) {
  if (line.flow === 'charge') return null;
  const max = quote.maxShare ?? line.base;
  const current = Math.min(split.currentShare, max);
  const hold = line.flow === 'hold';
  return (
    <div className={styles.splitNote}>
      <p className={styles.splitTitle}>
        {hold ? <SnowflakeIcon size={20} aria-hidden /> : <ArrowCounterClockwiseIcon size={20} aria-hidden />}
        {hold
          ? `Заморозим до ${formatRub(line.total)}`
          : `Спишем ${formatRub(line.total)} сразу, разницу вернём`}
      </p>
      <p>
        {hold
          ? 'Деньги останутся на карте. Перед встречей спишем вашу долю, остальное разморозится само.'
          : 'Перед встречей пересчитаем долю. Если людей будет больше, разницу вернём на счёт.'}
      </p>
      <p>
        {hold
          ? `Сейчас ваша доля ${formatRub(current)}. Чем больше людей оплатит, тем она меньше.`
          : `Сейчас ваша доля ${formatRub(current)}. Чем больше людей оплатит, тем больше вернём.`}
      </p>
      {split.minParticipants && (
        <p>Если не наберётся {count(split.minParticipants, WORDS.person)}, деньги вернутся полностью.</p>
      )}
    </div>
  );
}
