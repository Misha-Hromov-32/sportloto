import type { Area, Point } from 'react-easy-crop';

import { encodeCanvas } from '@/lib/eventImages';

export interface CropState {
  crop: Point;
  zoom: number;
  rotation: number;
}

export const INITIAL_CROP: CropState = { crop: { x: 0, y: 0 }, zoom: 1, rotation: 0 };

export interface CropOutput {
  /** Ширина готового фото. Высота считается по пропорциям кадра. */
  width: number;
  /** Не растягивать маленький кадр до `width`: для обложек, а не для аватара. */
  shrinkOnly?: boolean;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось прочитать фото. Выберите другой файл'));
    image.src = src;
  });
}

/**
 * Вырезает кадр из повёрнутого на `rotation` (кратно 90°) фото и сжимает в WebP под лимит сервера.
 * `area` приходит в пикселях повёрнутого изображения, поэтому рисуем сразу с поворотом, без промежуточного холста.
 */
export async function cropImage(
  src: string,
  area: Area,
  rotation: number,
  output: CropOutput,
): Promise<string> {
  const image = await loadImage(src);
  const turned = Math.abs(rotation % 180) === 90;
  const boxW = turned ? image.naturalHeight : image.naturalWidth;
  const boxH = turned ? image.naturalWidth : image.naturalHeight;
  let width = Math.max(1, output.shrinkOnly ? Math.min(output.width, Math.round(area.width)) : output.width);
  for (;;) {
    const height = Math.max(1, Math.round((width * area.height) / area.width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не смог подготовить фото');
    context.imageSmoothingQuality = 'high';
    context.scale(width / area.width, height / area.height);
    context.translate(-area.x + boxW / 2, -area.y + boxH / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    const url = encodeCanvas(canvas);
    if (url) return url;
    if (width <= 240) break;
    width = Math.max(240, Math.round(width * 0.8));
  }
  throw new Error('Фото не получилось сжать до нужного размера. Выберите другой снимок');
}
