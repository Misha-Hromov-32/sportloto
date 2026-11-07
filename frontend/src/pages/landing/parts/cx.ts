import styles from './Landing.module.css';

/** Классы CSS-модуля лендинга по именам из исходной вёрстки: cx('btn', 'btn--red'). */
export const cx = (...names: (string | false | null | undefined)[]) =>
  names
    .filter((n): n is string => Boolean(n))
    .map((n) => styles[n] ?? '')
    .join(' ');
