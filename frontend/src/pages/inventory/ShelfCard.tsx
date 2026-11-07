import { MapPinIcon, PencilSimpleIcon, ShoppingCartSimpleIcon, TrashIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { Button } from '@/components';
import { formatRub } from '@/lib/money';
import { usePaymentAvailability } from '@/lib/payments';
import type { ShelfItemView } from '@/types/inventory';

import { GearPicture } from './GearPicture';
import styles from './inventory.module.css';
import { CONDITION, TERM } from './labels';

interface ShelfCardProps {
  item: ShelfItemView;
  /** Главное действие для чужой вещи: «Попросить на это событие» и т. п. */
  requestLabel?: string;
  onRequest?: (item: ShelfItemView) => void;
  /** Гость: вместо просьбы — вход с возвратом на эту страницу. */
  loginTo?: string;
  onEdit?: (item: ShelfItemView) => void;
  onRemove?: (item: ShelfItemView) => void;
  removing?: boolean;
  /** Вещь продаётся: открыть покупку. */
  onBuy?: (item: ShelfItemView) => void;
}

export function ShelfCard({
  item,
  requestLabel,
  onRequest,
  loginTo,
  onEdit,
  onRemove,
  removing,
  onBuy,
}: ShelfCardProps) {
  const paymentAvailability = usePaymentAvailability();
  const none = item.available === 0;
  const sale = item.sale ?? null;
  return (
    <article className={styles.card} aria-labelledby={`shelf-${item.id}`}>
      <GearPicture kind={item.kind} name={item.name} photoUrl={item.photoUrl} />
      <div className={styles.cardBody}>
        <h3 id={`shelf-${item.id}`} className={styles.cardTitle}>
          {item.name}
        </h3>
        <p className={styles.owner}>
          <Link to={item.ownerView.link}>{item.ownerView.name}</Link>
          {item.ownerView.orgType === 'sponsor' && <span className={styles.ownerTag}>Партнёр</span>}
        </p>
        {sale && (
          <p className={styles.price}>
            {formatRub(sale.price)}
            <span>{item.quantity > 1 ? 'за штуку, продаётся' : 'продаётся'}</span>
          </p>
        )}
        <p className={[styles.stock, none && styles.stockNone].filter(Boolean).join(' ')}>
          {none
            ? sale
              ? 'Всё раскупили'
              : 'Сейчас всё на руках'
            : sale
              ? `В наличии: ${item.available}`
              : `Свободно: ${item.available} из ${item.quantity}`}
        </p>
        <ul className={styles.facts}>
          {item.districtName && (
            <li>
              <MapPinIcon size={16} aria-hidden />
              {item.districtName}
            </li>
          )}
          <li>Состояние: {CONDITION[item.condition].toLowerCase()}</li>
          {item.sportName && <li>{item.sportName}</li>}
        </ul>
        {item.terms.length > 0 && (
          <ul className={styles.terms} aria-label="Условия">
            {item.terms.map((t) => (
              <li key={t}>{TERM[t]}</li>
            ))}
          </ul>
        )}
        {item.note && <p className={styles.note}>{item.note}</p>}
        {item.isMine && item.pendingRequests > 0 && (
          <p className={styles.attention}>Просят: {item.pendingRequests}. Ответьте во вкладке «Моя полка»</p>
        )}
      </div>
      <div className={styles.cardActions}>
        {item.isMine ? (
          <>
            {onEdit && (
              <Button
                size="sm"
                variant="secondary"
                icon={<PencilSimpleIcon size={18} aria-hidden />}
                onClick={() => onEdit(item)}
              >
                Изменить
              </Button>
            )}
            {onRemove && (
              <Button
                size="sm"
                variant="quiet"
                icon={<TrashIcon size={18} aria-hidden />}
                loading={removing}
                loadingText="Убираем…"
                onClick={() => onRemove(item)}
              >
                Убрать с полки
              </Button>
            )}
          </>
        ) : sale && paymentAvailability.data?.enabled !== true ? (
          <span>Покупка через сайт отключена</span>
        ) : loginTo ? (
          <Button size="sm" variant="secondary" to={`/login?to=${encodeURIComponent(loginTo)}`}>
            {sale ? 'Войти, чтобы купить' : 'Войти, чтобы попросить'}
          </Button>
        ) : sale ? (
          onBuy ? (
            <Button
              size="sm"
              variant="primary"
              disabled={none}
              icon={<ShoppingCartSimpleIcon size={18} aria-hidden />}
              onClick={() => onBuy(item)}
            >
              Купить
            </Button>
          ) : null
        ) : onRequest ? (
          <Button size="sm" variant="secondary" disabled={none} onClick={() => onRequest(item)}>
            {requestLabel ?? 'Попросить на событие'}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
