import { useRegister } from '@refinedev/core';
import { Checkbox, Form, Input } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';

import { holdGuestPage } from '@/app/guestHold';
import { Button } from '@/components';
import { useMe } from '@/lib/api';
import { foreignEmailMessage, isAllowedEmail } from '@/lib/emailPolicy';
import { legalPath } from '@/pages/legal/documents';
import type { RegisterInput } from '@/types/inputs';

import { pendingSignup, resendVerification } from './authEmail';
import { AuthShell } from './AuthShell';
import styles from './AuthShell.module.css';
import { ResendButton } from './parts/AuthFlow';
import flow from './parts/AuthFlow.module.css';
import { PhoneOffer, PhoneVerify } from './parts/PhoneFlow';
import { PhotoStep } from './register/PhotoStep';

interface Values {
  name: string;
  email: string;
  password: string;
  acceptTerms: boolean;
  personalDataConsent: boolean;
  publicProfileConsent: boolean;
}

/** Согласия 152-ФЗ — каждое отдельной отметкой, без отметок по умолчанию. Сервер проверяет то же. */
interface Consents {
  acceptTerms: boolean;
  personalDataConsent: boolean;
  publicProfileConsent: boolean;
}

const mustCheck = (message: string) => ({
  validator: (_: unknown, value: boolean) => (value ? Promise.resolve() : Promise.reject(new Error(message))),
});

/** Ссылка на документ в новой вкладке: введённое в форму не потеряется. */
function DocLink({ slug, children }: { slug: string; children: string }) {
  return (
    <Link to={legalPath(slug)} target="_blank" rel="noopener">
      {children}
    </Link>
  );
}

function CheckEmail({
  email,
  password,
  onChangeEmail,
}: {
  email: string;
  password?: string;
  onChangeEmail: () => void;
}) {
  const [byPhone, setByPhone] = useState(false);
  const [phoneTried, setPhoneTried] = useState(false);

  if (byPhone) {
    return (
      <PhoneVerify
        email={email}
        password={password}
        back={{ label: 'Вернуться к письму', onClick: () => setByPhone(false) }}
      />
    );
  }

  return (
    <AuthShell
      title="Проверьте почту"
      focusTitle
      subtitle={
        <>
          Мы отправили письмо на <span className={flow.email}>{email}</span>. Откройте его и нажмите
          «Подтвердить почту». Ссылка действует 48 часов.
        </>
      }
    >
      <div className={flow.body}>
        <p className={flow.hint}>Письма нет? Проверьте папку «Спам» или отправьте ещё раз.</p>
        <ResendButton send={() => resendVerification(email)} />
        <PhoneOffer
          immediately={phoneTried}
          onStart={() => {
            setPhoneTried(true);
            setByPhone(true);
          }}
        />
        <p className={flow.links}>
          <button type="button" className={flow.linkButton} onClick={onChangeEmail}>
            Изменить почту
          </button>
          <Link to="/login">Войти</Link>
        </p>
      </div>
    </AuthShell>
  );
}

