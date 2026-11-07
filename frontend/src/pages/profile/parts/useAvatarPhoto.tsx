import { useUpdate, type HttpError } from '@refinedev/core';
import { useEffect, useRef, useState } from 'react';

import { ImageCropper } from '@/components';
import { errorMessage } from '@/lib/api';
import { checkImageFile } from '@/lib/eventImages';
import type { Identity } from '@/types/api';
import type { ProfilePatch } from '@/types/inputs';

type AvatarPatch = ProfilePatch & { avatarUrl: string | null };

const AVATAR_OUTPUT = { width: 512 };

/**
 * Фото профиля: выбор файла, круглое кадрирование и сохранение правкой профиля.
 * Общая часть профиля и шага «Добавьте фото» после регистрации.
 */
export function useAvatarPhoto(userId: Identity['id'] | undefined, onSaved?: (url: string | null) => void) {
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, mutation } = useUpdate<Identity, HttpError, AvatarPatch>();

  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source],
  );

  const choose = (file: File) => {
    setError(null);
    try {
      checkImageFile(file);
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    setSource(URL.createObjectURL(file));
  };

  const save = async (avatarUrl: string | null) => {
    if (!userId) throw new Error('Войдите, чтобы сохранить фото');
    setError(null);
    try {
      await mutateAsync({
        resource: 'users',
        id: userId,
        values: { avatarUrl },
        successNotification: false,
        errorNotification: false,
      });
    } catch (e) {
      const field = (e as { errors?: Record<string, string> }).errors?.avatarUrl;
      throw new Error(field ?? errorMessage(e, 'Не получилось сохранить фото. Попробуйте ещё раз'));
    }
    onSaved?.(avatarUrl);
  };

  const elements = (
    <>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Выбрать фото профиля"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) choose(file);
          e.currentTarget.value = '';
        }}
      />
      <ImageCropper
        src={source}
        title="Фото профиля"
        shape="round"
        aspect={1}
        output={AVATAR_OUTPUT}
        onCancel={() => setSource(null)}
        onSave={async (url) => {
          await save(url);
          setSource(null);
        }}
      />
    </>
  );

  return {
    /** Скрытое поле выбора файла и окно кадрирования: вставить в разметку один раз. */
    elements,
    pick: () => input.current?.click(),
    remove: () => save(null).catch((e: Error) => setError(e.message)),
    error,
    pending: mutation.isPending,
    cropping: source !== null,
  };
}
