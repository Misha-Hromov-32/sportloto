import { CheckCircleIcon, ImageIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { Avatar, Button } from '@/components';
import type { Identity } from '@/types/api';

import { AuthShell } from '../AuthShell';
import flow from '../parts/AuthFlow.module.css';
import { useAvatarPhoto } from '../../profile/parts/useAvatarPhoto';
import styles from './PhotoStep.module.css';

/** Необязательный шаг сразу после регистрации. `me` появляется, когда вход уже выполнен. */
export function PhotoStep({ me, name, onDone }: { me: Identity | null; name: string; onDone: () => void }) {
  const [saved, setSaved] = useState<string | null>(null);
  const photo = useAvatarPhoto(me?.id, setSaved);
  const src = saved ?? me?.avatarUrl ?? null;

  return (
    <AuthShell
      title="Добавьте фото"
      focusTitle
      subtitle="С фото вас проще узнать на встрече. Можно добавить позже в профиле."
    >
      <div className={flow.body}>
        <div className={styles.preview}>
          <Avatar name={me?.name ?? name} initials={me?.initials} src={src} size={96} />
        </div>
        {saved && (
          <p className={[flow.notice, flow.ok].join(' ')} role="status">
            <CheckCircleIcon size={24} weight="fill" aria-hidden />
            <span>Фото сохранено. Его увидят участники и организаторы встреч.</span>
          </p>
        )}
        {photo.error && (
          <p className={[flow.notice, flow.danger].join(' ')} role="alert">
            <WarningCircleIcon size={24} weight="fill" aria-hidden />
            <span>{photo.error}</span>
          </p>
        )}
        <div className={flow.actions}>
          {saved ? (
            <>
              <Button variant="primary" block onClick={onDone}>
                Готово
              </Button>
              <Button
                variant="secondary"
                block
                icon={<ImageIcon size={20} aria-hidden />}
                onClick={photo.pick}
                disabled={photo.pending}
              >
                Выбрать другое фото
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                block
                icon={<ImageIcon size={20} aria-hidden />}
                onClick={photo.pick}
                disabled={!me}
                loading={!me}
                loadingText="Входим в аккаунт…"
              >
                Загрузить фото
              </Button>
              <Button variant="quiet" block onClick={onDone}>
                Пропустить
              </Button>
            </>
          )}
        </div>
        <p className={flow.hint}>
          Подойдёт JPEG, PNG или WebP до 8 МБ. Перед сохранением можно выбрать кадр.
        </p>
      </div>
      {photo.elements}
    </AuthShell>
  );
}
