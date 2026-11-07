import { CircleNotch } from '@phosphor-icons/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';

import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  block?: boolean;
  loading?: boolean;
  /** Подпись, пока идёт действие: «Записываем…». */
  loadingText?: string;
  className?: string;
  children?: ReactNode;
}

type AsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { to?: undefined };
type AsLink = CommonProps & {
  to: string;
  replace?: boolean;
  state?: unknown;
  onClick?: () => void;
  'aria-label'?: string;
  disabled?: boolean;
};

export type ButtonProps = AsButton | AsLink;

/**
 * Кнопка пользовательского контура. Одна главная (primary) на экран.
 * С `to` рендерится ссылкой, но выглядит и ведёт себя как кнопка.
 */
export function Button(props: ButtonProps) {
  const {
    variant = 'secondary',
    size = 'md',
    icon,
    iconAfter,
    block,
    loading,
    loadingText,
    className,
    children,
  } = props;
  const cls = [
    styles.button,
    styles[variant],
    styles[size],
    block && styles.block,
    loading && styles.loading,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      {loading ? <CircleNotch className={styles.spinner} size={20} weight="bold" aria-hidden /> : icon}
      {(loading && loadingText) || children ? (
        <span className={styles.label}>{loading && loadingText ? loadingText : children}</span>
      ) : null}
      {!loading && iconAfter}
    </>
  );

  if (props.to !== undefined) {
    const { to, replace, state, onClick, disabled } = props;
    if (disabled) {
      return (
        <span className={cls} aria-disabled="true" role="link">
          {content}
        </span>
      );
    }
    return (
      <Link
        to={to}
        replace={replace}
        state={state}
        onClick={onClick}
        className={cls}
        aria-label={props['aria-label']}
      >
        {content}
      </Link>
    );
  }

  const {
    variant: _v,
    size: _s,
    icon: _i,
    iconAfter: _ia,
    block: _b,
    loading: _l,
    loadingText: _lt,
    className: _c,
    children: _ch,
    type = 'button',
    disabled,
    ...rest
  } = props;
  return (
    <button
      {...rest}
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {content}
    </button>
  );
}
