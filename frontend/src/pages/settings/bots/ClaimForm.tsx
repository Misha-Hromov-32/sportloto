import { CheckCircleIcon, LinkIcon } from '@phosphor-icons/react';
import { Input } from 'antd';
import { useId, useState, type FormEvent } from 'react';

import { Button } from '@/components';
import { errorMessage, useAction } from '@/lib/api';

import { BOTS_API, errorCode, PLATFORM_NAME, type BotClaimResult } from './api';
import styles from './bots.module.css';
import { rateLimitText } from './useLinkFlow';

function claimError(error: unknown): string {
  switch (errorCode(error)) {
    case 'code_invalid':
      return 'Код не подошёл. Проверьте цифры или попросите в боте новый код';
    case 'code_expired':
      return 'Код устарел: он действует 10 минут. Попросите в боте новый';
    case 'rate_limited':
      return rateLimitText(error, 'Попробуйте снова');
    default:
      return errorMessage(error, 'Не удалось подключить. Попробуйте ещё раз');
  }
}

/** Запасной путь: бот показал шестизначный код, человек вводит его на сайте. */
export function ClaimForm({ onLinked }: { onLinked: () => void }) {
  const id = useId();
  const { run, isPending } = useAction<BotClaimResult>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setDone(null);
    if (code.length !== 6) {
      setError('В коде 6 цифр. Проверьте, что ввели все');
      return;
    }
    setError(null);
    try {
      const result = await run(BOTS_API.claim, { code }, { silent: true });
      if (result.platform !== 'vk') throw new Error('Используйте код из бота ВКонтакте.');
      setCode('');
      setDone(`Готово, ${PLATFORM_NAME[result.platform]} подключён: ${result.displayName}`);
      onLinked();
    } catch (err) {
      setError(claimError(err));
    }
  };

  return (
    <form className={styles.claim} onSubmit={(e) => void submit(e)} noValidate>
      <h3 className={styles.claimTitle}>Есть код из бота?</h3>
      <p className={styles.claimText}>
        Если вы начали в боте и он показал шестизначный код, введите его здесь.
      </p>
      <label htmlFor={`${id}-code`} className={styles.fieldLabel}>
        Код из бота
      </label>
      <div className={styles.claimRow}>
        <Input
          id={`${id}-code`}
          className={styles.claimInput}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            setError(null);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          maxLength={6}
          status={error ? 'error' : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <Button
          type="submit"
          variant="secondary"
          icon={<LinkIcon size={20} aria-hidden />}
          loading={isPending}
          loadingText="Подключаем…"
        >
          Подключить
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className={styles.done} role="status">
          <CheckCircleIcon size={22} weight="fill" aria-hidden />
          {done}
        </p>
      )}
    </form>
  );
}
