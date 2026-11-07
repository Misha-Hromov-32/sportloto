import { CheckIcon, TicketIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import { useState } from 'react';

import { Button, type ButtonSize } from '@/components';
import { API, useAction } from '@/lib/api';
import { formatEventDate } from '@/lib/dates';
import type { EventView } from '@/types/api';

import { offerDeadline, offerTitle, useOfferCountdown } from './offer';
import styles from './participation.module.css';

/** С4: «Иду» и «Отказаться» для места, придержанного из листа ожидания. */
export function OfferActions({ event: e, size = 'md' }: { event: EventView; size?: ButtonSize }) {
  const { run } = useAction();
  const { modal } = App.useApp();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);

  const go = async (kind: 'accept' | 'decline') => {
    setBusy(kind);
    try {
      await run(
        kind === 'accept' ? API.acceptOffer(e.id) : API.declineOffer(e.id),
        {},
        { success: kind === 'accept' ? `Вы идёте на «${e.title}»` : 'Вы отказались от места' },
      );
    } catch {
      /* текст ошибки уже показан */
    } finally {
      setBusy(null);
    }
  };

  const decline = () =>
    modal.confirm({
      title: `Отказаться от места на «${e.title}»?`,
      content: 'Вы выйдете из листа ожидания, а место предложим следующему в очереди.',
      okText: 'Отказаться от места',
      cancelText: 'Подумаю ещё',
      okButtonProps: { danger: true },
      onOk: () => go('decline'),
    });

  return (
    <div className={styles.actions}>
      <Button
        variant="primary"
        size={size}
        icon={<CheckIcon size={20} weight="bold" aria-hidden />}
        loading={busy === 'accept'}
        loadingText="Записываем…"
        disabled={busy !== null}
        onClick={() => void go('accept')}
      >
        Иду
      </Button>
      <Button
        variant="secondary"
        size={size}
        loading={busy === 'decline'}
        loadingText="Отказываемся…"
        disabled={busy !== null}
        onClick={decline}
      >
        Отказаться
      </Button>
    </div>
  );
}

/** Состояние записи в карточке, пока место придержано за человеком. */
export function OfferNote({ event: e, flash }: { event: EventView; flash?: boolean }) {
  const until = e.my?.offerUntil ?? null;
  const left = useOfferCountdown(until);
  if (!until) return null;
  return (
    <div
      key={until}
      className={[styles.note, styles['note-accent'], flash && 'status-flash'].filter(Boolean).join(' ')}
    >
      <p className={styles.noteTitle}>
        <TicketIcon size={20} weight="fill" aria-hidden />
        {offerTitle(until)}
      </p>
      <div className={styles.noteText}>
        <p>
          Освободилось место на встрече: {formatEventDate(e.startsAt).toLowerCase()}. Подтвердите{' '}
          {offerDeadline(until)}, иначе место перейдёт следующему в очереди.
        </p>
        {left && <p className={styles.countdown}>{left}</p>}
      </div>
      <OfferActions event={e} size="lg" />
    </div>
  );
}
