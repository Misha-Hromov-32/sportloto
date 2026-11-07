import { useUpdate, type HttpError } from '@refinedev/core';
import { Form, Modal, Radio } from 'antd';
import { useId, useState } from 'react';

import { errorMessage } from '@/lib/api';
import type { Identity } from '@/types/api';
import type { Gender } from '@/types/domain';
import type { ProfilePatch } from '@/types/inputs';

import {
  fromChoice,
  GENDER_CHOICES,
  GENDER_HINT,
  genderChoiceLabel,
  toChoice,
  type GenderChoice as Choice,
} from './gender';
import styles from './gender.module.css';

/** В7: выбор пола в профиле. Сохранить можно и «Не указывать». */
export function GenderOptions({
  value,
  onChange,
  labelledBy,
}: {
  value?: Choice;
  onChange?: (v: Choice) => void;
  labelledBy?: string;
}) {
  return (
    <Radio.Group
      value={value ?? 'none'}
      onChange={(ev) => onChange?.(ev.target.value as Choice)}
      className={styles.options}
      aria-labelledby={labelledBy}
    >
      {GENDER_CHOICES.map((c) => (
        <Radio key={c} value={c} className={styles.option}>
          {genderChoiceLabel(c)}
        </Radio>
      ))}
    </Radio.Group>
  );
}

/** В7: поле «Пол» в форме профиля. Значение формы — `GenderChoice`. */
export function GenderField() {
  return (
    <Form.Item label="Пол" name="gender" extra={GENDER_HINT}>
      <GenderOptions />
    </Form.Item>
  );
}

/**
 * «Указать в профиле» прямо с карточки события: пол сохраняется в профиль,
 * после чего запись продолжается сама — возвращаться никуда не нужно.
 */
export function GenderDialog({
  me,
  open,
  title,
  onClose,
  onSaved,
}: {
  me: Identity;
  open: boolean;
  title: string;
  onClose: () => void;
  onSaved: (gender: Gender | null) => void;
}) {
  const [value, setValue] = useState<Choice>(toChoice(me.gender));
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const { mutateAsync, mutation } = useUpdate<Identity, HttpError, ProfilePatch>();

  const save = async () => {
    setError(null);
    try {
      await mutateAsync({
        resource: 'users',
        id: me.id,
        values: { gender: fromChoice(value) },
        successNotification: false,
        errorNotification: false,
      });
      onSaved(fromChoice(value));
    } catch (e) {
      setError(errorMessage(e, 'Не получилось сохранить. Попробуйте ещё раз'));
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onClose}
      onOk={() => void save()}
      okText={value === 'none' ? 'Сохранить' : 'Сохранить и записаться'}
      cancelText="Отмена"
      confirmLoading={mutation.isPending}
      destroyOnHidden
    >
      <div className={styles.dialog}>
        <p id={labelId} className={styles.label}>
          Ваш пол
        </p>
        <GenderOptions value={value} onChange={setValue} labelledBy={labelId} />
        <p className={styles.hint}>{GENDER_HINT}</p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