export default function RegisterPage() {
  const [params] = useSearchParams();
  const target = params.get('to');
  const to = target?.startsWith('/') && !target.startsWith('//') ? target : '/me';
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState(() => pendingSignup.get()?.email ?? '');
  const [draft, setDraft] = useState<Partial<Values>>(() => {
    const pending = pendingSignup.get();
    return pending ? { name: pending.name, email: pending.email } : {};
  });
  const register = useRegister<RegisterInput & Consents & { redirectTo?: string }>();
  const { me } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  /** Аккаунт создан и вход выполнен: перед переходом дальше предлагаем добавить фото. */
  const [photoFor, setPhotoFor] = useState<string | null>(null);

  useEffect(() => () => holdGuestPage(false), []);

  if (photoFor !== null) {
    return (
      <PhotoStep
        me={me}
        name={photoFor}
        onDone={() => {
          holdGuestPage(false);
          void navigate(to, { replace: true });
        }}
      />
    );
  }

  if (sentTo) {
    return (
      <CheckEmail
        email={sentTo}
        password={draft.password}
        onChangeEmail={() => {
          pendingSignup.clear();
          setSentTo('');
        }}
      />
    );
  }

  return (
    <AuthShell
      title="Регистрация"
      subtitle="Нужны имя, почта и пароль. Интересы и район можно указать позже в профиле."
    >
      <Form<Values>
        layout="vertical"
        requiredMark={false}
        className={styles.form}
        initialValues={draft}
        onFinish={async (values) => {
          setError('');
          holdGuestPage(true);
          try {
            const input = { name: values.name.trim(), email: values.email.trim(), password: values.password };
            const result = await register.mutateAsync({
              ...input,
              districtId: null,
              interests: [],
              acceptTerms: values.acceptTerms,
              personalDataConsent: values.personalDataConsent,
              publicProfileConsent: values.publicProfileConsent,
              // Остаёмся на этой странице: дальше по `to` переходит шаг с фото.
              redirectTo: `${location.pathname}${location.search}`,
            });
            if (result.success && !result.verificationSent) {
              setPhotoFor(input.name);
              return;
            }
            holdGuestPage(false);
            if (result.success && result.verificationSent) {
              const email = typeof result.email === 'string' && result.email ? result.email : input.email;
              setDraft(input);
              pendingSignup.set({ email, name: input.name });
              setSentTo(email);
            } else if (!result.success) {
              setError(result.error?.message ?? 'Не удалось создать аккаунт. Попробуйте ещё раз.');
            }
          } catch {
            holdGuestPage(false);
            setError('Не удалось создать аккаунт. Попробуйте ещё раз.');
          }
        }}
      >
        <Form.Item
          label="Ваше имя"
          name="name"
          rules={[
            { required: true, whitespace: true, message: 'Введите имя' },
            { min: 2, message: 'Минимум 2 буквы' },
          ]}
        >
          <Input autoComplete="name" maxLength={60} />
        </Form.Item>
        <Form.Item
          label="Электронная почта"
          name="email"
          rules={[
            { required: true, message: 'Введите почту' },
            { type: 'email', message: 'Проверьте адрес почты' },
            {
              validator: (_, value: string | undefined) =>
                !value || isAllowedEmail(value)
                  ? Promise.resolve()
                  : Promise.reject(new Error(foreignEmailMessage(value, { hint: false }))),
            },
          ]}
          extra="По закону нужна российская почта: Яндекс, Mail.ru, Рамблер или домен .ru и .рф"
        >
          <Input autoComplete="email" inputMode="email" />
        </Form.Item>
        <Form.Item
          label="Пароль"
          name="password"
          extra="Не короче 8 символов. Он понадобится при входе вместе с почтой"
          rules={[
            { required: true, message: 'Придумайте пароль' },
            { min: 8, message: 'Минимум 8 символов' },
          ]}
        >
          <Input.Password autoComplete="new-password" maxLength={128} />
        </Form.Item>
        <div className={styles.consents} role="group" aria-label="Согласия">
          <Form.Item
            name="acceptTerms"
            valuePropName="checked"
            rules={[mustCheck('Без этой отметки аккаунт создать нельзя')]}
          >
            <Checkbox>
              Принимаю <DocLink slug="terms">Пользовательское соглашение</DocLink> и{' '}
              <DocLink slug="privacy">Политику обработки персональных данных</DocLink>
            </Checkbox>
          </Form.Item>
          <Form.Item
            name="personalDataConsent"
            valuePropName="checked"
            rules={[mustCheck('Без согласия мы не можем хранить ваш аккаунт')]}
          >
            <Checkbox>
              Даю <DocLink slug="consent">согласие на обработку персональных данных</DocLink>
            </Checkbox>
          </Form.Item>
          <Form.Item
            name="publicProfileConsent"
            valuePropName="checked"
            rules={[mustCheck('Без этого организатор не увидит, кто записался')]}
          >
            <Checkbox>
              Согласен(на), чтобы имя, фото и анкета были видны на сайте (
              <DocLink slug="public-profile">согласие на распространение</DocLink>)
            </Checkbox>
          </Form.Item>
          <p className={styles.consentsNote}>Мне есть 14 лет. Если нет 18, родители знают о регистрации.</p>
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
          loading={register.isPending}
          loadingText="Создаём аккаунт…"
          className={styles.submit}
        >
          Создать аккаунт
        </Button>
      </Form>
      <p className={styles.switch}>
        Уже есть аккаунт? <Link to={'/login' + (target ? '?to=' + encodeURIComponent(to) : '')}>Войти</Link>
      </p>
    </AuthShell>
  );
}
