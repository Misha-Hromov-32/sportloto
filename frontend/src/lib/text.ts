/** Нормализация для поиска и сравнения названий: регистр, ё, знаки препинания, лишние пробелы. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

export function initials(name: string): string {
  const words = name
    .replace(/[«»"]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => /[A-Za-zА-Яа-яЁё]/.test(w));
  const first = words[0]?.[0] ?? '?';
  const second = words.length > 1 ? (words[1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

export function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

export const NBSP = '\u00A0';
