import { XIcon } from '@phosphor-icons/react';
import { Checkbox, Drawer, Input } from 'antd';
import { useEffect, useId, useState } from 'react';

import { Button, Chip } from '@/components';

import { REJECT_TEMPLATES } from '../rejectTemplates';
import styles from './review.module.css';

export interface RejectChoice {
  reason: string;
  dontAsk: boolean;
}

interface RejectSheetProps {
  /** Имя заявителя; null — панель закрыта. */
  name: string | null;
  onReject: (choice: RejectChoice) => void;
  onCancel: () => void;
}

/** Нижняя панель «Причина (по желанию)» перед отклонением заявки из стопки. */
export function RejectSheet({ name, onReject, onCancel }: RejectSheetProps) {
  const [reason, setReason] = useState('');
  const [dontAsk, setDontAsk] = useState(false);
  const fieldId = useId();
  const open = name !== null;

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const trimmed = reason.trim();
  return (
    <Drawer
      open={open}
      onClose={onCancel}
      placement="bottom"
      height="auto"
      title="Причина (по желанию)"
      className={styles.sheet}
      destroyOnHidden
      footer={
        <div className={styles.sheetFoot}>
          <Button
            variant="danger"
            icon={<XIcon size={20} weight="bold" aria-hidden />}
            disabled={!trimmed}
            onClick={() => onReject({ reason: trimmed, dontAsk })}
          >
            Отклонить
          </Button>
          <Button variant="secondary" onClick={() => onReject({ reason: '', dontAsk })}>
            Отклонить без причины
          </Button>
          <Button variant="quiet" onClick={onCancel}>
            Отмена
          </Button>
        </div>
      }
    >
      <div className={styles.sheetBody}>
        <p className={styles.sheetNote}>{name} увидит причину в своих занятиях и в уведомлении.</p>
        <div className={styles.templates} role="group" aria-label="Готовые причины">
          {REJECT_TEMPLATES.map((t) => (
            <Chip key={t} selected={reason === t} onClick={() => setReason(reason === t ? '' : t)}>
              {t}
            </Chip>
          ))}
        </div>
        <label htmlFor={fieldId} className={styles.sheetLabel}>
          Своими словами
        </label>
        <Input.TextArea
          id={fieldId}
          rows={2}
          maxLength={300}
          showCount
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Например, приходите в следующую субботу: будет группа новичков"
        />
        <Checkbox checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)}>
          <span className={styles.sheetCheck}>Больше не спрашивать причину в этот раз</span>
        </Checkbox>
      </div>
    </Drawer>
  );
}
