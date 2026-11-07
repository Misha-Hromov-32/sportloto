const RESIZABLE_HOST = 'images.unsplash.com';
const QUALITY = 70;

function parse(url: string): URL | null {
  if (!url.startsWith('https://')) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname === RESIZABLE_HOST ? parsed : null;
  } catch {
    return null;
  }
}

/** Фото можно запросить нужного размера (сейчас это фотобанк Unsplash). Остальные адреса отдаются как есть. */
export function isResizable(url: string): boolean {
  return parse(url) !== null;
}

/**
 * Адрес фото шириной `width`. С `height` фото обрезается по центру до этих пропорций;
 * без него сохраняются исходные пропорции.
 */
export function resizeImage(url: string, width: number, height?: number, quality = QUALITY): string {
  const parsed = parse(url);
  if (!parsed) return url;
  const params = parsed.searchParams;
  params.set('w', String(Math.round(width)));
  if (height) params.set('h', String(Math.round(height)));
  else params.delete('h');
  params.set('fit', 'crop');
  params.set('q', String(quality));
  params.set('auto', 'format');
  return parsed.toString();
}

export interface ImageOptions {
  /** Ширина, под которую сделан макет (для атрибутов width/height и 1x). */
  width: number;
  /** Высота при этой ширине: задаёт пропорции и атрибут height. */
  height: number;
  /**
   * Обрезать фото до пропорций width:height на стороне фотобанка.
   * Выключать, когда пропорции блока меняются от ширины экрана сильнее, чем у самого фото.
   */
  crop?: boolean;
  /** Атрибут sizes. Без него srcset строится по плотности экрана (1x, 2x). */
  sizes?: string;
  /** Ширины для srcset при заданном sizes. */
  widths?: readonly number[];
  quality?: number;
}

export interface ImageAttrs {
  src: string;
  srcSet?: string;
  sizes?: string;
  width: number;
  height: number;
}

/** Атрибуты <img>: src, srcSet, sizes и размеры под фактический блок. */
export function imageAttrs(url: string, options: ImageOptions): ImageAttrs {
  const { width, height, crop = true, sizes, quality } = options;
  const box = { width: Math.round(width), height: Math.round(height) };
  if (!isResizable(url)) return { src: url, ...box };
  const at = (w: number) => resizeImage(url, w, crop ? (w * height) / width : undefined, quality);
  if (!sizes) {
    return { src: at(width), srcSet: `${at(width)} 1x, ${at(width * 2)} 2x`, ...box };
  }
  const widths = [...new Set((options.widths ?? [width, width * 1.5, width * 2]).map(Math.round))].sort(
    (a, b) => a - b,
  );
  return {
    src: at(width),
    srcSet: widths.map((w) => `${at(w)} ${w}w`).join(', '),
    sizes,
    ...box,
  };
}

export interface ImageBox {
  /** Медиазапрос для sizes; у последнего блока (по умолчанию) его нет. */
  media?: string;
  width: number;
  height: number;
}

/** Пропорции типичной обложки, когда точные неизвестны (фото события или площадки). */
export const COVER_RATIO = 1.5;

/**
 * Для блока с object-fit: cover, чьи пропорции меняются на разных ширинах экрана.
 * `ratio` — исходные пропорции фото (ширина / высота). Обрезка подбирается так,
 * что на каждой ширине виден тот же кадр, что и у необрезанного фото, а файл не больше нужного.
 * С `crop: false` фото не обрезается — для обложек, чьи пропорции заранее неизвестны:
 * кадр тогда точно прежний, а ширина считается по `ratio`.
 * Блоки перечисляются в порядке sizes: сначала с медиазапросами, последним — без.
 */
export function boxedImageAttrs(
  url: string,
  ratio: number,
  boxes: readonly ImageBox[],
  { crop = true, quality }: { crop?: boolean; quality?: number } = {},
): ImageAttrs {
  const aspects = boxes.map((b) => b.width / b.height);
  const aspect = crop ? Math.min(Math.max(ratio, Math.min(...aspects)), Math.max(...aspects)) : ratio;
  const need = boxes.map((b) => Math.ceil(Math.max(b.width, b.height * aspect)));
  const width = need[need.length - 1] ?? boxes[0]?.width ?? 0;
  return imageAttrs(url, {
    width,
    height: width / aspect,
    crop,
    sizes: boxes.map((b, i) => [b.media, `${need[i]}px`].filter(Boolean).join(' ')).join(', '),
    widths: [...need, ...need.map((w) => w * 2)],
    quality,
  });
}
