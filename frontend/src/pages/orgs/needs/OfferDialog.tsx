import { HandshakeIcon } from '@phosphor-icons/react';
import { Input, Modal, Select } from 'antd';
import { useId, useState } from 'react';

import { Button } from '@/components';
import { errorMessage, INVENTORY_API, useAction } from '@/lib/api';
import type { SupportNeedView } from '@/types/inventory';
import { Field } from '@/pages/events/create/fields';

import styles from './needs.module.css';

/** Отклик партнёра «Поможем»: чем именно и когда. Клуб подтверждает сам. */
export function OfferDialog({ need, onClose }: { need: SupportNeedView | null; onClose: () => void }) {
  return (
    <Modal open={Boolean(need)} onCancel={onClose} title="Предложить помощь" footer={null} destroyOnHidden>
      {need && <OfferForm need={need} onClose={onClose} />}
    </Modal>
  );
}

function OfferForm({ need, onClose }: { need: SupportNeedView; onClose: () => void }) {
  const [orgId, setOrgId] = useState(need.offerAs[0]?.id ?? '');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useAction<SupportNeedView>();
  const orgFieldId = useId();
  const commentId = useId();

  const submit = async () => {
    setError(null);
    if (comment.trim().length < 5) {
      setErrors({ comment: 'Напишите, чем поможете: например, «Дадим 2 мяча на сезон»' });
      return;
    }
    setErrors({});
    try {
      await run(
        INVENTORY_API.offerSupport(need.id),
        { orgId, comment: comment.trim() },
        { silent: true, success: 'Отклик отправлен. Клуб ответит в уведомлениях' },
      );
      onClose();
    } catch (e) {
      const fields = (e as { errors?: Record<string, string> }).errors;
      if (fields) setErrors(fields);
      setError(errorMessage(e));
    }
  };

  return (
    <div className={styles.dialog}>
      <p>
        <b>{need.org.name}</b>: {need.title}
      </p>
      {need.offerAs.length > 1 && (
        <Field label="От чьего имени" htmlFor={orgFieldId}>
          <Select
            id={orgFieldId}
            size="large"
            value={orgId}
            onChange={setOrgId}
            options={need.offerAs.map((o) => ({ value: o.id, label: o.name }))}
          />
        </Field>
      )}
      <Field
        label="Чем поможете"
        htmlFor={commentId}
        error={errors.comment}
        hint="Что дадите, на какой срок и как передадите"
      >
        <Input.TextArea
          id={commentId}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 6 }}
          maxLength={400}
          placeholder="Дадим 2 мяча на сезон, привезём в субботу к началу"
        />
      </Field>
      {error && (
        <p className={styles.dialogError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.dialogActions}>
        <Button
          variant="primary"
          icon={<HandshakeIcon size={20} aria-hidden />}
          loading={isPending}
          loadingText="Отправляем…"
          onClick={submit}
        >
          Отправить отклик
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
