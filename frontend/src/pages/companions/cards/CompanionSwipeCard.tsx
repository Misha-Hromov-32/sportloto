import {
  CaretDownIcon,
  CaretUpIcon,
  ClockIcon,
  FlagIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  SparkleIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { AvatarStack, SportIcon } from '@/components';
import { formatAgo } from '@/lib/dates';
import { formatDistance } from '@/lib/geo';
import { SKILL_LEVEL } from '@/lib/labels';
import type { CompanionView } from '@/types/api';

import styles from './CompanionsCards.module.css';

function matchLine(reasons: string[]): string {
  return reasons.map((r) => r.charAt(0).toLowerCase() + r.slice(1)).join(', ');
}

/** A person first: portrait and name, followed by the activity they want company for. */
export function CompanionSwipeCard({
  companion: c,
  expanded,
  onToggle,
}: {
  companion: CompanionView;
  expanded: boolean;
  onToggle: () => void;
}) {
  const faceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!expanded && faceRef.current) faceRef.current.scrollTop = 0;
  }, [expanded]);
  const organize = c.readiness === 'organize';
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const photo = c.author.avatarUrl;

  return (
    <article ref={faceRef} className={styles.face} data-expanded={expanded ? '' : undefined}>
      <header className={styles.portrait}>
        {photo && failedPhoto !== photo ? (
          <img
            className={styles.photo}
            src={photo}
            alt={`${c.isDemo ? 'Сгенерированный портрет' : 'Фото'}: ${c.author.name}`}
            draggable={false}
            decoding="async"
            onError={() => setFailedPhoto(photo)}
          />
        ) : (
          <div className={styles.photoFallback} aria-label="Фотография пока не добавлена">
            <span>{c.author.initials}</span>
            <SportIcon sport={c.sport} size={160} weight="regular" />
          </div>
        )}
        <span className={styles.readiness}>
          {c.isDemo && 'Демо · '}
          {organize ? (
            <FlagIcon size={16} weight="fill" aria-hidden />
          ) : (
            <MagnifyingGlassIcon size={16} aria-hidden />
          )}
          {organize ? 'Соберёт встречу' : 'Ищет компанию'}
        </span>
        <div className={styles.person}>
          <h2 className={styles.personName}>{c.author.name}</h2>
          <p className={styles.location}>
            <MapPinIcon size={16} aria-hidden />
            {c.districtName ?? 'Район не указан'}
            {c.distanceKm !== null && ` · ${formatDistance(c.distanceKm)} от вас`}
          </p>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.activity}>
          <span className={styles.sportName}>
            <SportIcon sport={c.sport} size={22} />
            {c.sport.name}
          </span>
          <span className={styles.level}>{SKILL_LEVEL[c.level]}</span>
        </div>
        <p className={styles.text}>{c.text}</p>

        <ul className={styles.meta}>
          <li>
            <ClockIcon size={18} aria-hidden />
            <span>{c.when}</span>
          </li>
        </ul>

        {c.matchReasons.length > 0 && (
          <p className={styles.match}>
            <SparkleIcon size={18} weight="fill" aria-hidden />
            <span>Почему вам подходит: {matchLine(c.matchReasons)}</span>
          </p>
        )}

        <p className={styles.metoo}>
          {c.metooCount > 0 ? (
            <>
              <AvatarStack people={c.metooPeople} max={4} />
              <span>
                Тоже {c.metooCount === 1 ? 'хочет' : 'хотят'}: <strong className="num">{c.metooCount}</strong>
              </span>
            </>
          ) : (
            <span>Пока никто не откликнулся. Можно стать первым</span>
          )}
        </p>

        {expanded && (
          <div className={styles.details}>
            <p className={styles.detailsText}>Объявление опубликовано {formatAgo(c.createdAt)}.</p>
            {c.metooPeople.length > 0 && (
              <p className={styles.detailsText}>
                Откликнулись: {c.metooPeople.map((p) => p.name).join(', ')}.
              </p>
            )}
            <p className={styles.detailsText}>
              {organize
                ? 'Автор готов сам собрать встречу. Нажмите «Я тоже»: вы появитесь в списке откликнувшихся.'
                : 'Автор ищет, к кому присоединиться. Нажмите «Я тоже» или позовите на свою встречу.'}
            </p>
            <Link to={`/profile/${c.author.id}`} className={styles.profileLink}>
              Открыть профиль: {c.author.name}
            </Link>
          </div>
        )}
      </div>

      <div className={styles.foot}>
        <button type="button" className={styles.more} onClick={onToggle} aria-expanded={expanded}>
          {expanded ? 'Свернуть' : 'Подробнее'}
          {expanded ? <CaretUpIcon size={16} aria-hidden /> : <CaretDownIcon size={16} aria-hidden />}
        </button>
      </div>
    </article>
  );
}
