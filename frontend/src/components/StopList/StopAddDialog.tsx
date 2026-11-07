import { InfoIcon, ProhibitIcon } from '@phosphor-icons/react';
import { App, Modal } from 'antd';
import { useState, type ReactNode } from 'react';

import { errorMessage, useAction, useLiveGet } from '@/lib/api';
import { formatAgo, formatDayMonth } from '@/lib/dates';
import type { StopAddResult, StopOwnerKey, StopPreview } from '@/types/api';

import { Avatar } from '../Avatar/Avatar';
import { Button } from '../Button/Button';
import { SkeletonBlock } from '../Skeleton/Skeleton';
import { ErrorState } from '../States/States';
import { StopFields } from './StopFields';
import { draftFrom, draftPayload, validateDraft, type StopDraft, type StopErrors } from './stopDraft';
import { STOP_API, STOP_LIVE, fieldError, firstName, ownerMeetings } from './stopApi';
import styles from './StopList.module.css';

interface StopAddDialogProps {
  open: boolean;
  owner: StopOwnerKey;
  userId: string | null;
  onClose: () => void;
  onDone?: (result: StopAddResult) => void;
  /** Выполняется перед добавлением, например отказ по заявке. Ошибку показывает сам. */
  beforeSubmit?: () => Promise<unknown>;
  /** Что ещё произойдёт: показывается над формой. */
  intro?: ReactNode;
  submitLabel?: string;
  /** Встреча, с которой человека и так убирают: не считаем её среди «других предстоящих». */
  exceptEventId?: string;
}

/** «Не пускать на мои встречи»: кто, почему, на какой срок и что будет с его записями. */
export function StopAddDialog({ open, owner, userId, onClose, ...rest }: StopAddDialogProps) {
  return (
    <Modal
      open={open && Boolean(userId)}
      onCancel={onClose}
      title={`Не пускать на ${ownerMeetings(owner)}`}
      footer={null}
      destroyOnHidden
      width={600}
    >
      {userId && <PreviewLoader owner={owner} userId={userId} onClose={onClose} {...rest} />}
    </Modal>
  );
}

function PreviewLoader({
  owner,
  userId,
  onClose,
  ...rest
}: Omit<StopAddDialogProps, 'open' | 'userId'> & { userId: string }) {
  const { data, isLoading, isError, error, refetch } = useLiveGet<StopPreview>(
    STOP_API.preview(owner, userId),
    STOP_LIVE,
  );

  if (isLoading) {
    return (
      <div className={styles.dialog} role="status">
        <span className="sr-only">Загружаем…</span>
        <SkeletonBlock height={48} />
        <SkeletonBlock height={160} />
      </div>
    );
  }
  if (isError || !data?.user) {
    return (
      <ErrorState onRetry={error?.code === 'forbidden' ? undefined : () => void refetch()}>
        {errorMessage(error, 'Не удалось загрузить. Проверьте интернет и нажмите «Повторить».')}
      </ErrorState>
    );
  }
  return <StopForm key={data.user.id} owner={owner} preview={data} onClose={onClose} {...rest} />;
}

function StopForm({
  owner,
  preview,
  onClose,
  onDone,
  beforeSubmit,
  intro,
  submitLabel,
  exceptEventId,
}: Omit<StopAddDialogProps, 'open' | 'userId'> & { preview: StopPreview }) {
  const { message } = App.useApp();
  const { run } = useAction<StopAddResult>();
  const [draft, setDraft] = useState<StopDraft>(() => draftFrom(preview.existing));
  const [errors, setErrors] = useState<StopErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const { user, existing } = preview;
  const name = firstName(user.name);

  const change = (next: StopDraft) => {
    setDraft(next);
    setErrors({});
    setFormError('');
  };

  const submit = async () => {
    const found = validateDraft(draft);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setBusy(true);
    if (beforeSubmit) {
      try {
        await beforeSubmit();
      } catch {
        setBusy(false);
        return;
      }
    }
    try {
      const res = await run(
        STOP_API.add,
        { owner, userId: user.id, ...draftPayload(draft) },
        { silent: true },
      );
      message.success(
        existing
          ? 'Стоп-лист обновлён'
          : `${name} больше не сможет записываться на ${ownerMeetings(owner)}${
              res.cancelled ? `. Отменено записей: ${res.cancelled}` : ''
            }`,
      );
      onDone?.(res);
      onClose();
    } catch (e) {
      const reasonText = fieldError(e, 'reasonText');
      const note = fieldError(e, 'note');
      if (reasonText || note) setErrors({ reasonText, note });
      else setFormError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className={styles.dialog}>
      <div className={styles.who}>
        <Avatar name={user.name} initials={user.initials} src={user.avatarUrl} size={48} />
        <span className={styles.whoName}>{user.name}</span>
      </div>

      {preview.blockedReason ? (
        <>
          <p className={styles.blocked}>
            <ProhibitIcon size={20} aria-hidden />
            <span>{preview.blockedReason}</span>
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onClose}>
              Понятно
            </Button>
          </div>
        </>
      ) : (
        <>
          {intro && <div className={styles.intro}>{intro}</div>}
          {existing && (
            <p className={styles.intro}>
              <InfoIcon size={20} aria-hidden />
              <span>
                Уже в стоп-листе с {formatAgo(existing.createdAt)}
                {existing.until ? `, до ${formatDayMonth(existing.until)}` : ', бессрочно'}. Можно изменить
                причину и срок.
              </span>
            </p>
          )}
          <StopFields
            owner={owner}
            preview={preview}
            draft={draft}
            errors={errors}
            onChange={change}
            exceptEventId={exceptEventId}
          />
          {formError && (
            <p className={styles.error} role="alert">
              {formError}
            </p>
          )}
          <div className={styles.actions}>
            <Button
              variant="danger"
              icon={<ProhibitIcon size={20} aria-hidden />}
              loading={busy}
              loadingText="Сохраняем…"
              onClick={() => void submit()}
            >
              {submitLabel ?? (existing ? 'Сохранить изменения' : 'Не пускать')}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={onClose}>
              Отмена
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
