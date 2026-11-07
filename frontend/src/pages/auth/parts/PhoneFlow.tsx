import { CheckCircle, Clock, DeviceMobile } from '@phosphor-icons/react';
import { Form, Input, type InputRef } from 'antd';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '@/components';
import { count } from '@/lib/plural';
import type { AuthFlowResult } from '@/types/api';

import {
  pendingSignup,
  resendVerification,
  useApplySignIn,
  useAuthConfig,
  useCooldown,
  waitText,
} from '../authEmail';
import { AuthShell } from '../AuthShell';
import styles from '../AuthShell.module.css';
import {
  formatPhone,
  maskPhone,
  nationalDigits,
  sendPhoneCode,
  typePhone,
  useRevealAfter,
  verifyPhoneCode,
} from '../phone';
import { AuthNotice, ResendButton } from './AuthFlow';
import flow from './AuthFlow.module.css';
import own from './PhoneFlow.module.css';

const OFFER_DELAY = 60_000;
const DEFAULT_RESEND = 60;
const CODE_LENGTH = 6;

/** Ссылка на запасной путь: появляется через минуту ожидания письма и только если сервер умеет SMS. */
export function PhoneOffer({ onStart, immediately = false }: { onStart: () => void; immediately?: boolean }) {
  const config = useAuthConfig();
  const shown = useRevealAfter(immediately ? 0 : OFFER_DELAY);
  const visible = shown && config.data?.phoneVerification === true;
  return (
    <div aria-live="polite" className={own.offer}>
      {visible && (
        <button type="button" className={`${flow.linkButton} ${own.offerButton}`} onClick={onStart}>
          <DeviceMobile size={22} weight="bold" aria-hidden />
          <span>Письмо не приходит? Подтвердить по телефону</span>
        </button>
      )}
    </div>
  );
}

/** Отсчёт виден каждую секунду, а диктору сообщается только начало и конец ожидания. */
function useCountdown(initial = 0) {
  const cooldown = useCooldown(initial);
  const [total, setTotal] = useState(initial);
  const start = (seconds: number) => {
    setTotal(seconds);
    cooldown.start(seconds);
  };
  return { left: cooldown.left, total, waiting: cooldown.left > 0, start };
}

