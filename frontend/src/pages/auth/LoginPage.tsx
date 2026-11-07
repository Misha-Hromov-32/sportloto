import { useLogin } from '@refinedev/core';
import { Form, Input } from 'antd';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Button } from '@/components';
import { useMe } from '@/lib/api';

import { resendVerification, useApplySignIn, useAuthConfig } from './authEmail';
import { AuthShell } from './AuthShell';
import styles from './AuthShell.module.css';
import { AuthNotice, ResendButton } from './parts/AuthFlow';
import flow from './parts/AuthFlow.module.css';
import { DemoAccess } from './parts/DemoAccounts';
import { PhoneOffer, PhoneVerify } from './parts/PhoneFlow';

function safeTo(value: string | null): string | undefined {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : undefined;
}

export default function LoginPage() {
  const [params] = useSearchParams();
  const to = safeTo(params.get('to'));
  const { me } = useMe();
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState('');
  const [phoneFor, setPhoneFor] = useState<{ email: string; password: string } | null>(null);
  const [phoneTried, setPhoneTried] = useState(false);
  const [form] = Form.useForm<{ email: string; password?: string }>();
  const config = useAuthConfig();
  const applySignIn = useApplySignIn();
  // Ошибки показываем у формы, а не всплывающим окном: так их видно рядом с полями.
  const login = useLogin<{ email: string; password?: string; redirectTo?: string }>({
    mutationOptions: { onSuccess: () => undefined, onError: () => undefined },
  });

  if (phoneFor) {
    return (
      <PhoneVerify
        email={phoneFor.email}
        password={phoneFor.password}
        back={{ label: 'Вернуться ко входу', onClick: () => setPhoneFor(null) }}
      />
    );
  }

  return (
    <AuthShell title="Вход" focusTitle={phoneTried} subtitle="Введите почту, с которой вы регистрировались.">
      {me && (
        <p className={styles.signedIn}>
          Вы вошли как {me.name}.{' '}
          <Link to={to ?? (me.role === 'admin' ? '/admin' : '/events')}>Продолжить</Link>
        </p>
      )}
      <Form<{ email: string; password?: string }>
        form={form}
        layout="vertical"
        requiredMark={false}
        className={styles.form}
        onValuesChange={(changed) => {
          if ('email' in changed) setUnverified('');
        }}
        onFinish={async (values) => {
          setError('');
          setUnverified('');
          try {
            const result = await login.mutateAsync({ ...values, redirectTo: to });
            if (result.success) {
              await applySignIn(result.redirectTo);
            } else if (result.code === 'email_not_verified') {
              setUnverified(
                typeof result.email === 'string' && result.email ? result.email : values.email.trim(),
              );
            } else {
              setError(result.error?.message || 'Не удалось войти. Проверьте почту и пароль.');
            }
          } catch {
            setError('Не удалось войти. Попробуйте ещё раз.');
          }
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
        <Form.Item label="Пароль" name="password">
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        {config.data?.passwordReset && (
          <p className={flow.forgot}>
            <Link to="/forgot-password">Забыли пароль?</Link>
          </p>
        )}
        {unverified && (
          <div className={flow.formNotice}>
            <AuthNotice tone="wait" title="Почта ещё не подтверждена" role="alert">
              Откройте письмо, которое пришло после регистрации, и нажмите «Подтвердить почту».
            </AuthNotice>
            <ResendButton label="Отправить письмо ещё раз" send={() => resendVerification(unverified)} />
            <PhoneOffer
              key={unverified}
              immediately={phoneTried}
              onStart={() => {
                setPhoneTried(true);
                setPhoneFor({ email: unverified, password: form.getFieldValue('password') ?? '' });
              }}
            />
          </div>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          block
          loading={login.isPending}
          loadingText="Входим…"
          className={styles.submit}
        >
          Войти
        </Button>
      </Form>
      <p className={styles.switch}>
        Ещё нет аккаунта?{' '}
        <Link to={'/register' + (to ? '?to=' + encodeURIComponent(to) : '')}>Зарегистрироваться</Link>
      </p>
      <DemoAccess redirectTo={to} />
    </AuthShell>
  );
}
