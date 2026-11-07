import { ArrowCounterClockwiseIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { Input, InputNumber, Modal, Select } from 'antd';
import { useId, useState } from 'react';
import { Link } from 'react-router';

import { Button, EmptyState, ErrorState, StatusBadge } from '@/components';
import { errorMessage, useAction, useLiveGet } from '@/lib/api';
import { dayjs, formatAgo } from '@/lib/dates';
import { formatRub } from '@/lib/money';
import {
  formatMoney,
  PAY_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENTS_API,
  PAYMENTS_LIVE,
} from '@/lib/payments';
import { Field } from '@/pages/events/create/fields';
import { PAYMENT_STATUS, sentence } from '@/pages/payments/parts/status';
import type { AdminPaymentView, PaymentKind, PaymentStatus } from '@/types/payments';

import { AdminTable, type AdminColumn } from '../parts/AdminTable';
import admin from '../parts/admin.module.css';
import { Filters } from '../parts/Filters';
import { useSearchField, useUrlParams } from '../parts/hooks';
import styles from './payments.module.css';

const OP_KIND: Record<string, string> = {
  capture: 'Списание',
  cancel: 'Снятие заморозки',
  refund: 'Возврат',
  payout: 'Выплата',
};

const OP_STATUS: Record<string, string> = {
  queued: 'в очереди',
  sending: 'отправляется',
  done: 'выполнено',
  failed: 'ошибка',
};

export function PaymentsTab() {
  const [params, setParams] = useUrlParams({ q: '', status: '', kind: '' });
  const [text, setText] = useSearchField(params.q, (q) => setParams({ q }));
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  if (params.kind) query.set('kind', params.kind);
  const qs = query.toString();
  const { data, isLoading, isError, refetch } = useLiveGet<AdminPaymentView[]>(
    `${PAYMENTS_API.admin.payments}${qs ? `?${qs}` : ''}`,
    [...PAYMENTS_LIVE, 'admin'],
  );
  const rows = Array.isArray(data) ? data : [];
  const [refunding, setRefunding] = useState<AdminPaymentView | null>(null);
  const filtered = Boolean(params.q || params.status || params.kind);

  const columns: AdminColumn<AdminPaymentView>[] = [
    {
      key: 'what',
      title: 'Платёж',
      primary: true,
      sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
      defaultSortOrder: 'descend',
      render: (p) => (
        <div className={admin.nameCell}>
          <Link to={p.link} className={admin.nameLink}>
            {p.title}
          </Link>
          <span className={admin.sub}>
            {p.user.name}, {p.kind === 'event_share' ? 'встреча' : 'вещь с полки'}
          </span>
          <span className={admin.sub}>
            <time dateTime={p.createdAt}>{dayjs(p.createdAt).format('D MMMM, HH:mm')}</time> (
            {formatAgo(p.createdAt)}), № {p.id}
          </span>
          {p.reason && <span className={admin.sub}>{sentence(p.reason)}</span>}
          <OpsLine p={p} />
        </div>
      ),
    },
    {
      key: 'sum',
      title: 'Сумма',
      width: 190,
      sorter: (a, b) => a.total - b.total,
      render: (p) => (
        <div className={admin.nameCell}>
          <strong className={admin.nowrap}>
            {formatRub(p.status === 'held' ? p.initialTotal : p.total)}, {PAY_METHOD_LABEL[p.method]}
          </strong>
          <span className={admin.sub}>
            получателю {formatRub(p.base)}, сбор {formatRub(p.fee)}
          </span>
          {p.refundedAmount > 0 && <span className={admin.sub}>вернули {formatMoney(p.refundedAmount)}</span>}
        </div>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: 200,
      render: (p) => (
        <div className={styles.cellStack}>
          <span className={admin.nowrap}>
            <StatusBadge kind="custom" meta={PAYMENT_STATUS[p.status]} />
          </span>
          {(p.refundable > 0 || p.status === 'held') && (
            <Button
              size="sm"
              variant="secondary"
              icon={<ArrowCounterClockwiseIcon size={18} aria-hidden />}
              onClick={() => setRefunding(p)}
            >
              Вернуть
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={styles.stack}>
      <Filters
        active={[params.status, params.kind].filter(Boolean).length}
        search={
          <Input
            className={admin.search}
            value={text}
            onChange={(e) => setText(e.target.value)}
            allowClear
            prefix={<MagnifyingGlassIcon size={20} aria-hidden />}
            placeholder="Название, имя или номер платежа"
            aria-label="Поиск платежей"
          />
        }
      >
        <Select
          className={admin.select}
          value={params.status || ''}
          onChange={(status) => setParams({ status })}
          aria-label="Статус"
          options={[
            { value: '', label: 'Все статусы' },
            ...(Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[]).map((s) => ({
              value: s,
              label: PAYMENT_STATUS_LABEL[s],
            })),
          ]}
        />
        <Select
          className={admin.select}
          value={params.kind || ''}
          onChange={(kind) => setParams({ kind })}
          aria-label="За что"
          options={[
            { value: '', label: 'Встречи и вещи' },
            { value: 'event_share' satisfies PaymentKind, label: 'Только встречи' },
            { value: 'item_order' satisfies PaymentKind, label: 'Только вещи' },
          ]}
        />
      </Filters>

      {isError ? (
        <ErrorState title="Не удалось загрузить платежи" onRetry={() => void refetch()} />
      ) : (
        <AdminTable
          rows={rows}
          rowKey={(p) => p.id}
          columns={columns}
          loading={isLoading}
          caption="Платежи"
          empty={
            <EmptyState
              title={filtered ? 'Таких платежей нет' : 'Платежей пока нет'}
              actions={
                filtered ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setText('');
                      setParams({ q: '', status: '', kind: '' });
                    }}
                  >
                    Сбросить фильтры
                  </Button>
                ) : undefined
              }
            >
              {filtered
                ? 'Попробуйте другой статус или уберите поиск.'
                : 'Когда люди начнут платить за встречи и вещи на сайте, платежи появятся здесь.'}
            </EmptyState>
          }
        />
      )}

      <RefundDialog payment={refunding} onClose={() => setRefunding(null)} />
    </div>
  );
}

function OpsLine({ p }: { p: AdminPaymentView }) {
  const failed = p.ops.filter((o) => o.status === 'failed');
  const going = p.ops.filter((o) => o.status === 'queued' || o.status === 'sending');
  if (!failed.length && !going.length) return null;
  return (
    <span className={failed.length ? styles.opsBad : admin.sub}>
      {[...failed, ...going]
        .map(
          (o) =>
            `${OP_KIND[o.kind] ?? o.kind}${o.amount !== null ? ` ${formatMoney(o.amount)}` : ''}: ${OP_STATUS[o.status] ?? o.status}${o.error ? ` (${o.error})` : ''}`,
        )
        .join('; ')}
    </span>
  );
}

function RefundDialog({ payment, onClose }: { payment: AdminPaymentView | null; onClose: () => void }) {
  return (
    <Modal
      open={Boolean(payment)}
      onCancel={onClose}
      title="Вернуть деньги"
      footer={null}
      destroyOnHidden
      width={560}
    >
      {payment && <RefundForm payment={payment} onClose={onClose} />}
    </Modal>
  );
}

function RefundForm({ payment: p, onClose }: { payment: AdminPaymentView; onClose: () => void }) {
  const held = p.status === 'held';
  const max = held ? p.initialTotal : p.refundable;
  const [amount, setAmount] = useState<number | null>(max);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { run, isPending } = useAction<AdminPaymentView>();
  const ids = { amount: useId(), reason: useId() };

  const check = () => {
    const local: Record<string, string> = {};
    if (reason.trim().length < 5) local.reason = 'Напишите причину, её увидит плательщик';
    if (!held && !(amount && amount > 0 && amount <= max)) local.amount = `От 1 до ${formatMoney(max)}`;
    setErrors(local);
    if (!Object.keys(local).length) setConfirming(true);
  };

  const submit = async () => {
    setError(null);
    try {
      await run(
        PAYMENTS_API.admin.refund(p.id),
        { reason: reason.trim(), ...(held ? {} : { amount }) },
        {
          silent: true,
          success: held ? 'Заморозку сняли' : 'Возврат оформлен, плательщику придёт уведомление',
        },
      );
      onClose();
    } catch (e) {
      const fields = (e as { errors?: Record<string, string> }).errors;
      if (fields) setErrors(fields);
      setConfirming(false);
      setError(errorMessage(e));
    }
  };

  return (
    <div className={styles.form}>
      <div className={styles.formFacts}>
        <p>
          <b>{p.title}</b>
        </p>
        <p>
          {p.user.name}, {PAY_METHOD_LABEL[p.method]}, {held ? 'заморожено' : 'оплачено'}{' '}
          {formatRub(held ? p.initialTotal : p.capturedAmount)}
          {p.refundedAmount > 0 && `, уже вернули ${formatMoney(p.refundedAmount)}`}
        </p>
      </div>
      {held ? (
        <p>Деньги заморожены на карте. Заморозку снимем целиком, ничего не спишется.</p>
      ) : (
        <Field
          label="Сколько вернуть"
          htmlFor={ids.amount}
          error={errors.amount}
          hint={`Можно вернуть до ${formatMoney(max)}. Комиссию банка ЮKassa при возврате не возвращает.`}
        >
          <InputNumber
            id={ids.amount}
            size="large"
            className={styles.amount}
            min={1}
            max={max}
            precision={2}
            decimalSeparator=","
            suffix="₽"
            value={amount}
            onChange={(v) => setAmount(v === null ? null : Number(v))}
            status={errors.amount ? 'error' : undefined}
          />
        </Field>
      )}
      <Field
        label="Причина"
        htmlFor={ids.reason}
        error={errors.reason}
        hint="Плательщик увидит её в уведомлении."
      >
        <Input.TextArea
          id={ids.reason}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 4 }}
          maxLength={300}
          placeholder="Встреча не состоялась по вине площадки"
        />
      </Field>
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      {confirming ? (
        <div className={styles.confirmBox} role="alertdialog" aria-labelledby="refund-confirm">
          <p id="refund-confirm">
            <b>
              {held ? 'Снять заморозку' : `Вернуть ${formatMoney(amount ?? 0)}`} для {p.user.name}?
            </b>{' '}
            Отменить возврат нельзя.
          </p>
          <div className={styles.formActions}>
            <Button
              variant="danger"
              loading={isPending}
              loadingText="Возвращаем…"
              onClick={() => void submit()}
            >
              {held ? 'Снять заморозку' : 'Вернуть деньги'}
            </Button>
            <Button variant="quiet" onClick={() => setConfirming(false)}>
              Назад
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.formActions}>
          <Button variant="primary" onClick={check}>
            Продолжить
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Отмена
          </Button>
        </div>
      )}
    </div>
  );
}