function Countdown({
  timer,
  waitLabel,
  readyLabel,
}: {
  timer: ReturnType<typeof useCountdown>;
  waitLabel: string;
  readyLabel: string;
}) {
  const announce = timer.waiting
    ? `${waitLabel} через ${waitText(timer.total)}`
    : timer.total > 0
      ? readyLabel
      : '';
  return (
    <>
      {timer.waiting && (
        <p className={`${flow.status} ${flow.statusWait}`} role="timer" aria-live="off">
          <Clock size={20} weight="bold" aria-hidden />
          <span>
            {waitLabel} через {waitText(timer.left)}
          </span>
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </>
  );
}

const SMS_TROUBLE: Record<string, { title: string; text: string }> = {
  sms_unavailable: {
    title: 'SMS сейчас не отправляются',
    text: 'Подтвердите почту по письму. Мы можем отправить его ещё раз.',
  },
  sms_failed: {
    title: 'Не получилось отправить SMS',
    text: 'Проверьте номер и попробуйте позже. Или подтвердите почту по письму.',
  },
};

/** Ошибка отправки: для сбоя SMS — запасной путь обратно к письму. */
function SendProblem({ result, email }: { result: AuthFlowResult | null; email: string }) {
  if (!result || result.ok || result.code === 'rate_limited' || result.code === 'validation') return null;
  if (result.code === PASSWORD_REJECTED) return null;
  const trouble = result.code ? SMS_TROUBLE[result.code] : undefined;
  if (trouble) {
    return (
      <div className={own.problem}>
        <AuthNotice tone="danger" title={trouble.title} role="alert">
          {trouble.text}
        </AuthNotice>
        <ResendButton label="Отправить письмо ещё раз" send={() => resendVerification(email)} />
      </div>
    );
  }
  return (
    <AuthNotice tone="danger" role="alert">
      {result.message || 'Не получилось отправить код. Попробуйте ещё раз'}
    </AuthNotice>
  );
}

interface Sent {
  national: string;
  password: string;
  expiresIn?: number;
  resendIn: number;
}

interface PhoneValues {
  phone: string;
  password?: string;
}

const PASSWORD_REJECTED = 'invalid_credentials';
const PASSWORD_WRONG = 'Пароль не подошёл';

function PhoneStep({
  email,
  initial,
  password: knownPassword,
  rejected,
  onSent,
  back,
}: {
  email: string;
  initial: string;
  /** Пароль из формы регистрации или входа; пустой — спросим здесь (например, после перезагрузки). */
  password: string;
  rejected: boolean;
  onSent: (sent: Sent) => void;
  back: { label: string; onClick: () => void };
}) {
  const [form] = Form.useForm<PhoneValues>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuthFlowResult | null>(null);
  const [askPassword, setAskPassword] = useState(rejected || !knownPassword);
  const [passwordError, setPasswordError] = useState(rejected ? PASSWORD_WRONG : '');
  const timer = useCountdown();

  const submit = async ({ phone, password }: PhoneValues) => {
    const national = nationalDigits(phone);
    const secret = askPassword ? (password ?? '') : knownPassword;
    setBusy(true);
    setResult(null);
    setPasswordError('');
    const res = await sendPhoneCode(email, secret, national);
    setBusy(false);
    if (res.ok) {
      onSent({
        national,
        password: secret,
        expiresIn: res.expiresIn,
        resendIn: res.resendIn ?? DEFAULT_RESEND,
      });
      return;
    }
    setResult(res);
    if (res.code === PASSWORD_REJECTED) {
      setAskPassword(true);
      setPasswordError(PASSWORD_WRONG);
    }
    if (res.code === 'rate_limited') timer.start(res.retryAfter ?? DEFAULT_RESEND);
    if (res.code === 'validation') {
      form.setFields([
        { name: 'phone', errors: [res.fieldErrors?.phone || res.message || 'Проверьте номер телефона'] },
      ]);
    }
  };

  return (
    <AuthShell
      title="Номер телефона"
      focusTitle
      subtitle={
        <>
          Подтвердим аккаунт <span className={flow.email}>{email}</span> кодом из SMS вместо письма.
        </>
      }
    >
      <Form<PhoneValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        className={styles.form}
        initialValues={{ phone: initial ? formatPhone(initial) : '' }}
        onValuesChange={(changed: Partial<PhoneValues>) => {
          if ('phone' in changed && form.getFieldError('phone').length) {
            form.setFields([{ name: 'phone', errors: [] }]);
          }
          if ('password' in changed) setPasswordError('');
        }}
        onFinish={submit}
      >
        <Form.Item
          label="Номер телефона"
          name="phone"
          extra="Пришлём SMS с кодом. Это бесплатно."
          validateTrigger="onBlur"
          getValueFromEvent={(event: ChangeEvent<HTMLInputElement>) => {
            const input = event.target;
            const atEnd = input.selectionStart === null || input.selectionStart >= input.value.length;
            return typePhone(input.value, form.getFieldValue('phone') ?? '', atEnd);
          }}
          rules={[
            {
              validator: async (_, value: string | undefined) => {
                const national = nationalDigits(value ?? '');
                if (!national) throw new Error('Введите номер телефона');
                if (national.length < 10) throw new Error('Введите номер полностью: 10 цифр после +7');
              },
            },
          ]}
        >
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+7 912 345-67-89"
            maxLength={24}
            onBlur={(event) => {
              const national = nationalDigits(event.target.value);
              if (national) form.setFieldValue('phone', formatPhone(national));
            }}
          />
        </Form.Item>
        {askPassword && (
          <Form.Item
            label="Пароль"
            name="password"
            extra="Введите пароль, который вы задали при регистрации."
            validateStatus={passwordError ? 'error' : undefined}
            help={passwordError || undefined}
            rules={[{ required: true, message: 'Введите пароль' }]}
          >
            <Input.Password autoComplete="current-password" maxLength={128} />
          </Form.Item>
        )}
        <div className={own.stack}>
          <SendProblem result={result} email={email} />
          <Button
            type="submit"
            variant="primary"
            block
            loading={busy}
            loadingText="Отправляем…"
            disabled={timer.waiting}
            className={styles.submit}
          >
            Получить код
          </Button>
          <Countdown
            timer={timer}
            waitLabel="Получить код снова можно"
            readyLabel="Можно снова получить код"
          />
        </div>
      </Form>
      <p className={flow.links}>
        <button type="button" className={flow.linkButton} onClick={back.onClick}>
          {back.label}
        </button>
      </p>
    </AuthShell>
  );
}

const MINUTES = ['минуту', 'минуты', 'минут'] as const;

type CodeTrouble = 'expired' | 'attempts' | null;

function CodeStep({
  email,
  sent,
  onResent,
  onChangePhone,
  onPasswordRejected,
  onDone,
  back,
}: {
  email: string;
  sent: Sent;
  onResent: (sent: Sent) => void;
  onChangePhone: () => void;
  onPasswordRejected: () => void;
  onDone: () => Promise<void>;
  back: { label: string; onClick: () => void };
}) {
  const [form] = Form.useForm<{ code: string }>();
  const input = useRef<InputRef>(null);
  const checking = useRef(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [trouble, setTrouble] = useState<CodeTrouble>(null);
  const [problem, setProblem] = useState<AuthFlowResult | null>(null);
  const [resent, setResent] = useState(false);
  const timer = useCountdown(sent.resendIn);
  // Шаг сменился без перехода: показываем его с начала, поле кода уже в фокусе.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const check = async (code: string) => {
    if (checking.current || code.length !== CODE_LENGTH) return;
    checking.current = true;
    setBusy(true);
    setProblem(null);
    setResent(false);
    const res = await verifyPhoneCode(email, sent.national, code);
    if (res.ok) {
      await onDone();
      return;
    }
    checking.current = false;
    setBusy(false);
    if (res.code === 'code_expired') {
      setTrouble('expired');
    } else if (res.code === 'code_invalid' && res.attemptsLeft === 0) {
      setTrouble('attempts');
    } else if (res.code === 'code_invalid') {
      const left = res.attemptsLeft;
      form.setFields([
        {
          name: 'code',
          value: '',
          errors: [
            left === undefined
              ? 'Код не подошёл. Проверьте SMS'
              : `Код не подошёл. Осталось попыток: ${left}`,
          ],
        },
      ]);
      input.current?.focus();
    } else {
      if (res.code === 'rate_limited') timer.start(res.retryAfter ?? DEFAULT_RESEND);
      setProblem(res);
    }
  };

  const resend = async () => {
    setSending(true);
    setProblem(null);
    setResent(false);
    const res = await sendPhoneCode(email, sent.password, sent.national);
    setSending(false);
    if (res.code === PASSWORD_REJECTED) {
      onPasswordRejected();
      return;
    }
    if (res.ok) {
      const resendIn = res.resendIn ?? DEFAULT_RESEND;
      setTrouble(null);
      setResent(true);
      form.setFields([{ name: 'code', value: '', errors: [] }]);
      timer.start(resendIn);
      onResent({ ...sent, expiresIn: res.expiresIn, resendIn });
      return;
    }
    if (res.code === 'rate_limited') timer.start(res.retryAfter ?? DEFAULT_RESEND);
    setProblem(res);
  };

  const lifetime = sent.expiresIn ? count(Math.max(1, Math.round(sent.expiresIn / 60)), MINUTES) : '';

  return (
    <AuthShell
      title="Код из SMS"
      focusTitle={trouble !== null}
      subtitle={
        <>
          Мы отправили код на <span className={own.phone}>{maskPhone(sent.national)}</span>.
        </>
      }
    >
      {trouble ? (
        <div className={flow.body}>
          <AuthNotice
            tone="danger"
            title={trouble === 'expired' ? 'Код больше не действует' : 'Попытки закончились'}
            role="alert"
          >
            Получите новый код: пришлём его на тот же номер.
          </AuthNotice>
          <div className={own.stack}>
            <SendProblem result={problem} email={email} />
            <Button
              variant="primary"
              block
              loading={sending}
              loadingText="Отправляем…"
              disabled={timer.waiting}
              className={styles.submit}
              onClick={resend}
            >
              Получить новый код
            </Button>
            <Countdown
              timer={timer}
              waitLabel="Новый код можно получить"
              readyLabel="Можно получить новый код"
            />
          </div>
        </div>
      ) : (
        <Form<{ code: string }>
          form={form}
          layout="vertical"
          requiredMark={false}
          className={styles.form}
          onValuesChange={({ code }: { code?: string }) => {
            if (code?.length === CODE_LENGTH) void check(code);
          }}
          onFinish={({ code }) => check(code ?? '')}
        >
          <Form.Item
            label="Код из SMS"
            name="code"
            className={own.codeField}
            extra={lifetime ? `6 цифр. Код действует ${lifetime}.` : '6 цифр.'}
            getValueFromEvent={(event: ChangeEvent<HTMLInputElement>) =>
              event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH)
            }
            rules={[
              { required: true, message: 'Введите код из SMS' },
              { len: CODE_LENGTH, message: 'В коде 6 цифр' },
            ]}
            validateTrigger={[]}
          >
            <Input
              ref={input}
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              readOnly={busy}
            />
          </Form.Item>
          <div className={own.stack}>
            {resent && (
              <p className={`${flow.status} ${flow.statusOk}`} role="status">
                <CheckCircle size={20} weight="fill" aria-hidden />
                <span>Новый код отправлен</span>
              </p>
            )}
            <SendProblem result={problem} email={email} />
            <Button
              type="submit"
              variant="primary"
              block
              loading={busy}
              loadingText="Проверяем…"
              className={styles.submit}
            >
              Подтвердить
            </Button>
            <div className={flow.resend}>
              <Button
                variant="secondary"
                block
                loading={sending}
                loadingText="Отправляем…"
                disabled={timer.waiting || busy}
                onClick={resend}
              >
                Отправить код ещё раз
              </Button>
              <Countdown
                timer={timer}
                waitLabel="Отправить код ещё раз можно"
                readyLabel="Можно отправить код ещё раз"
              />
            </div>
          </div>
        </Form>
      )}
      <p className={flow.links}>
        <button type="button" className={flow.linkButton} onClick={onChangePhone}>
          Изменить номер
        </button>
        <button type="button" className={flow.linkButton} onClick={back.onClick}>
          {back.label}
        </button>
      </p>
    </AuthShell>
  );
}

/**
 * Запасной путь, если письмо не пришло: номер, затем код из SMS. Почта приходит от экрана,
 * который её уже знает, в адрес страницы не попадает. Успех — вход, как по ссылке из письма.
 */
export function PhoneVerify({
  email,
  password: formPassword = '',
  back,
}: {
  email: string;
  /** Только из состояния формы в памяти: в хранилище вкладки и в адрес пароль не попадает. */
  password?: string;
  back: { label: string; onClick: () => void };
}) {
  const [sent, setSent] = useState<Sent | null>(null);
  const [national, setNational] = useState('');
  const [password, setPassword] = useState(formPassword);
  const [rejected, setRejected] = useState(false);
  const navigate = useNavigate();
  const applySignIn = useApplySignIn();

  if (!sent) {
    return (
      <PhoneStep
        email={email}
        initial={national}
        password={password}
        rejected={rejected}
        back={back}
        onSent={(next) => {
          setNational(next.national);
          setPassword(next.password);
          setRejected(false);
          setSent(next);
        }}
      />
    );
  }

  return (
    <CodeStep
      key={sent.national}
      email={email}
      sent={sent}
      back={back}
      onResent={setSent}
      onChangePhone={() => setSent(null)}
      onPasswordRejected={() => {
        setRejected(true);
        setSent(null);
      }}
      onDone={async () => {
        pendingSignup.clear();
        // Регистрация открыта только гостям: сначала уходим на экран итога, потом обновляем вход.
        navigate('/verify-email', { replace: true, state: { signedIn: 'phone' } });
        await applySignIn();
      }}
    />
  );
}
