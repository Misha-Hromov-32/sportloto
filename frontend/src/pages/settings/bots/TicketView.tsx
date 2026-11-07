import { ArrowsClockwiseIcon, ArrowSquareOutIcon, CopyIcon } from '@phosphor-icons/react';
import { App } from 'antd';

import { Button } from '@/components';

import { BotLogo } from './BotLogo';
import { PLATFORM_NAME, type BotPlatform } from './api';
import styles from './bots.module.css';
import type { LinkTicket } from './useLinkFlow';

const START_BUTTON: Record<BotPlatform, string> = { vk: 'Начать' };

function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** «123 456» читается легче, чем шесть цифр подряд. */
function groupCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function OpenBotLink({
  platform,
  href,
  label,
  primary = false,
}: {
  platform: BotPlatform;
  href: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <a
      className={[styles.openBot, primary && styles.openBotPrimary].filter(Boolean).join(' ')}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <BotLogo platform={platform} />
      <span>{label}</span>
      <ArrowSquareOutIcon size={20} aria-hidden />
    </a>
  );
}

/** Выданная ссылка: открыть бота, код на запасной случай и сколько ещё действует. */
export function TicketView({
  platform,
  ticket,
  left,
  expired,
  botUrl,
  botName,
  renewing,
  onRenew,
  primary = false,
}: {
  platform: BotPlatform;
  ticket: LinkTicket;
  left: number;
  expired: boolean;
  botUrl: string | null;
  botName: string | null;
  renewing: boolean;
  onRenew: () => void;
  /** На странице для перехода из бота кнопка возврата — главное действие экрана. */
  primary?: boolean;
}) {
  const { message } = App.useApp();
  const name = PLATFORM_NAME[platform];
  const openUrl = ticket.url ?? botUrl;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ticket.code);
      message.success('Код скопирован');
    } catch {
      message.info('Не получилось скопировать. Перепишите код вручную');
    }
  };

  if (expired)
    return (
      <div className={styles.ticket} role="status">
        <p className={styles.ticketLead}>Ссылка больше не действует: она работает 10 минут.</p>
        <Button
          variant={primary ? 'primary' : 'secondary'}
          size={primary ? 'lg' : 'md'}
          icon={<ArrowsClockwiseIcon size={20} aria-hidden />}
          loading={renewing}
          loadingText="Получаем ссылку…"
          onClick={onRenew}
          className={styles.wrap}
        >
          Получить новую ссылку
        </Button>
      </div>
    );

  return (
    <div className={styles.ticket}>
      <p className={styles.ticketLead}>
        {ticket.url
          ? primary
            ? `Нажмите кнопку, а в боте — «${START_BUTTON[platform]}». Ссылка действует 10 минут.`
            : `Откройте бота и нажмите «${START_BUTTON[platform]}». Ссылка действует 10 минут.`
          : `Откройте бота${botName ? ` ${botName}` : ''} в ${name} и отправьте ему код ниже. Код действует 10 минут.`}
      </p>
      {openUrl && (
        <OpenBotLink
          platform={platform}
          href={openUrl}
          label={primary ? `Вернуться в ${name}` : `Открыть ${name}`}
          primary={primary}
        />
      )}

      <div className={styles.codeBox}>
        <p className={styles.codeLabel}>
          {ticket.url ? 'Если бот не открылся, отправьте ему этот код' : 'Код для бота'}
        </p>
        <div className={styles.codeRow}>
          <output className={styles.code} aria-label={`Код ${ticket.code.split('').join(' ')}`}>
            {groupCode(ticket.code)}
          </output>
          <Button variant="quiet" icon={<CopyIcon size={20} aria-hidden />} onClick={() => void copy()}>
            Скопировать
          </Button>
        </div>
      </div>

      <div className={styles.ticketFoot}>
        <p className={styles.timer}>
          Действует ещё <span className={styles.timerValue}>{clock(left)}</span>
        </p>
        <Button
          variant="quiet"
          icon={<ArrowsClockwiseIcon size={20} aria-hidden />}
          loading={renewing}
          loadingText="Получаем ссылку…"
          onClick={onRenew}
          className={styles.wrap}
        >
          Получить новую ссылку
        </Button>
      </div>
    </div>
  );
}
