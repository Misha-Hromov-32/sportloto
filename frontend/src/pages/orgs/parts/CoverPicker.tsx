import { CropIcon, ImageIcon, TrashIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import { useRef } from 'react';

import { Button, ImageCropper, useCropSession } from '@/components';
import { errorMessage } from '@/lib/api';

import styles from './FormParts.module.css';
import { ORG_COVER_RATIO } from './OrgHero';

const COVER_OUTPUT = { width: 1600, shrinkOnly: true };

export function CoverPicker({
  name,
  value,
  onChange,
  describedBy,
}: {
  name: string;
  value: string | null;
  onChange: (value: string | null) => void;
  describedBy?: string;
}) {
  const { message } = App.useApp();
  const input = useRef<HTMLInputElement>(null);
  const crop = useCropSession();

  return (
    <div className={styles.logoField}>
      {value && (
        <img
          className={styles.coverPreview}
          src={value}
          alt={`Обложка: ${name || 'ваша организация'}`}
          width={1200}
          height={400}
        />
      )}
      <input
        ref={input}
        className="sr-only"
        type="file"
        tabIndex={-1}
        accept="image/jpeg,image/png,image/webp"
        aria-label="Выбрать файл обложки"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          try {
            crop.choose(file);
          } catch (error) {
            message.error(errorMessage(error));
          }
        }}
      />
      <div className={styles.mediaActions}>
        <Button
          id="org-cover-upload"
          variant="secondary"
          size="sm"
          icon={<ImageIcon size={20} aria-hidden />}
          onClick={() => input.current?.click()}
          aria-describedby={describedBy}
        >
          {value ? 'Выбрать другое фото' : 'Загрузить обложку'}
        </Button>
        {value && crop.canRecrop(value) && (
          <Button
            variant="quiet"
            size="sm"
            icon={<CropIcon size={20} aria-hidden />}
            onClick={() => crop.recrop(value)}
          >
            Изменить кадр
          </Button>
        )}
        {value && (
          <Button
            variant="quiet"
            size="sm"
            icon={<TrashIcon size={20} aria-hidden />}
            onClick={() => {
              crop.clear();
              onChange(null);
            }}
          >
            Убрать обложку
          </Button>
        )}
      </div>

      <ImageCropper
        src={crop.editing?.url ?? null}
        title="Обложка страницы"
        shape="rect"
        aspect={ORG_COVER_RATIO}
        output={COVER_OUTPUT}
        initial={crop.editing?.state}
        onCancel={crop.cancel}
        onSave={(url, state) => {
          onChange(url);
          crop.commit(state);
        }}
      />
    </div>
  );
}
