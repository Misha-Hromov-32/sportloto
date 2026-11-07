import { CheckCircleIcon, FlagIcon } from '@phosphor-icons/react';
import { App, Input, Modal, Radio } from 'antd';
import { useId, useState } from 'react';

import { Button } from '@/components';
import { COMMUNITY_API, useAction, useLiveGet, useMe } from '@/lib/api';
import type { EventDetails, MessageView } from '@/types/api';
import type { MyReportState, Report, ReportReason, ReportTarget } from '@/types/community';

import discussion from '../Discussion.module.css';
import styles from './report.module.css';

const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: 'spam', label: 'Спам или реклама', hint: 'Продают вещи, зовут в другие чаты' },
  { value: 'fraud', label: 'Мошенничество', hint: 'Просят предоплату, обещают то, чего нет' },
  { value: 'abuse', label: 'Оскорбления', hint: 'Грубость, унижение, угрозы' },
  { value: 'danger', label: 'Опасно для участников', hint: 'Небезопасное место или занятие' },
  { value: 'other', label: 'Другое', hint: 'Опишите в комментарии' },
];

function ReportDialog({
  open,
  target,
  targetId,
  title,
  onClose,
  onDone,
}: {
  open: boolean;
  target: ReportTarget;
  targetId: string;
  title: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const { run, isPending } = useAction<{ report: Report; duplicate: boolean }>();
  const { modal } = App.useApp();
  const id = useId();

  const send = async () => {
    if (!reason) {
      setError('Выберите причину');
      return;
    }
    if (reason === 'other' && comment.trim().length < 5) {
      setError('Напишите, что не так: хотя бы несколько слов');
      return;
    }
    setError('');
    try {
      const res = await run(COMMUNITY_API.report, { targetType: target, targetId, reason, comment }, { silent: true });
      onDone();
      onClose();
      modal.success({
        title: res.duplicate ? 'Вы уже жаловались' : 'Жалоба отправлена',
        content: res.duplicate
          ? 'Ваша прошлая жалоба у администратора. Когда он решит, придёт уведомление.'
          : 'Администратор проверит и примет решение. Вы получите уведомление. Автор не узнает, кто пожаловался.',
        okText: 'Понятно',
      });
    } catch (e) {
      setError((e as { message?: string }).message ?? 'Жалоба не отправлена. Попробуйте ещё раз');
    }
  };

  return (
    <Modal
      open={open}
      title={target === 'event' ? 'Пожаловаться на событие' : 'Пожаловаться на сообщение'}
      onCancel={isPending ? undefined : onClose}
      destroyOnHidden
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Не отправлять
          </Button>
          <Button variant="primary" onClick={() => void send()} loading={isPending} loadingText="Отправляем…">
            Отправить жалобу
          </Button>
        </div>
      }
    >
      <div className={styles.body}>
        <p className={styles.subject}>{title}</p>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Что не так</legend>
          <Radio.Group value={reason} onChange={(e) => setReason(e.target.value as ReportReason)} className={styles.reasons}>
            {REASONS.map((r) => (
              <Radio key={r.value} value={r.value} className={styles.reason}>
                <span className={styles.reasonLabel}>{r.label}</span>
                <span className={styles.reasonHint}>{r.hint}</span>
              </Radio>
            ))}
          </Radio.Group>
        </fieldset>
        <label className={styles.legend} htmlFor={`${id}-comment`}>
          {reason === 'other' ? 'Комментарий' : 'Комментарий (необязательно)'}
        </label>
        <Input.TextArea
          id={`${id}-comment`}
          value={comment}
          maxLength={500}
          autoSize={{ minRows: 2, maxRows: 6 }}
          placeholder="Что случилось и где"
          onChange={(e) => setComment(e.target.value)}
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

const STATUS_TEXT: Record<NonNullable<MyReportState['status']>, string> = {
  open: 'Вы пожаловались. Администратор проверит',
  upheld: 'Ваша жалоба подтвердилась',
  dismissed: 'Жалобу рассмотрели, нарушений не нашли',
};

/** «Пожаловаться на событие»: для вошедших, кроме организатора и администратора. */
export function ReportEventButton({ event: e }: { event: EventDetails }) {
  const { me, role } = useMe();
  const [open, setOpen] = useState(false);
  const can = Boolean(me) && role !== 'admin' && !e.isOrganizer && e.state !== 'deleted';
  const { data, refetch } = useLiveGet<MyReportState>(COMMUNITY_API.myEventReport(e.id), ['reports', 'notifications'], can);
  if (!can) return null;
  if (data?.reported && data.status)
    return (
      <p className={styles.done}>
        <CheckCircleIcon size={18} aria-hidden />
        {STATUS_TEXT[data.status]}
      </p>
    );
  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)}>
        <FlagIcon size={18} aria-hidden />
        Пожаловаться на событие
      </button>
      <ReportDialog
        open={open}
        target="event"
        targetId={e.id}
        title={`«${e.title}»`}
        onClose={() => setOpen(false)}
        onDone={() => void refetch()}
      />
    </>
  );
}

/** «Пожаловаться» в сообщении обсуждения: чужие видимые сообщения, для вошедших. */
export function ReportMessageButton({ message: m }: { message: MessageView }) {
  const { me, role } = useMe();
  const [open, setOpen] = useState(false);
  const can = Boolean(me) && role !== 'admin' && !m.mine && !m.system && m.status === 'visible' && m.text !== null;
  const { data, refetch } = useLiveGet<{ ids: string[] }>(COMMUNITY_API.myMessageReports(m.eventId), ['reports'], can);
  if (!can) return null;
  if (data?.ids.includes(m.id))
    return (
      <span className={styles.doneInline}>
        <FlagIcon size={16} weight="fill" aria-hidden />
        Вы пожаловались
      </span>
    );
  return (
    <>
      <button type="button" className={discussion.action} onClick={() => setOpen(true)} aria-label="Пожаловаться на сообщение">
        <FlagIcon size={16} aria-hidden />
        Пожаловаться
      </button>
      <ReportDialog
        open={open}
        target="message"
        targetId={m.id}
        title={`«${(m.text ?? '').slice(0, 120)}${(m.text ?? '').length > 120 ? '…' : ''}»`}
        onClose={() => setOpen(false)}
        onDone={() => void refetch()}
      />
    </>
  );
}
