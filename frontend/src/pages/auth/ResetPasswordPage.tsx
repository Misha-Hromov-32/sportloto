import { useUpdatePassword } from '@refinedev/core';
import { App, Checkbox, Form, Input } from 'antd';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button } from '@/components';

import { useApplySignIn, useAuthConfig } from './authEmail';
import { AuthShell } from './AuthShell';
import styles from './AuthShell.module.css';
import { AuthConfigError, AuthLoading } from './parts/AuthFlow';
import flow from './parts/AuthFlow.module.css';

const TITLE = 'Новый пароль';

interface Values {
  password: string;
  confirm: string;
}

const TOKEN_TEXT = {
  token_expired: {
    title: 'Ссылка устарела',
    text: 'Ссылка для нового пароля действует 1 час. Запросите новую, она придёт на почту.',
  },
  token_invalid: {
    title: 'Ссылка не сработала',
    text: 'Возможно, ссылка скопирована не целиком. Запросите новую, она придёт на почту.',
  },
  token_used: {
    title: 'Ссылка уже использована',
    text: 'По этой ссылке пароль уже сменили. Войдите с новым паролем или запросите новую ссылку.',
  },
} satisfies Record<string, { title: string; text: string }>;

type TokenCode = keyof typeof TOKEN_TEXT;
const isTokenCode = (code: unknown): code is TokenCode => typeof code === 'string' && code in TOKEN_TEXT;

function TokenProblem({ code }: { code: TokenCode }) {
  const { title, text } = TOKEN_TEXT[code];
  return (
    <AuthShell title={title} focusTitle subtitle={text}>
      <div className={flow.body}>
        <div className={flow.actions}>
          <Button variant="primary" block to="/forgot-password">
            Запросить новую ссылку
          </Button>
          {code === 'token_used' && (
            <Button variant="secondary" block to="/login">
              Войти
            </Button>
          )}
        </div>
      </div>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() ?? '';
  const config = useAuthConfig();
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [visible, setVisible] = useState(false);
  const [problem, setProblem] = useState<TokenCode | null>(token ? null : 'token_invalid');
  const [error, setError] = useState('');
  const applySignIn = useApplySignIn();
  const update = useUpdatePassword<{ token: string; password: string }>({
    mutationOptions: { onSuccess: () => undefined, onError: () => undefined },
  });

  if (config.isLoading) {
    return (
      <AuthShell title={TITLE} subtitle="Придумайте пароль, с которым будете входить.">
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
        subtitle="В этой версии письма не отправляются, поэтому ссылка для нового пароля здесь не работает."
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

  if (problem) return <TokenProblem code={problem} />;

  return (
    <AuthShell title={TITLE} subtitle="Придумайте пароль, с которым будете входить. Не короче 8 символов.">
      <Form<Values>
        form={form}
        layout="vertical"
        requiredMark={false}
        className={styles.form}
        onFinish={async ({ password }) => {
          setError('');
          const res = await update.mutateAsync({ token, password });
          if (res.success) {
            await applySignIn(res.redirectTo ?? '/me');
            message.success('Пароль изменён');
            return;
          }
          if (isTokenCode(res.code)) {
            setProblem(res.code);
            return;
          }
          const fieldErrors = (res.fieldErrors ?? {}) as Record<string, string>;
          if (fieldErrors.password) {
            form.setFields([{ name: 'password', errors: [fieldErrors.password] }]);
            return;
          }
          setError(res.error?.message || 'Не удалось сменить пароль. Попробуйте ещё раз.');
        }}
      >
        <Form.Item
          label="Новый пароль"
          name="password"
          rules={[
            { required: true, message: 'Придумайте пароль' },
            { min: 8, message: 'Минимум 8 символов' },
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            maxLength={128}
            visibilityToggle={{ visible, onVisibleChange: setVisible }}
          />
        </Form.Item>
        <Form.Item
          label="Повторите пароль"
          name="confirm"
          dependencies={['password']}
          rules={[
            { required: true, message: 'Повторите пароль' },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || value === getFieldValue('password')
                  ? Promise.resolve()
                  : Promise.reject(new Error('Пароли не совпадают')),
            }),
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            maxLength={128}
            visibilityToggle={{ visible, onVisibleChange: setVisible }}
          />
        </Form.Item>
        <div className={flow.show}>
          <Checkbox checked={visible} onChange={(e) => setVisible(e.target.checked)}>
            Показать пароль
          </Checkbox>
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          block
          loading={update.isPending}
          loadingText="Сохраняем…"
          className={styles.submit}
        >
          Сохранить пароль
        </Button>
      </Form>
    </AuthShell>
  );
}
