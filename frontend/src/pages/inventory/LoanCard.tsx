import { CheckIcon, PhoneIcon } from '@phosphor-icons/react';
import { Input } from 'antd';
import { useId, useState } from 'react';
import { Link } from 'react-router';

import { Button, StatusBadge } from '@/components';
import { INVENTORY_API, useAction } from '@/lib/api';
import { count } from '@/lib/plural';
import type { LoanView } from '@/types/inventory';

import { GearPicture } from './GearPicture';
import styles from './inventory.module.css';
import { dateInText, LOAN_STATUS, LOAN_STATUS_FOR_OWNER, quoted } from './labels';

const PIECES = ['штука', 'штуки', 'штук'] as const;

/** Просьба дать вещь: владелец видит «Дать / Отказать / Вернули», просивший — статус и «Отменить». */
export function LoanCard({ loan, audience }: { loan: LoanView; audience: 'owner' | 'requester' }) {
  const { run, isPending } = useAction<LoanView>();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const reasonId = useId();
  const owner = audience === 'owner';
  const upcoming = loan.event.state === 'upcoming';
  const meta = (owner ? LOAN_STATUS_FOR_OWNER : LOAN_STATUS)[loan.status];

  const act = (url: string, payload: Record<string, unknown>, success: string) =>
    void run(url, payload, { success }).catch(() => undefined);

  return (
    <article className={styles.loan}>
      <GearPicture kind={loan.item.kind} name={loan.item.name} size="row" />
      <div className={styles.loanBody}>
        <div className={styles.loanHead}>
          <h3 className={styles.loanTitle}>
            {loan.item.name}, {count(loan.quantity, PIECES)}
          </h3>
          <StatusBadge kind="custom" meta={meta} />
        </div>
        <p className={styles.loanText}>
          {owner ? (
            <>
              Просит {loan.requester.name} на{' '}
              <Link to={`/events/${loan.event.id}`}>«{loan.event.title}»</Link>, {dateInText(loan.event.startsAt)}
            </>
          ) : (
            <>
              От <Link to={loan.ownerView.link}>{quoted(loan.ownerView.name)}</Link> на{' '}
              <Link to={`/events/${loan.event.id}#inventory`}>«{loan.event.title}»</Link>,{' '}
              {dateInText(loan.event.startsAt)}
            </>
          )}
        </p>
        {loan.comment && <p className={styles.quote}>«{loan.comment}»</p>}
        {loan.status === 'rejected' && loan.reason && <p className={styles.note}>Причина: {loan.reason}</p>}
        {loan.contact && (
          <p className={styles.contact}>
            <PhoneIcon size={18} aria-hidden />
            Договоритесь о передаче: <a href={`tel:${loan.contact.replace(/[^\d+]/g, '')}`}>{loan.contact}</a>
          </p>
        )}

        {owner && loan.status === 'pending' && !rejecting && (
          <div className={styles.loanActions}>
            <Button
              size="sm"
              variant="primary"
              icon={<CheckIcon size={18} weight="bold" aria-hidden />}
              loading={isPending}
              disabled={!upcoming}
              onClick={() => act(INVENTORY_API.decideLoan(loan.id), { decision: 'accept' }, 'Договорились. Просивший увидит ваш телефон')}
            >
              Дать
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setRejecting(true)}>
              Отказать
            </Button>
          </div>
        )}
        {owner && rejecting && (
          <div className={styles.reject}>
            <label htmlFor={reasonId} className={styles.fieldLabel}>
              Причина <span className={styles.optional}>необязательно</span>
            </label>
            <Input.TextArea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={300}
              placeholder="В эту субботу мячи нужны нам самим"
            />
            <div className={styles.loanActions}>
              <Button
                size="sm"
                variant="danger"
                loading={isPending}
                onClick={() => {
                  act(INVENTORY_API.decideLoan(loan.id), { decision: 'reject', reason: reason.trim() }, 'Вы отказали. Человек увидит причину');
                  setRejecting(false);
                }}
              >
                Отказать
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setRejecting(false)}>
                Назад
              </Button>
            </div>
          </div>
        )}
        {owner && loan.status === 'accepted' && (
          <div className={styles.loanActions}>
            <Button
              size="sm"
              variant="secondary"
              loading={isPending}
              onClick={() => act(INVENTORY_API.returnLoan(loan.id), {}, 'Выдача закрыта, вещи снова свободны')}
            >
              Вернули
            </Button>
          </div>
        )}
        {!owner && upcoming && (loan.status === 'pending' || loan.status === 'accepted') && (
          <div className={styles.loanActions}>
            <Button
              size="sm"
              variant="quiet"
              loading={isPending}
              onClick={() => act(INVENTORY_API.cancelLoan(loan.id), {}, 'Просьба отменена')}
            >
              Отменить просьбу
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
