import { Form, Input } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { Button } from '@/components';
import type { AuthFlowResult } from '@/types/api';

import {
  pendingSignup,
  resendVerification,
  useApplySignIn,
  useAuthConfig,
  useMailSender,
  verifyOnce,
} from './authEmail';
import { AuthShell } from './AuthShell';
import styles from './AuthShell.module.css';
import { AuthLoading, AuthNotice, MailStatus } from './parts/AuthFlow';
import flow from './parts/AuthFlow.module.css';

const NO_TOKEN: AuthFlowResult = { ok: false, code: 'token_invalid' };
const NO_MAIL: AuthFlowResult = { ok: false, code: 'offline' };

function SignedInActions() {
  return (
    <div className={flow.body}>
      <div className={flow.actions}>
        <Button variant="primary" block to="/events">
          Найти встречу
        </Button>
        <Button variant="secondary" block to="/me">
          Открыть кабинет
        </Button>
      </div>
    </div>
  );
}

function ResendForm() {
  const sender = useMailSender();
  return (
    <Form<{ email: string }>
      layout="vertical"
      requiredMark={false}
      className={styles.form}
      initialValues={{ email: pendingSignup.get()?.email ?? '' }}
      onFinish={({ email }) => sender.run(() => resendVerification(email.trim()))}
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
          Отправить новое письмо
        </Button>
        <MailStatus
          sender={sender}
          sentText="Письмо отправлено. Откройте его и нажмите «Подтвердить почту»"
        />
      </div>
    </Form>
  );
}

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() ?? '';
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; result: AuthFlowResult } | null>(null);
  const applySignIn = useApplySignIn();
  const key = `${token}#${attempt}`;

  useEffect(() => {
    if (!token) return;
    let alive = true;
    verifyOnce(token, attempt).then(async (result) => {
      if (result.ok) {
        pendingSignup.clear();
        await applySignIn();
      }
      if (alive) setState({ key, result });
    });
    return () => {
      alive = false;
    };
  }, [key, token, attempt, applySignIn]);

  const config = useAuthConfig();
  const withoutToken =
    config.data && !config.data.emailVerification ? NO_MAIL : config.isPending ? null : NO_TOKEN;
  const result = !token ? withoutToken : state?.key === key ? state.result : null;
  const location = useLocation();
  const byPhone = !token && (location.state as { signedIn?: string } | null)?.signedIn === 'phone';

  if (byPhone) {
    return (
      <AuthShell
        title="Готово, вы вошли"
        focusTitle
        subtitle="Аккаунт подтверждён. Теперь можно записываться на занятия и создавать свои."
      >
        <SignedInActions />
      </AuthShell>
    );
  }

  if (!result) {
    return (
      <AuthShell title="Подтверждаем почту" dot={false} subtitle="Проверяем ссылку из письма.">
        <div className={flow.body}>
          <AuthLoading>Это займёт несколько секунд…</AuthLoading>
        </div>
      </AuthShell>
    );
  }

  if (result.ok) {
    return (
      <AuthShell
        title="Почта подтверждена"
        focusTitle
        subtitle="Вы вошли в аккаунт. Теперь можно записываться на занятия и создавать свои."
      >
        <SignedInActions />
      </AuthShell>
    );
  }

  if (result.code === 'token_used') {
    return (
      <AuthShell
        title="Почта уже подтверждена"
        focusTitle
        subtitle="Эта ссылка уже сработала. Войдите с почтой и паролем."
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

  if (result.code === 'offline') {
    return (
      <AuthShell
        title="Письма не отправляются"
        focusTitle
        subtitle="В этой версии подтверждать почту не нужно. Войдите или зарегистрируйтесь как обычно."
      >
        <div className={flow.body}>
          <div className={flow.actions}>
            <Button variant="primary" block to="/login">
              Войти
            </Button>
            <Button variant="secondary" block to="/register">
              Зарегистрироваться
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  if (result.code === 'token_expired' || result.code === 'token_invalid') {
    const expired = result.code === 'token_expired';
    return (
      <AuthShell
        title={expired ? 'Ссылка устарела' : 'Ссылка не сработала'}
        focusTitle
        subtitle={
          expired
            ? 'Ссылка из письма действует 48 часов. Введите почту, и мы пришлём новое письмо.'
            : 'Возможно, ссылка скопирована не целиком. Введите почту, и мы пришлём новое письмо.'
        }
      >
        <ResendForm />
        <p className={flow.links}>
          <Link to="/login">Войти</Link>
          <Link to="/register">Зарегистрироваться</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Не получилось" focusTitle subtitle="Почту пока не подтвердили.">
      <div className={flow.body}>
        <AuthNotice tone="danger" role="alert">
          {result.message || 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз'}
        </AuthNotice>
        <div className={flow.actions}>
          <Button variant="primary" block onClick={() => setAttempt((n) => n + 1)}>
            Повторить
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
