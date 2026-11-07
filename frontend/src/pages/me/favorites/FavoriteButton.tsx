import { HeartIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { ENGAGEMENT_API, errorMessage, useAction, useMe } from '@/lib/api';
import type { EventView } from '@/types/api';

import styles from './favorites.module.css';

type FavoriteEvent = Pick<EventView, 'id' | 'title' | 'favorite'>;

/** Сердечко «В избранное»: меняется сразу, при ошибке возвращается и объясняет. */
function useFavorite(event: FavoriteEvent) {
  const { me } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  const { run } = useAction();
  // Нажатие видно сразу; как только придёт ответ сервера, решает он
  const server = Boolean(event.favorite);
  const [pending, setPending] = useState<{ id: string; on: boolean; base: boolean } | null>(null);
  const on = pending && pending.id === event.id && pending.base === server ? pending.on : server;

  const toggle = async () => {
    if (!me) {
      navigate(`/login?to=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    const next = !on;
    setPending({ id: event.id, on: next, base: server });
    try {
      await run(ENGAGEMENT_API.favorite(event.id), {}, { method: next ? 'put' : 'delete', silent: true });
      message.success(next ? 'Добавлено в избранное. Список в «Моих занятиях»' : 'Убрано из избранного');
    } catch (error) {
      setPending(null);
      message.error(errorMessage(error, 'Не удалось сохранить. Попробуйте ещё раз'));
    }
  };

  return { on, toggle, hidden: me?.role === 'admin' };
}

const label = (on: boolean, title: string) =>
  on ? `Убрать «${title}» из избранного` : `Добавить «${title}» в избранное`;

/** Круглое сердечко поверх фото карточки в ленте. Карточка-ссылка оборачивается, чтобы кнопка не была внутри ссылки. */
export function FavoriteFrame({ event, children }: { event: FavoriteEvent; children: ReactNode }) {
  const { on, toggle, hidden } = useFavorite(event);
  return (
    <div className={styles.frame}>
      {children}
      {!hidden && (
        <button
          type="button"
          className={[styles.heart, on && styles.heartOn].filter(Boolean).join(' ')}
          aria-pressed={on}
          aria-label={label(on, event.title)}
          title={on ? 'В избранном' : 'В избранное'}
          onClick={() => void toggle()}
        >
          <HeartIcon size={22} weight={on ? 'fill' : 'bold'} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Кнопка с подписью для карточки события. */
export function FavoriteButton({ event }: { event: FavoriteEvent }) {
  const { on, toggle, hidden } = useFavorite(event);
  if (hidden) return null;
  return (
    <button
      type="button"
      className={[styles.favButton, on && styles.favButtonOn].filter(Boolean).join(' ')}
      aria-pressed={on}
      aria-label={label(on, event.title)}
      onClick={() => void toggle()}
    >
      <HeartIcon size={20} weight={on ? 'fill' : 'bold'} aria-hidden />
      <span>{on ? 'В избранном' : 'В избранное'}</span>
    </button>
  );
}
