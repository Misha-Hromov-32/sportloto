import {
  ArrowsClockwise,
  Lock,
  MagnifyingGlass,
  Prohibit,
  SignIn,
  WarningCircle,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Button } from '../Button/Button';
import styles from './States.module.css';

interface StateProps {
  title: string;
  children?: ReactNode;
  /** Действия: одна главная кнопка и, при необходимости, вторая. */
  actions?: ReactNode;
  icon?: ReactNode;
  /** inline — внутри блока (список, вкладка); page — на весь экран. */
  layout?: 'inline' | 'page';
  tone?: 'neutral' | 'danger' | 'off';
}

function StateFrame({ title, children, actions, icon, layout = 'inline', tone = 'neutral' }: StateProps) {
  return (
    <section className={[styles.state, styles[layout], styles[tone]].join(' ')}>
      {icon && <span className={styles.icon}>{icon}</span>}
      <div className={styles.body}>
        <h2 className={styles.title}>{title}</h2>
        {children && <div className={styles.text}>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </section>
  );
}

/** Пусто: что здесь будет и первое действие. Без иллюстраций «тут пока пусто». */
export function EmptyState(props: StateProps) {
  return <StateFrame icon={props.icon ?? <MagnifyingGlass size={28} aria-hidden />} {...props} />;
}

/** Ошибка загрузки: что случилось и что сделать. */
export function ErrorState({
  title = 'Не удалось загрузить',
  children,
  onRetry,
  layout,
}: {
  title?: string;
  children?: ReactNode;
  onRetry?: () => void;
  layout?: StateProps['layout'];
}) {
  return (
    <StateFrame
      title={title}
      tone="danger"
      layout={layout}
      icon={<WarningCircle size={28} aria-hidden />}
      actions={
        onRetry && (
          <Button variant="secondary" icon={<ArrowsClockwise size={20} aria-hidden />} onClick={onRetry}>
            Повторить
          </Button>
        )
      }
    >
      {children ?? 'Проверьте интернет и попробуйте ещё раз.'}
    </StateFrame>
  );
}

/** Нет прав: почему и как получить. */
export function NoAccessState({
  title = 'Сюда нет доступа',
  children,
  actions,
  layout = 'page',
  guest,
  loginTo,
}: {
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  layout?: StateProps['layout'];
  /** Гость: показать кнопку входа с возвратом на страницу. */
  guest?: boolean;
  loginTo?: string;
}) {
  return (
    <StateFrame
      title={title}
      layout={layout}
      icon={guest ? <SignIn size={28} aria-hidden /> : <Lock size={28} aria-hidden />}
      actions={
        actions ??
        (guest ? (
          <Button variant="primary" to={`/login${loginTo ? `?to=${encodeURIComponent(loginTo)}` : ''}`}>
            Войти
          </Button>
        ) : (
          <Button variant="secondary" to="/events">
            Перейти к событиям
          </Button>
        ))
      }
    >
      {children}
    </StateFrame>
  );
}

/** Объект недоступен: снят, удалён, страница организации ещё не открыта. */
export function GoneState({
  title,
  children,
  actions,
  layout = 'page',
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  layout?: StateProps['layout'];
}) {
  return (
    <StateFrame
      title={title}
      layout={layout}
      tone="off"
      icon={<Prohibit size={28} aria-hidden />}
      actions={actions}
    >
      {children}
    </StateFrame>
  );
}
