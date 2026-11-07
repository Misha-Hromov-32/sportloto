import { ImageIcon, TrashIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import { useId } from 'react';

import { Avatar, Button } from '@/components';
import type { Identity } from '@/types/api';

import styles from './ProfileEditForm.module.css';
import { useAvatarPhoto } from './useAvatarPhoto';

/** Фото профиля сохраняется сразу, отдельно от остальных полей формы. */
export function ProfilePhoto({ me }: { me: Identity }) {
  const titleId = useId();
  const { message } = App.useApp();
  const photo = useAvatarPhoto(me.id, (url) =>
    message.success(url ? 'Фото профиля сохранено' : 'Фото профиля удалено'),
  );

  return (
    <section className={styles.photo} aria-labelledby={titleId}>
      <Avatar name={me.name} initials={me.initials} src={me.avatarUrl} size={96} />
      <div className={styles.photoBody}>
        <h3 id={titleId} className={styles.photoTitle}>
          Фото профиля
        </h3>
        <p className={styles.photoHint}>
          {me.avatarUrl
            ? 'Фото видят участники и организаторы встреч.'
            : 'Пока вместо фото буквы имени. С фото вас проще узнать на встрече.'}
        </p>
        <div className={styles.photoActions}>
          <Button
            variant="secondary"
            size="sm"
            icon={<ImageIcon size={20} aria-hidden />}
            onClick={photo.pick}
            disabled={photo.pending}
          >
            {me.avatarUrl ? 'Заменить фото' : 'Загрузить фото'}
          </Button>
          {me.avatarUrl && (
            <Button
              variant="quiet"
              size="sm"
              icon={<TrashIcon size={20} aria-hidden />}
              onClick={() => void photo.remove()}
              loading={photo.pending && !photo.cropping}
              loadingText="Удаляем…"
            >
              Удалить фото
            </Button>
          )}
        </div>
        {photo.error && (
          <p className={styles.error} role="alert">
            {photo.error}
          </p>
        )}
      </div>
      {photo.elements}
    </section>
  );
}
