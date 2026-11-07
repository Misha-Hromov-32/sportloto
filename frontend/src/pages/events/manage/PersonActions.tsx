import { UserMinusIcon } from '@phosphor-icons/react';
import { App, Checkbox, Input, Modal } from 'antd';
import { useId, useState } from 'react';

import {
  Button,
  Chip,
  STOP_API,
  STOP_LIVE,
  SkeletonBlock,
  StatusBadge,
  StopFields,
  draftFrom,
  draftPayload,
  fieldError,
  ownerMeetings,
  validateDraft,
  type StopDraft,
  type StopErrors,
} from '@/components';
import { errorMessage, useAction, useLiveGet } from '@/lib/api';
import type { EventDetails, ParticipantView, StopOwnerKey, StopPreview } from '@/types/api';

import styles from './manage.module.css';

const REMOVE_TEMPLATES = ['Встреча для другого уровня', 'Нарушение правил встречи'];

export function StopListedMark({ on }: { on?: boolean }) {
  if (!on) return null;
  return <StatusBadge kind="custom" meta={{ label: 'В стоп-листе', tone: 'off', icon: 'ban' }} />;
}

const first = (name: string) => name.split(' ')[0] || name;

export function RemoveParticipantDialog({
  event,
  owner,
  person,
  onClose,
}: {
  event: EventDetails;
  owner: StopOwnerKey;
  person: ParticipantView | null;
  onClose: () => void;
}) {
  const queue = person?.status === 'waitlist';
  return (
    <Modal
      open={Boolean(person)}
      onCancel={onClose}
      title={queue ? 'Убрать из листа ожидания?' : 'Убрать из участников?'}
      footer={null}
      destroyOnHidden
      width={600}
    >
      {person && <RemoveForm event={event} owner={owner} person={person} onClose={onClose} />}
    </Modal>
  );
}

function RemoveForm({
  event,
  owner,
  person,
  onClose,
}: {
  event: EventDetails;
  owner: StopOwnerKey;
  person: ParticipantView;
  onClose: () => void;
}) {
  const reasonId = useId();
  const { message } = App.useApp();
  const { run, isPending } = useAction<ParticipantView>();
  const [reason, setReason] = useState('');
  const [stopOn, setStopOn] = useState(false);
  const [draft, setDraft] = useState<StopDraft | null>(null);
  const [errors, setErrors] = useState<StopErrors>({});
  const [formError, setFormError] = useState('');
  const preview = useLiveGet<StopPreview>(STOP_API.preview(owner, person.userId), STOP_LIVE, stopOn);
  const name = first(person.user.name);
  const queue = person.status === 'waitlist';
  const blocked = preview.data?.blockedReason ?? null;
  const stopDraft = draft ?? (preview.data ? draftFrom(preview.data.existing) : null);

  const effect = queue
    ? `${person.user.name} потеряет место в очереди.`
    : `${person.user.name} больше не будет в списке встречи. Место освободится${event.counts.waitlist > 0 ? ' и перейдёт первому из листа ожидания' : ''}.`;

  const submit = async () => {
    const withStop = stopOn && !blocked && stopDraft;
    if (withStop) {
      const found = validateDraft(stopDraft);
      if (Object.keys(found).length) {
        setErrors(found);
        return;
      }
    }
    try {
      await run(
        STOP_API.removeParticipant(person.id),
        {
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          stop: withStop ? draftPayload(stopDraft) : null,
        },
        { silent: true },
      );
      message.success(
        withStop ? 'Запись отменена, человек в стоп-листе' : 'Запись отменена, уведомление отправлено',
      );
      onClose();
    } catch (e) {
      const reasonText = fieldError(e, 'stop.reasonText', 'reasonText');
      const note = fieldError(e, 'stop.note', 'note');
      const removeReason = fieldError(e, 'reason');
      if (reasonText || note) setErrors({ reasonText, note });
      else setFormError(removeReason || errorMessage(e));
    }
  };

  return (
    <div className={styles.dialog}>
      <p>
        {effect} {name} получит уведомление{reason.trim() ? ' с причиной' : ''} и не сможет снова записаться
        на эту встречу.
      </p>
      <div>
        <label htmlFor={reasonId} className={styles.fieldLabel}>
          Причина для человека, необязательно
        </label>
        <div className={styles.templates} role="group" aria-label="Готовые причины">
          {REMOVE_TEMPLATES.map((t) => (
            <Chip key={t} selected={reason === t} onClick={() => setReason(reason === t ? '' : t)}>
              {t}
            </Chip>
          ))}
        </div>
        <Input.TextArea
          id={reasonId}
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setFormError('');
          }}
          placeholder="Например, это группа для опытных, приходите на встречу для новичков"
        />
      </div>

      <Checkbox
        checked={stopOn}
        onChange={(e) => {
          setStopOn(e.target.checked);
          setErrors({});
        }}
      >
        <span className={styles.checkLabel}>И не пускать на {ownerMeetings(owner)}</span>
      </Checkbox>

      {stopOn &&
        (preview.isLoading ? (
          <SkeletonBlock height={160} />
        ) : preview.isError || !preview.data?.user ? (
          <p className={styles.dialogError} role="alert">
            {errorMessage(
              preview.error,
              'Не удалось загрузить стоп-лист. Уберите галочку или попробуйте позже.',
            )}
          </p>
        ) : blocked ? (
          <p className={styles.dialogNote}>{blocked}</p>
        ) : (
          stopDraft && (
            <StopFields
              owner={owner}
              preview={preview.data}
              draft={stopDraft}
              errors={errors}
              onChange={(next) => {
                setDraft(next);
                setErrors({});
              }}
              exceptEventId={event.id}
            />
          )
        ))}

      {formError && (
        <p className={styles.dialogError} role="alert">
          {formError}
        </p>
      )}
      <div className={styles.dialogActions}>
        <Button
          variant="danger"
          icon={<UserMinusIcon size={20} aria-hidden />}
          loading={isPending}
          loadingText="Убираем…"
          onClick={() => void submit()}
        >
          {queue ? 'Убрать из очереди' : 'Убрать из участников'}
        </Button>
        <Button variant="quiet" disabled={isPending} onClick={onClose}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
