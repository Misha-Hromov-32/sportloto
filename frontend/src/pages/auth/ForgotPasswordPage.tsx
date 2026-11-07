import { useForgotPassword, type AuthActionResponse } from '@refinedev/core';
import { Form, Input } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components';
import type { AuthFlowResult } from '@/types/api';

import { useAuthConfig, useMailSender } from './authEmail';
import { AuthShell } from './AuthShell';
import styles from './AuthShell.module.css';
import { AuthConfigError, AuthLoading, AuthNotice, MailStatus, ResendButton } from './parts/AuthFlow';
import flow from './parts/AuthFlow.module.css';

const TITLE = 'Сброс пароля';

function toFlow(res: AuthActionResponse): AuthFlowResult {
  return {
    ok: res.success,
    code: typeof res.code === 'string' ? res.code : undefined,
    message: res.error?.message,
    retryAfter: typeof res.retryAfter === 'number' ? res.retryAfter : undefined,
  };
}

export default function ForgotPasswordPage() {
  const config = useAuthConfig();
  const [sentTo, setSentTo] = useState('');
  const [email, setEmail] = useState('');
  const sender = useMailSender();
  const forgot = useForgotPassword<{ email: string }>({
    mutationOptions: { onSuccess: () => undefined, onError: () => undefined },
  });
  const send = async (address: string) => toFlow(await forgot.mutateAsync({ email: address }));

  if (config.isLoading) {
    return (
      <AuthShell title={TITLE} subtitle="Пришлём ссылку, чтобы задать новый пароль.">
        <div className={flow.body}>
          <AuthLoading>Загружаем…</AuthLoading>
        </div>
      </AuthShell>
    );
  }

  if (config.isError) return <AuthConfigError title={TITLE} onRetry={() => config.refetch()} />;

  if (!config.data?.passwordReset) {
    return (
      <AuthShell
        title={TITLE}
        subtitle="В этой версии письма не отправляются, поэтому сбросить пароль по почте нельзя."
      >
        <div className={flow.body}>
          <div className={flow.actions}>
            <Button variant="primary" block to="/login">
              Войти
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  if (sentTo) {
    return (
      <AuthShell title="Проверьте почту" focusTitle subtitle="Ссылка для нового пароля придёт в письме.">
        <div className={flow.body}>
          <AuthNotice tone="ok" role="status">
            Если такой адрес зарегистрирован, мы отправили письмо со ссылкой. Она действует 1 час.
          </AuthNotice>
          <p className={flow.hint}>Письма нет? Проверьте папку «Спам» или отправьте ещё раз.</p>
          <ResendButton send={() => send(sentTo)} />
          <p className={flow.links}>
            <button type="button" className={flow.linkButton} onClick={() => setSentTo('')}>
              Изменить почту
            </button>
            <Link to="/login">Войти</Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={TITLE}
      subtitle="Введите почту, с которой вы регистрировались. Пришлём ссылку, чтобы задать новый пароль."
    >
      <Form<{ email: string }>
        layout="vertical"
        requiredMark={false}
        className={styles.form}
        initialValues={{ email }}
        onFinish={async (values) => {
          const address = values.email.trim();
          setEmail(address);
          const res = await sender.run(() => send(address));
          if (res.ok) setSentTo(address);
        }}
      >
        <Form.Item
          label="Электронная почта"
          name="email"
          rules={[
            { required: true, message: 'Введите почту' },
            { type: 'email', message: 'Проверьте адрес почты' },
          ]}
        >
          <Input autoComplete="email" inputMode="email" />
        </Form.Item>
        <div className={flow.resend}>
          <Button
            type="submit"
            variant="primary"
            block
            loading={sender.busy}
            loadingText="Отправляем…"
            disabled={sender.waiting}
            className={styles.submit}
          >
            Отправить ссылку
          </Button>
          <MailStatus sender={sender} />
        </div>
      </Form>
      <p className={styles.switch}>
        Вспомнили пароль? <Link to="/login">Войти</Link>
      </p>
    </AuthShell>
  );
}
