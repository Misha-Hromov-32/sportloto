import { ArrowClockwiseIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon } from '@phosphor-icons/react';
import { Modal } from 'antd';
import { useId, useState, type KeyboardEvent } from 'react';
import Cropper, { type Area, type Point } from 'react-easy-crop';

import { Button } from '../Button/Button';
import { cropImage, INITIAL_CROP, type CropOutput, type CropState } from './cropImage';
import styles from './ImageCropper.module.css';

export type { CropState } from './cropImage';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;

interface ImageCropperProps {
  /** Исходное фото (адрес объекта или data URL). Пока null, окно закрыто. */
  src: string | null;
  title: string;
  /** Круг для фото профиля, прямоугольник для обложки. */
  shape: 'round' | 'rect';
  /** Ширина к высоте. */
  aspect: number;
  output: CropOutput;
  /** Положение кадра с прошлого раза, чтобы «Изменить кадр» открывался там же. */
  initial?: CropState;
  onCancel: () => void;
  /** Ошибку из обещания окно покажет само и останется открытым. */
  onSave: (url: string, state: CropState) => void | Promise<void>;
}

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));

export function ImageCropper({ src, ...rest }: ImageCropperProps) {
  return (
    <Modal
      open={src !== null}
      title={rest.title}
      onCancel={rest.onCancel}
      footer={null}
      width={640}
      centered
      destroyOnHidden
      maskClosable={false}
    >
      {src && <CropperBody key={src} src={src} {...rest} />}
    </Modal>
  );
}

function CropperBody({
  src,
  shape,
  aspect,
  output,
  initial = INITIAL_CROP,
  onCancel,
  onSave,
}: ImageCropperProps & { src: string }) {
  const [crop, setCrop] = useState<Point>(initial.crop);
  const [zoom, setZoom] = useState(initial.zoom);
  const [rotation, setRotation] = useState(initial.rotation);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  const zoomId = useId();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === '+' || event.key === '=') setZoom((z) => clampZoom(z + ZOOM_STEP));
    else if (event.key === '-' || event.key === '_') setZoom((z) => clampZoom(z - ZOOM_STEP));
    else return;
    event.preventDefault();
  };

  const save = async () => {
    if (!area) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(await cropImage(src, area, rotation, output), { crop, zoom, rotation });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось сохранить фото. Попробуйте ещё раз');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.body}>
      <p id={hintId} className={styles.hint}>
        Двигайте фото, чтобы выбрать нужную часть. Размер меняется ползунком, колёсиком мыши или двумя
        пальцами.
      </p>
      <div className={styles.stage} onKeyDown={onKeyDown}>
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={aspect}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          cropShape={shape}
          showGrid={shape === 'rect'}
          objectFit="contain"
          keyboardStep={10}
          onCropChange={setCrop}
          onZoomChange={(z) => setZoom(clampZoom(z))}
          onCropComplete={(_, pixels) => setArea(pixels)}
          classes={{ cropAreaClassName: styles.cropArea }}
          cropperProps={{
            'aria-label': 'Рамка кадра. Стрелки двигают фото, плюс и минус меняют размер',
            'aria-describedby': hintId,
          }}
          mediaProps={{ alt: '' }}
        />
      </div>

      <div className={styles.controls}>
        <div className={styles.zoom}>
          <Button
            variant="quiet"
            size="sm"
            icon={<MagnifyingGlassMinusIcon size={22} aria-hidden />}
            aria-label="Уменьшить"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
          />
          <label htmlFor={zoomId} className="sr-only">
            Размер фото
          </label>
          <input
            id={zoomId}
            className={styles.range}
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            aria-valuetext={`${Math.round(zoom * 100)}%`}
            onChange={(e) => setZoom(clampZoom(Number(e.target.value)))}
          />
          <Button
            variant="quiet"
            size="sm"
            icon={<MagnifyingGlassPlusIcon size={22} aria-hidden />}
            aria-label="Увеличить"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<ArrowClockwiseIcon size={20} aria-hidden />}
          onClick={() => setRotation((r) => (r + 90) % 360)}
        >
          Повернуть
        </Button>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={!area}
          loading={saving}
          loadingText="Сохраняем…"
        >
          Сохранить
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
