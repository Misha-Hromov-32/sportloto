import { Link } from 'react-router';

import styles from './Logo.module.css';

/** Вариант №3: беговые дорожки сходятся к красной точке — финишу и месту встречи. */
export function Logo({ to = '/', compact }: { to?: string; compact?: boolean }) {
  return (
    <Link to={to} className={styles.logo} aria-label="Спорт и точка — на главную">
      <svg className={styles.mark} viewBox="0 0 76 40" aria-hidden>
        <path d="M55 4H25C12 4 4 9.3 4 20S12 36 25 36h30" className={styles.trackOuter} />
        <path d="M55 12H26c-7.8 0-12 2.7-12 8s4.2 8 12 8h29" className={styles.trackInner} />
        <circle cx="66" cy="28" r="9" className={styles.finishDot} />
      </svg>
      {!compact && (
        <span className={styles.word} aria-hidden>
          <span>Спорт</span>
          <span>и точка</span>
        </span>
      )}
    </Link>
  );
}
