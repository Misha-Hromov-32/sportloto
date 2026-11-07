import { CheckCircle, CircleNotch, Clock, EnvelopeSimple, Info, WarningCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Button } from '@/components';
import type { AuthFlowResult } from '@/types/api';

import { useMailSender, waitText } from '../authEmail';
import { AuthShell } from '../AuthShell';
import styles from './AuthFlow.module.css';

type Tone = 'neutral' | 'ok' | 'wait' | 'danger';

const ICONS: Record<Tone, ReactNode> = {
  neutral: <EnvelopeSimple size={24} weight="bold" aria-hidden />,
  ok: <CheckCircle size={24} weight="fill" aria-hidden />,
  wait: <Info size={24} weight="fill" aria-hidden />,
  danger: <WarningCircle size={24} weight="fill" aria-hidden />,
};

/** Сообщение рядом с формой: цвет, значок и текст вместе. */
export function AuthNotice({
  tone = 'neutral',
  title,
  children,
  role,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <div
      className={[styles.notice, tone !== 'neutral' && styles[tone]].filter(Boolean).join(' ')}
      role={role}
    >
      {ICONS[tone]}
      <div>
        {title && <p className={styles.noticeTitle}>{title}</p>}
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}

export function AuthLoading({ children }: { children: ReactNode }) {
  return (
    <p className={styles.loading} role="status">
      <CircleNotch size={28} weight="bold" className={styles.spinner} aria-hidden />
      {children}
    </p>
  );
}

export function MailStatus({
  sender,
  sentText = 'Письмо отправлено. Проверьте почту',
}: {
  sender: ReturnType<typeof useMailSender>;
  sentText?: string;
}) {
  const { result, left } = sender;
  if (left > 0) {
    return (
      <p className={[styles.status, styles.statusWait].join(' ')} role="timer">
        <Clock size={20} weight="bold" aria-hidden />
        <span>Отправить снова можно через {waitText(left)}</span>
      </p>
    );
  }
  if (result?.ok) {
    return (
      <p className={[styles.status, styles.statusOk].join(' ')} role="status">
        <CheckCircle size={20} weight="fill" aria-hidden />
        <span>{sentText}</span>
      </p>
    );
  }
  if (result && result.code !== 'rate_limited') {
    return (
      <p className={[styles.status, styles.statusDanger].join(' ')} role="alert">
        <WarningCircle size={20} weight="fill" aria-hidden />
        <span>{result.message || 'Не удалось отправить письмо. Попробуйте ещё раз'}</span>
      </p>
    );
  }
  return null;
}

/** Повторная отправка письма отдельной кнопкой. */
export function ResendButton({
  send,
  label = 'Отправить ещё раз',
  sentText,
}: {
  send: () => Promise<AuthFlowResult>;
  label?: string;
  sentText?: string;
}) {
  const sender = useMailSender();
  return (
    <div className={styles.resend}>
      <Button
        variant="secondary"
        block
        loading={sender.busy}
        loadingText="Отправляем…"
        disabled={sender.waiting}
        onClick={() => sender.run(send)}
      >
        {label}
      </Button>
      <MailStatus sender={sender} sentText={sentText} />
    </div>
  );
}

/** Настройки входа не загрузились: сервер недоступен. */
export function AuthConfigError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <AuthShell title={title} subtitle="Не удалось связаться с сервером.">
      <div className={styles.body}>
        <AuthNotice tone="danger" role="alert">
          Проверьте интернет и попробуйте ещё раз.
        </AuthNotice>
        <div className={styles.actions}>
          <Button variant="primary" block onClick={onRetry}>
            Повторить
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
