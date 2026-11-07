import { CheckIcon, CopyIcon, XIcon } from '@phosphor-icons/react';
import { App, Input, Modal, Segmented } from 'antd';
import { useId, useState } from 'react';

import { Button, EmptyState, ErrorState, StatusBadge } from '@/components';
import { errorMessage, useAction, useLiveGet } from '@/lib/api';
import { dayjs, formatAgo } from '@/lib/dates';
import { formatRub } from '@/lib/money';
import { PAYMENTS_API, PAYMENTS_LIVE } from '@/lib/payments';
import { Field } from '@/pages/events/create/fields';
import { PAYOUT_STATUS } from '@/pages/payments/parts/status';
import type { PayoutStatus, PayoutView } from '@/types/payments';

import { AdminTable, type AdminColumn } from '../parts/AdminTable';
import admin from '../parts/admin.module.css';
import { useUrlParams } from '../parts/hooks';
import styles from './payments.module.css';

type Filter = 'waiting' | 'done' | 'failed' | 'all';

const OPEN: PayoutStatus[] = ['requested', 'processing'];

/** «+7 912 345-67-89» из «+79123456789». */
function prettyPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}` : phone;
}

export function PayoutsTab() {
  const [params, setParams] = useUrlParams({ show: 'waiting' });
  const filter = (['waiting', 'done', 'failed', 'all'] as Filter[]).includes(params.show as Filter)
    ? (params.show as Filter)
    : 'waiting';
  const { data, isLoading, isError, refetch } = useLiveGet<PayoutView[]>(PAYMENTS_API.admin.payouts, [
    ...PAYMENTS_LIVE,
    'admin',
  ]);
  const all = Array.isArray(data) ? data : [];
  const rows = all.filter((x) =>
    filter === 'all' ? true : filter === 'waiting' ? OPEN.includes(x.status) : x.status === filter,
  );
  const waiting = all.filter((x) => OPEN.includes(x.status)).length;
  const [done, setDone] = useState<PayoutView | null>(null);
  const [failing, setFailing] = useState<PayoutView | null>(null);
  const { message } = App.useApp();

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('Номер скопирован');
    } catch {
      message.info(text);
    }
  };

  const columns: AdminColumn<PayoutView>[] = [
    {
      key: 'who',
      title: 'Кому',
      primary: true,
      sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
      defaultSortOrder: 'descend',
      render: (x) => (
        <div className={admin.nameCell}>
          <strong>{x.owner.name}</strong>
          <span className={admin.sub}>
            {x.owner.kind === 'org' ? 'Организация' : 'Пользователь'}, заявка{' '}
            <time dateTime={x.createdAt}>{dayjs(x.createdAt).format('D MMMM, HH:mm')}</time> (
            {formatAgo(x.createdAt)})
          </span>
          {x.doneAt && (
            <span className={admin.sub}>Переведено {dayjs(x.doneAt).format('D MMMM, HH:mm')}</span>
          )}
          {x.reason && <span className={admin.sub}>{x.reason}</span>}
        </div>
      ),
    },
    {
      key: 'sum',
      title: 'Сумма',
      width: 120,
      sorter: (a, b) => a.amount - b.amount,
      render: (x) => <strong className={admin.nowrap}>{formatRub(x.amount)}</strong>,
    },
    {
      key: 'where',
      title: 'Куда, по СБП',
      width: 220,
      render: (x) => (
        <div className={admin.nameCell}>
          <span>{x.bankName}</span>
          {OPEN.includes(x.status) ? (
            <button
              type="button"
              className={styles.copy}
              aria-label={`Скопировать номер ${prettyPhone(x.phone)}`}
              onClick={() => void copy(prettyPhone(x.phone))}
            >
              <CopyIcon size={18} aria-hidden />
              <span className={admin.nowrap}>{prettyPhone(x.phone)}</span>
            </button>
          ) : (
            <span className={[admin.sub, admin.nowrap].join(' ')}>{x.phoneMasked}</span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: 210,
      render: (x) => (
        <div className={styles.cellStack}>
          <span className={admin.nowrap}>
            <StatusBadge kind="custom" meta={PAYOUT_STATUS[x.status]} />
          </span>
          {x.status === 'requested' && (
            <>
              <Button
                size="sm"
                variant="primary"
                icon={<CheckIcon size={18} weight="bold" aria-hidden />}
                onClick={() => setDone(x)}
              >
                Переведено
              </Button>
              <Button
                size="sm"
                variant="quiet"
                icon={<XIcon size={18} aria-hidden />}
                onClick={() => setFailing(x)}
              >
                Не получилось
              </Button>
            </>
          )}
          {x.status === 'processing' && <span className={admin.sub}>Отправляем через ЮKassa</span>}
        </div>
      ),
    },
  ];

  return (
    <div className={styles.stack}>
      <p className={styles.lead}>
        Организатор или продавец просит вывести деньги по СБП. Переведите сумму на указанный номер в выбранный
        банк и нажмите «Переведено». Если перевод не прошёл, нажмите «Не получилось»: деньги вернутся на
        баланс.
      </p>
      <Segmented<Filter>
        value={filter}
        onChange={(show) => setParams({ show })}
        options={[
          { value: 'waiting', label: `Ждут перевода (${waiting})` },
          { value: 'done', label: 'Переведено' },
          { value: 'failed', label: 'Не получилось' },
          { value: 'all', label: 'Все' },
        ]}
      />
      {isError ? (
        <ErrorState title="Не удалось загрузить выплаты" onRetry={() => void refetch()} />
      ) : (
        <AdminTable
          rows={rows}
          rowKey={(x) => x.id}
          columns={columns}
          loading={isLoading}
          caption="Выплаты"
          empty={
            <EmptyState title={filter === 'waiting' ? 'Все выплаты переведены' : 'Здесь пусто'}>
              {filter === 'waiting'
                ? 'Новые заявки на вывод появятся здесь и в сводке.'
                : 'Выплат с таким статусом нет.'}
            </EmptyState>
          }
        />
      )}
      <DoneDialog payout={done} onClose={() => setDone(null)} />
      <FailDialog payout={failing} onClose={() => setFailing(null)} />
    </div>
  );
}

function DoneDialog({ payout, onClose }: { payout: PayoutView | null; onClose: () => void }) {
  const { run, isPending } = useAction();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const submit = async () => {
    if (!payout) return;
    setError(null);
    try {
      await run(PAYMENTS_API.admin.payoutDone(payout.id), note.trim() ? { note: note.trim() } : {}, {
        silent: true,
        success: 'Отмечено. Получателю придёт уведомление',
      });
      setNote('');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal
      open={Boolean(payout)}
      onCancel={onClose}
      title="Отметить перевод"
      footer={null}
      destroyOnHidden
      width={520}
    >
      {payout && (
        <div className={styles.form}>
          <p>
            Вы перевели <b>{formatRub(payout.amount)}</b> получателю «{payout.owner.name}» в {payout.bankName}{' '}
            на номер {prettyPhone(payout.phone)}?
          </p>
          <Field label="Комментарий" htmlFor={noteId} optional hint="Например, номер операции в банке.">
            <Input
              id={noteId}
              size="large"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
            />
          </Field>
          {error && (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          )}
          <div className={styles.formActions}>
            <Button
              variant="primary"
              loading={isPending}
              loadingText="Сохраняем…"
              onClick={() => void submit()}
            >
              Переведено
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function FailDialog({ payout, onClose }: { payout: PayoutView | null; onClose: () => void }) {
  const { run, isPending } = useAction();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const submit = async () => {
    if (!payout) return;
    if (reason.trim().length < 3) {
      setError('Напишите, что не так: получатель увидит причину');
      return;
    }
    setError(null);
    try {
      await run(
        PAYMENTS_API.admin.payoutFail(payout.id),
        { reason: reason.trim() },
        {
          silent: true,
          success: 'Деньги вернулись на баланс получателя',
        },
      );
      setReason('');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal
      open={Boolean(payout)}
      onCancel={onClose}
      title="Перевод не получился"
      footer={null}
      destroyOnHidden
      width={520}
    >
      {payout && (
        <div className={styles.form}>
          <p>
            {formatRub(payout.amount)} вернутся на баланс «{payout.owner.name}». Получатель сможет проверить
            номер и банк и вывести деньги снова.
          </p>
          <Field label="Причина" htmlFor={reasonId} error={error ?? undefined}>
            <Input.TextArea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={300}
              placeholder="Номер не привязан к СБП в этом банке"
            />
          </Field>
          <div className={styles.formActions}>
            <Button
              variant="danger"
              loading={isPending}
              loadingText="Сохраняем…"
              onClick={() => void submit()}
            >
              Не получилось
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
