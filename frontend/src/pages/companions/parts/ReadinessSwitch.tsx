import { EyeSlashIcon, FlagIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useUpdate } from '@refinedev/core';
import { App } from 'antd';
import { useState } from 'react';

import { errorMessage } from '@/lib/api';
import { READINESS } from '@/lib/labels';
import type { Identity } from '@/types/api';
import type { Readiness } from '@/types/domain';

import { OptionCards } from '../../events/create/fields';
import styles from './companions.module.css';

type Value = Readiness | 'none';

const SUCCESS: Record<Value, string> = {
  join: 'Организаторы видят, что вы готовы присоединиться',
  organize: 'Люди видят, что вы готовы собрать встречу',
  none: 'Статус скрыт',
};

/** Мой статус в «Ищу компанию»: меняется одним касанием и сразу виден другим. */
export function ReadinessSwitch({ me }: { me: Identity }) {
  const { message } = App.useApp();
  const { mutateAsync } = useUpdate();
  const [pending, setPending] = useState<Value | null>(null);
  const value: Value = pending ?? me.readiness ?? 'none';

  const change = async (next: Value) => {
    if (next === value) return;
    setPending(next);
    try {
      await mutateAsync({
        resource: 'users',
        id: me.id,
        values: { readiness: next === 'none' ? null : next },
        successNotification: false,
        errorNotification: false,
      });
      message.success(SUCCESS[next]);
    } catch (error) {
      message.error(errorMessage(error, 'Не удалось поменять статус. Попробуйте ещё раз'));
    } finally {
      setPending(null);
    }
  };

  return (
    <section className={styles.readiness} aria-labelledby="readiness-title">
      <h2 id="readiness-title" className={styles.blockTitle}>
        Ваш статус
      </h2>
      <OptionCards<Value>
        label="Ваш статус в поиске компании"
        columns={3}
        size="sm"
        value={value}
        onChange={change}
        options={[
          {
            value: 'join',
            title: READINESS.join.label,
            text: 'Организаторы увидят это и смогут позвать вас',
            icon: <MagnifyingGlassIcon size={20} aria-hidden />,
          },
          {
            value: 'organize',
            title: READINESS.organize.label,
            text: 'Те, кто ищет компанию, увидят, что вы соберёте встречу',
            icon: <FlagIcon size={20} aria-hidden />,
          },
          {
            value: 'none',
            title: 'Не показывать',
            text: 'Статус не виден другим',
            icon: <EyeSlashIcon size={20} aria-hidden />,
          },
        ]}
      />
    </section>
  );
}
