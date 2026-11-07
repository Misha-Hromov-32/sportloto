import { CropIcon, ImageIcon, PaintBrushIcon, TrashIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';

import { apiRequest } from '@/api/client';
import { Button, ImageCropper, type CropState } from '@/components';
import { errorMessage } from '@/lib/api';
import { checkImageFile } from '@/lib/eventImages';
import { COVER_RATIO } from '@/lib/images';

import type { SectionProps } from './sections';
import { Field } from './fields';
import { sportNameOf } from './model';
import styles from './create.module.css';

const COVER_OUTPUT = { width: 1280, shrinkOnly: true };

/** Рисовать обложку может только мост помощника на компьютере (Codex), когда он подключён. */
function useCanDraw(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let alive = true;
    apiRequest<{ images?: boolean }>('get', '/assistant/config')
      .then((c) => alive && setCan(Boolean(c.images)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return can;
}

async function dataUrlToObjectUrl(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return URL.createObjectURL(blob);
}

interface Source {
  url: string;
  state?: CropState;
}

export function PhotoField({ form, set, errors }: SectionProps) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const { message } = App.useApp();
  /** Исходник последнего фото: пока он в памяти, кадр можно поменять без повторного выбора файла. */
  const [source, setSource] = useState<Source | null>(null);
  const [editing, setEditing] = useState<Source | null>(null);
  const owned = useRef(new Set<string>());
  const canDraw = useCanDraw();
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    const urls = owned.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const release = (url: string | undefined) => {
    if (url && owned.current.delete(url)) URL.revokeObjectURL(url);
  };

  const choose = (file: File) => {
    try {
      checkImageFile(file);
    } catch (error) {
      message.error(errorMessage(error));
      return;
    }
    const url = URL.createObjectURL(file);
    owned.current.add(url);
    setEditing({ url });
  };

  const draw = async () => {
    setDrawing(true);
    try {
      const { image } = await apiRequest<{ image: string }>('post', '/assistant/cover', {
        body: {
          title: form.title,
          sport: sportNameOf(form),
          description: form.description,
          place: form.address,
        },
      });
      const url = await dataUrlToObjectUrl(image);
      owned.current.add(url);
      setEditing({ url });
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setDrawing(false);
    }
  };

  const recropFrom: Source | null =
    source ?? (form.coverUrl?.startsWith('data:') ? { url: form.coverUrl } : null);

  return (
    <Field
      label="Фото встречи"
      optional
      htmlFor={inputId}
      error={errors.coverUrl}
      hint="Фото увидят в поиске и на странице встречи. Подойдёт JPEG, PNG или WebP до 8 МБ."
    >
      {form.coverUrl && (
        <img className={styles.photoPreview} src={form.coverUrl} alt="Обложка вашей встречи" />
      )}
      <input
        ref={input}
        id={inputId}
        className="sr-only"
        type="file"
        tabIndex={-1}
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) choose(file);
          e.currentTarget.value = '';
        }}
      />
      <div className={styles.photoActions}>
        <Button
          variant="secondary"
          size="sm"
          icon={<ImageIcon size={20} aria-hidden />}
          onClick={() => input.current?.click()}
        >
          {form.coverUrl ? 'Выбрать другое фото' : 'Загрузить фото'}
        </Button>
        {canDraw && (
          <Button
            variant="secondary"
            size="sm"
            icon={<PaintBrushIcon size={20} aria-hidden />}
            onClick={() => void draw()}
            loading={drawing}
            disabled={!form.title.trim()}
            title={form.title.trim() ? undefined : 'Сначала укажите название встречи'}
          >
            Нарисовать обложку
          </Button>
        )}
        {form.coverUrl && recropFrom && (
          <Button
            variant="quiet"
            size="sm"
            icon={<CropIcon size={20} aria-hidden />}
            onClick={() => setEditing(recropFrom)}
          >
            Изменить кадр
          </Button>
        )}
        {form.coverUrl && (
          <Button
            variant="quiet"
            size="sm"
            icon={<TrashIcon size={20} aria-hidden />}
            onClick={() => {
              set({ coverUrl: null });
              release(source?.url);
              setSource(null);
            }}
          >
            Убрать фото
          </Button>
        )}
      </div>
      {drawing && (
        <p className={styles.photoDrawing} role="status">
          Помощник создаёт обложку по названию встречи и виду спорта. Обычно это занимает около минуты.
          Дождитесь результата на этой странице.
        </p>
      )}
      {canDraw && !drawing && !form.title.trim() && (
        <p className={styles.photoDrawing}>Чтобы нарисовать обложку, сначала укажите название встречи.</p>
      )}
      <ImageCropper
        src={editing?.url ?? null}
        title="Обложка встречи"
        shape="rect"
        aspect={COVER_RATIO}
        output={COVER_OUTPUT}
        initial={editing?.state}
        onCancel={() => {
          if (editing && editing.url !== source?.url) release(editing.url);
          setEditing(null);
        }}
        onSave={(url, state) => {
          if (!editing) return;
          if (editing.url !== source?.url) release(source?.url);
          set({ coverUrl: url });
          setSource({ url: editing.url, state });
          setEditing(null);
        }}
      />
    </Field>
  );
}
