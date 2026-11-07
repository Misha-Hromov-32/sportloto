import { useEffect, useRef, useState } from 'react';

import { checkImageFile } from '@/lib/eventImages';

import type { CropState } from './cropImage';

export interface CropSource {
  url: string;
  state?: CropState;
}

/**
 * Выбор файла и кадрирование с повторной правкой кадра.
 * Исходник последнего фото держим в памяти: «Изменить кадр» открывает его, а не уже обрезанную картинку.
 */
export function useCropSession() {
  const owned = useRef(new Set<string>());
  const [source, setSource] = useState<CropSource | null>(null);
  const [editing, setEditing] = useState<CropSource | null>(null);

  useEffect(() => {
    const urls = owned.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const release = (url: string | undefined) => {
    if (url && owned.current.delete(url)) URL.revokeObjectURL(url);
  };

  return {
    editing,
    /** Бросает ошибку с понятным текстом, если файл не подходит. */
    choose(file: File) {
      checkImageFile(file);
      const url = URL.createObjectURL(file);
      owned.current.add(url);
      setEditing({ url });
    },
    /** Кадр можно поменять, пока есть исходник или сохранённая картинка в data URL. */
    canRecrop(saved: string | null | undefined): boolean {
      return Boolean(source || saved?.startsWith('data:'));
    },
    recrop(saved: string | null | undefined) {
      const from = source ?? (saved ? { url: saved } : null);
      if (from) setEditing(from);
    },
    cancel() {
      if (editing && editing.url !== source?.url) release(editing.url);
      setEditing(null);
    },
    /** Вызывается после того, как обрезанная картинка сохранена. */
    commit(state: CropState) {
      if (!editing) return;
      if (editing.url !== source?.url) release(source?.url);
      setSource({ url: editing.url, state });
      setEditing(null);
    },
    clear() {
      release(source?.url);
      setSource(null);
    },
  };
}
