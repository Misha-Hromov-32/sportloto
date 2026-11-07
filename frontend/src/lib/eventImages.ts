const MAX_IMAGE_LENGTH = 160_000;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const QUALITIES = [0.85, 0.75, 0.6, 0.45];

export function validEventImage(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_LENGTH) return false;
  return (
    /^\/(?:media\/(?:covers|people)|img|demo\/people)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$(?![\s\S])/i.test(
      value,
    ) ||
    /^https:\/\/[^\s]+$/i.test(value) ||
    /^data:image\/(jpeg|png|webp);base64,[a-z\d+/]+=*$/i.test(value)
  );
}

export const ORG_EMBLEM_KEYS = ['ball', 'peaks', 'waves', 'star', 'stripes', 'target'] as const;
export type OrgEmblemKey = (typeof ORG_EMBLEM_KEYS)[number];

const MAX_EMBLEM_LENGTH = 4000;
const EMBLEM_PREFIX = 'data:image/svg+xml;utf8,';
const EMBLEM_URL = /^data:image\/svg\+xml;utf8,[A-Za-z0-9\-_.!~*'()%]+$/;
const BAD_ESCAPE = /%(?![0-9A-Fa-f]{2})/;
const EMBLEM_SVG =
  /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64" data-emblem="([a-z]+)" data-tone="(accent|ink)">[\s\S]*<\/svg>$/;
const EMBLEM_UNSAFE = /<script|<foreignobject|<!|\son[a-z]+\s*=|href|javascript:|url\(|@import/i;

/** Логотип организации: картинка как у события или готовый SVG-знак из формы (`emblemUrl`). */
export function validOrgLogo(value: unknown): value is string {
  if (validEventImage(value)) return true;
  if (
    typeof value !== 'string' ||
    value.length > MAX_EMBLEM_LENGTH ||
    !EMBLEM_URL.test(value) ||
    BAD_ESCAPE.test(value)
  )
    return false;
  let svg: string;
  try {
    svg = decodeURIComponent(value.slice(EMBLEM_PREFIX.length));
  } catch {
    return false;
  }
  const key = EMBLEM_SVG.exec(svg)?.[1];
  return Boolean(key && (ORG_EMBLEM_KEYS as readonly string[]).includes(key) && !EMBLEM_UNSAFE.test(svg));
}

/** Проверка выбранного файла до того, как его открывать. */
export function checkImageFile(file: File): void {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Выберите фото в формате JPEG, PNG или WebP');
  if (file.size > 8 * 1024 * 1024) throw new Error('Файл должен быть не больше 8 МБ');
}

/** Самое качественное WebP-сжатие холста, которое укладывается в лимит сервера, или null. */
export function encodeCanvas(canvas: HTMLCanvasElement): string | null {
  for (const quality of QUALITIES) {
    const url = canvas.toDataURL('image/webp', quality);
    if (validEventImage(url)) return url;
  }
  return null;
}

/** Уменьшаем локальное фото до сохранения в демонстрационном хранилище. */
export async function prepareEventImage(file: File): Promise<string> {
  checkImageFile(file);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Не удалось прочитать фото. Выберите другой файл');
  });
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не смог подготовить фото');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = encodeCanvas(canvas);
    if (url) return url;
    throw new Error('Фото не получилось сжать до нужного размера. Выберите другой снимок');
  } finally {
    bitmap.close();
  }
}
