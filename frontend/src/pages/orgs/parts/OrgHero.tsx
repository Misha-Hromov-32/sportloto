import { ClockCountdownIcon, MapPinIcon, SealCheckIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Avatar } from '@/components';
import { imageAttrs } from '@/lib/images';

import styles from './OrgHero.module.css';
import { SportsPattern } from '../../landing/parts/SportsPattern';

/** Обложка страницы: ширина к высоте. Под эту пропорцию кадрируется фото в форме. */
export const ORG_COVER_RATIO = 3;

const COVER_IMAGE = {
  width: 1312,
  height: Math.round(1312 / ORG_COVER_RATIO),
  sizes: '(max-width: 1360px) 100vw, 1312px',
  widths: [480, 768, 1024, 1312, 1600],
};

export interface HeroFact {
  value: string;
  label: string;
}

interface OrgHeroProps {
  name: string;
  typeLabel: string;
  logoUrl: string | null;
  /** Широкое фото над шапкой. Без него шапка такая же, как раньше. */
  coverUrl?: string | null;
  city: string;
  districtName: string | null;
  /** true — допущена; 'preview' — метка покажется после допуска. */
  verified: boolean | 'preview';
  facts?: HeroFact[];
  /** Фото с встреч организации — лента, как в герое вёрстки. */
  photos?: string[];
  /** h1 на странице организации, p в предпросмотре внутри формы. */
  as?: 'h1' | 'p';
  children?: ReactNode;
}

/** Шапка страницы организации в эстетике героя вёрстки: крупное имя, карточка клуба, лента фото со встреч. */
/**
 * Карточки фото тянутся по сетке (до четырёх в ряд), высота постоянная.
 * Фото не обрезаем: пропорции снимков со встреч заранее неизвестны.
 */
function stripImage(count: number) {
  const columns = Math.max(1, Math.min(count, 4));
  return {
    width: 340,
    height: 224,
    crop: false,
    sizes: `(max-width: 640px) 288px, max(${Math.round(85 / columns)}vw, 336px)`,
    widths: [320, 480, 640, 960, 1280],
  };
}

export function OrgHero({
  name,
  typeLabel,
  logoUrl,
  coverUrl,
  city,
  districtName,
  verified,
  facts,
  photos = [],
  as = 'h1',
  children,
}: OrgHeroProps) {
  const Title = as;
  const title = name || 'Название организации';
  const area = [city, districtName].filter(Boolean).join(', ');
  return (
    <header className={styles.hero}>
      {as === 'h1' && <SportsPattern />}
      {coverUrl && (
        <div className={styles.cover}>
          <img {...imageAttrs(coverUrl, COVER_IMAGE)} alt={`Обложка: ${title}`} decoding="async" />
        </div>
      )}
      <div className={styles.grid}>
        <div className={styles.text}>
          <span className={styles.badge}>{typeLabel}</span>
          <Title className={styles.name}>
            {title}
            <span>.</span>
          </Title>
          {area && (
            <p className={styles.place}>
              <MapPinIcon size={20} aria-hidden />
              {area}
            </p>
          )}
          {children}
        </div>

        <div className={styles.card}>
          <div className={styles.cardHead}>
            <Avatar name={title} src={logoUrl} size={56} shape="org" />
            <div className={styles.cardName}>
              <b>{title}</b>
              <small>{typeLabel}</small>
            </div>
          </div>
          {facts && facts.length > 0 && (
            <dl className={styles.facts}>
              {facts.map((f) => (
                <div key={f.label} className={styles.fact}>
                  <dt className={styles.factLabel}>{f.label}</dt>
                  <dd className={styles.factValue}>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {verified === true && (
            <p className={[styles.status, styles.statusOk].join(' ')}>
              <SealCheckIcon size={20} weight="fill" aria-hidden />
              Организация проверена
            </p>
          )}
          {verified === 'preview' && (
            <p className={[styles.status, styles.statusWait].join(' ')}>
              <ClockCountdownIcon size={20} aria-hidden />
              Метка «Организация проверена» появится после допуска
            </p>
          )}
        </div>
      </div>
      {photos.length > 0 && (
        <ul className={styles.strip} aria-label="Фото со встреч">
          {photos.slice(0, 6).map((src, i) => (
            <li key={src} className={styles[`strip${i % 3}`]}>
              <img {...imageAttrs(src, stripImage(photos.length))} alt="" loading="lazy" decoding="async" />
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}
