import { CaretDownIcon, WalletIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { Avatar, Button, ErrorState, SkeletonBlock, StatusBadge } from '@/components';
import { useLiveGet } from '@/lib/api';
import { dayjs, formatEventDate } from '@/lib/dates';
import { formatRub } from '@/lib/money';
import { PAY_METHOD_LABEL, PAYMENTS_API, PAYMENTS_LIVE, splitFinalShare } from '@/lib/payments';
import { count, WORDS } from '@/lib/plural';
import { MY_PAYMENT_STATUS } from '@/pages/payments/parts/status';
import type { EventDetails } from '@/types/api';
import type { EventMoneyRow, EventMoneyView } from '@/types/payments';

import styles from './money.module.css';

const UNPAID = new Set(['required', 'pending', 'not_yet']);

/** Деньги встречи для организатора: сколько собрано, кто заплатил, когда придут деньги. */
export function EventMoneyPanel({ event }: { event: EventDetails }) {
  const enabled = event.paymentMode === 'online' && event.price.kind !== 'free';
  const { data, isLoading, isError, error, refetch } = useLiveGet<EventMoneyView>(
    PAYMENTS_API.eventMoney(event.id),
    PAYMENTS_LIVE,
    enabled,
  );
  if (!enabled || error?.statusCode === 403) return null;

  return (
    <section id="money" className={styles.panel} aria-labelledby="money-title">
      <header className={styles.head}>
        <h2 id="money-title" className={styles.title}>
          <WalletIcon size={24} aria-hidden />
          Оплата
        </h2>
        <span className={styles.mode}>На сайте, по СБП или картой</span>
      </header>
      {isLoading ? (
        <div className={styles.skeleton} role="status" aria-live="polite">
          <span className="sr-only">Загружаем оплату…</span>
          <SkeletonBlock height={72} />
          <SkeletonBlock height={120} />
        </div>
      ) : isError || !data ? (
        <ErrorState title="Не удалось загрузить оплату" onRetry={() => void refetch()} />
      ) : (
        <MoneyBody money={data} event={event} />
      )}
    </section>
  );
}

function MoneyBody({ money: m, event }: { money: EventMoneyView; event: EventDetails }) {
  const split = m.priceKind === 'split';
  const percent = m.expected > 0 ? Math.min(100, Math.round((m.collected / m.expected) * 100)) : 0;
  const paidRows = m.rows.filter((r) => !UNPAID.has(r.status));
  const unpaidRows = m.rows.filter((r) => UNPAID.has(r.status));
  const past = event.state === 'past';
  const payers = m.paidCount + m.heldCount;

  return (
    <div className={styles.body}>
      <div className={styles.numbers}>
        <div className={styles.big}>
          <span className={styles.bigLabel}>Собрано</span>
          <strong>{formatRub(m.collected)}</strong>
          <span className={styles.bigSub}>
            {m.expected > 0 ? `из ${formatRub(m.expected)}` : 'пока никто не платил'}
          </span>
          {m.expected > 0 && (
            <div
              className={styles.bar}
              role="progressbar"
              aria-label="Сколько собрано"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>
        <dl className={styles.counts}>
          <div>
            <dt>Оплатили</dt>
            <dd>{m.paidCount}</dd>
          </div>
          {split && (
            <div>
              <dt>Заморозили на карте</dt>
              <dd>{m.heldCount}</dd>
            </div>
          )}
          <div className={m.unpaidCount ? styles.countWait : undefined}>
            <dt>Ещё не оплатили</dt>
            <dd>{m.unpaidCount}</dd>
          </div>
        </dl>
      </div>

      {split && <SplitLine money={m} payers={payers} min={event.minParticipants} />}

      <div className={styles.credit}>
        {m.credited > 0 ? (
          <p>
            <strong>Зачислено вам: {formatRub(m.credited)}.</strong> Деньги на балансе, вывести их можно по
            СБП.
          </p>
        ) : (
          <p>
            <strong>
              {past ? 'Скоро зачислим' : 'Придёт вам после встречи'}: {formatRub(m.toCredit)}.
            </strong>{' '}
            Это ваша сумма без сбора сервиса. Деньги появятся на балансе, когда встреча закончится.
          </p>
        )}
        {m.refunded > 0 && <p>Вернули участникам: {formatRub(m.refunded)}.</p>}
        <Button variant="secondary" size="sm" to="/me/money">
          Мои деньги и вывод
        </Button>
      </div>

      {unpaidRows.length > 0 && (
        <div>
          <h3 className={styles.subhead}>Ещё не оплатили: {unpaidRows.length}</h3>
          <p className={styles.note}>
            Сайт сам напоминает об оплате. Если срок выйдет, запись снимется и место получит следующий из
            листа ожидания.
          </p>
          <ul className={styles.rows}>
            {unpaidRows.map((r) => (
              <MoneyRow key={r.participationId} row={r} />
            ))}
          </ul>
        </div>
      )}

      {paidRows.length > 0 ? (
        <details className={styles.more} open={paidRows.length <= 6}>
          <summary>
            <CaretDownIcon size={18} weight="bold" aria-hidden className={styles.caret} />
            Кто оплатил: {paidRows.length}
          </summary>
          <ul className={styles.rows}>
            {paidRows.map((r) => (
              <MoneyRow key={r.participationId} row={r} />
            ))}
          </ul>
        </details>
      ) : (
        !unpaidRows.length && (
          <p className={styles.note}>
            Когда участники запишутся и оплатят, здесь появится список. Платить начнут{' '}
            {m.opensAt && dayjs(m.opensAt).isAfter(dayjs())
              ? dayjs(m.opensAt).format('D MMMM')
              : 'сразу после записи'}
            .
          </p>
        )
      )}
    </div>
  );
}

function SplitLine({ money: m, payers, min }: { money: EventMoneyView; payers: number; min: number | null }) {
  if (m.collect?.outcome === 'collected') {
    return (
      <p className={styles.split}>
        Складчина собрана {dayjs(m.collect.at).format('D MMMM в HH:mm')}: итоговая доля{' '}
        {formatRub(m.collect.share ?? 0)}, заплатили {count(m.collect.paidCount, WORDS.person)}.
      </p>
    );
  }
  if (m.collect?.outcome === 'failed') {
    return (
      <p className={[styles.split, styles.splitFailed].join(' ')}>
        Порог не набрался: заморозку сняли, оплаты по СБП вернули. Встреча остаётся в афише, решите сами,
        проводить ли её.
      </p>
    );
  }
  const share = payers > 0 ? splitFinalShare(m.price, payers) : null;
  const short = min !== null && payers < min;
  return (
    <div className={styles.split}>
      <p>
        <b>{m.collectAt ? `Сбор: ${formatEventDate(m.collectAt).toLowerCase()}.` : 'Сбор перед встречей.'}</b>{' '}
        Спишем итоговую долю с каждого, кто оплатил.
        {m.opensAt &&
          dayjs(m.opensAt).isAfter(dayjs()) &&
          ` Оплата откроется ${dayjs(m.opensAt).format('D MMMM')}.`}
      </p>
      {short ? (
        <p>
          Оплатили {payers} из {count(min, WORDS.person)}. Если к сбору не наберётся {min}, заморозку снимем,
          а оплаты по СБП вернём.
        </p>
      ) : (
        share !== null && <p>Если собрать сейчас, доля будет {formatRub(share)}.</p>
      )}
    </div>
  );
}

function MoneyRow({ row: r }: { row: EventMoneyRow }) {
  const when =
    r.paidAt && !UNPAID.has(r.status)
      ? `Оплата ${dayjs(r.paidAt).format('D MMMM, HH:mm')}`
      : r.dueAt
        ? `${r.status === 'held' ? 'Спишем' : 'Оплатить до'} ${dayjs(r.dueAt).format('D MMMM, HH:mm')}`
        : '';
  return (
    <li className={styles.row}>
      <Avatar name={r.user.name} initials={r.user.initials} src={r.user.avatarUrl} size={40} />
      <div className={styles.rowBody}>
        <Link to={`/profile/${r.user.id}`} className={styles.rowName}>
          {r.user.name}
        </Link>
        <span className={styles.rowMeta}>
          {[formatRub(r.base), r.method ? PAY_METHOD_LABEL[r.method] : null, when]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <StatusBadge kind="custom" meta={MY_PAYMENT_STATUS[r.status]} />
    </li>
  );
}
