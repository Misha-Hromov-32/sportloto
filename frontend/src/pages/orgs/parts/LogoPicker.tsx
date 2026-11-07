import { CropIcon, ImageIcon, TrashIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import { useMemo, useRef, useState } from 'react';

import { Avatar, Chip, Button, ImageCropper, useCropSession } from '@/components';
import { errorMessage } from '@/lib/api';

import styles from './FormParts.module.css';
import { EMBLEMS, emblemUrl, LOGO_OUTPUT, TONES, type EmblemTone, type LogoChoice } from './logos';

export function LogoPicker({
  name,
  value,
  onChange,
  describedBy,
}: {
  name: string;
  value: LogoChoice;
  onChange: (value: LogoChoice) => void;
  describedBy?: string;
}) {
  const { message } = App.useApp();
  const input = useRef<HTMLInputElement>(null);
  const crop = useCropSession();
  /** Своя картинка остаётся в выборе, даже если временно выбран готовый знак. */
  const [upload, setUpload] = useState<string | null>(value.kind === 'upload' ? value.url : null);
  if (value.kind === 'upload' && value.url !== upload) setUpload(value.url);
  const tone: EmblemTone = value.kind === 'emblem' ? value.tone : 'accent';
  const urls = useMemo(() => new Map(EMBLEMS.map((e) => [e.key, emblemUrl(e.key, tone)])), [tone]);
  const uploadOn = value.kind === 'upload';

  const remove = () => {
    setUpload(null);
    crop.clear();
    if (uploadOn) onChange({ kind: 'monogram' });
  };

  return (
    <div className={styles.logoField}>
      <div className={styles.logos} role="radiogroup" aria-labelledby="org-logo-label">
        {upload && (
          <label className={[styles.logo, uploadOn && styles.logoOn].filter(Boolean).join(' ')}>
            <input
              type="radio"
              name="org-logo"
              checked={uploadOn}
              onChange={() => onChange({ kind: 'upload', url: upload })}
              className={styles.radio}
            />
            <Avatar name={name || 'Организация'} src={upload} size={56} shape="org" />
            <span className={styles.logoLabel}>Своя картинка</span>
          </label>
        )}
        <label
          className={[styles.logo, value.kind === 'monogram' && styles.logoOn].filter(Boolean).join(' ')}
        >
          <input
            type="radio"
            name="org-logo"
            checked={value.kind === 'monogram'}
            onChange={() => onChange({ kind: 'monogram' })}
            className={styles.radio}
          />
          <Avatar name={name || 'Организация'} size={56} shape="org" />
          <span className={styles.logoLabel}>Буквы названия</span>
        </label>
        {EMBLEMS.map((e) => {
          const on = value.kind === 'emblem' && value.emblem === e.key;
          return (
            <label key={e.key} className={[styles.logo, on && styles.logoOn].filter(Boolean).join(' ')}>
              <input
                type="radio"
                name="org-logo"
                checked={on}
                onChange={() => onChange({ kind: 'emblem', emblem: e.key, tone })}
                className={styles.radio}
              />
              <Avatar name={e.label} src={urls.get(e.key)} size={56} shape="org" />
              <span className={styles.logoLabel}>{e.label}</span>
            </label>
          );
        })}
      </div>
      {value.kind === 'emblem' && (
        <div className={styles.tones} role="group" aria-label="Цвет знака">
          {TONES.map((t) => (
            <Chip key={t.key} selected={tone === t.key} onClick={() => onChange({ ...value, tone: t.key })}>
              {t.label}
            </Chip>
          ))}
        </div>
      )}

      <input
        ref={input}
        className="sr-only"
        type="file"
        tabIndex={-1}
        accept="image/jpeg,image/png,image/webp"
        aria-label="Выбрать файл логотипа"
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
          id="org-logo-upload"
          variant="secondary"
          size="sm"
          icon={<ImageIcon size={20} aria-hidden />}
          onClick={() => input.current?.click()}
          aria-describedby={describedBy}
        >
          {upload ? 'Загрузить другой логотип' : 'Загрузить логотип'}
        </Button>
        {uploadOn && crop.canRecrop(upload) && (
          <Button
            variant="quiet"
            size="sm"
            icon={<CropIcon size={20} aria-hidden />}
            onClick={() => crop.recrop(upload)}
          >
            Изменить кадр
          </Button>
        )}
        {upload && (
          <Button variant="quiet" size="sm" icon={<TrashIcon size={20} aria-hidden />} onClick={remove}>
            Убрать картинку
          </Button>
        )}
      </div>

      <ImageCropper
        src={crop.editing?.url ?? null}
        title="Логотип"
        shape="rect"
        aspect={1}
        output={LOGO_OUTPUT}
        initial={crop.editing?.state}
        onCancel={crop.cancel}
        onSave={(url, state) => {
          setUpload(url);
          onChange({ kind: 'upload', url });
          crop.commit(state);
        }}
      />
    </div>
  );
}
