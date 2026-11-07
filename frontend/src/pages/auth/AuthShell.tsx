import { useEffect, useRef, type ReactNode } from 'react';
import { boxedImageAttrs } from '@/lib/images';
import { useSelectedCity } from '@/lib/useSelectedCity';

import styles from './AuthShell.module.css';
import { SportsPattern } from '../landing/parts/SportsPattern';

const shown = boxedImageAttrs(
  '/img/landing/login.jpg',
  1.5,
  [
    { media: '(max-width: 1100px)', width: 443, height: 558 },
    { media: '(max-width: 1300px)', width: 518, height: 598 },
    { width: 584, height: 598 },
  ],
  { quality: 85 },
);

/** На ширине до 900px фото скрыто: браузер возьмёт самый маленький вариант. */
const PHOTO = { ...shown, sizes: `(max-width: 900px) 1px, ${shown.sizes}` };

export function AuthShell({
  title,
  subtitle,
  dot = true,
  focusTitle,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  /** Фирменная точка после заголовка; без неё — когда заголовок означает процесс («Подтверждаем почту»). */
  dot?: boolean;
  /** Экран сменился без перехода (письмо отправлено, ссылка проверена): фокус на новый заголовок. */
  focusTitle?: boolean;
  children: ReactNode;
}) {
  const city = useSelectedCity();
  const heading = useRef<HTMLHeadingElement>(null);
  const longWord = title.split(/\s+/).some((word) => word.length > 11);
  useEffect(() => {
    if (focusTitle) heading.current?.focus();
  }, [focusTitle, title]);
  return (
    <div className={styles.page} data-auth-page>
      <SportsPattern />
      <div className={styles.panel}>
        <div className={styles.media}>
          <img {...PHOTO} alt="Совместная игра в футбол на открытом поле" decoding="async" />
          <div className={styles.caption}>
            <p>Компания для спорта рядом с домом</p>
          </div>
          <span className={styles.city}>{city.name}</span>
        </div>
        <div className={styles.formSide}>
          <div className={styles.formCard}>
            <h1
              ref={heading}
              tabIndex={-1}
              className={longWord ? `${styles.title} ${styles.titleLong}` : styles.title}
            >
              {title}
              {dot && <span>.</span>}
            </h1>
            <p className={styles.subtitle}>{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
