import { useCallback, useEffect, useState } from 'react';

import { errorMessage, useAction } from '@/lib/api';
import { count, WORDS } from '@/lib/plural';

import {
  BOTS_API,
  linkDeadline,
  retryAfterSeconds,
  useBotLinks,
  type BotLink,
  type BotLinkCode,
  type BotPlatform,
} from './api';

export interface LinkTicket {
  code: string;
  url: string | null;
  deadline: number;
}

export function rateLimitText(error: unknown, action: string): string {
  const seconds = retryAfterSeconds(error);
  if (!seconds) return `Слишком много попыток. ${action} чуть позже`;
  return `Слишком много попыток. ${action} через ${count(Math.max(1, Math.ceil(seconds / 60)), WORDS.minute)}`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * Привязка мессенджера по ссылке: выдать код, открыть бота, ждать, пока бот сообщит сайту код.
 * Новая привязка определяется по id, которого не было в списке на момент выдачи ссылки.
 */
export function useLinkFlow(platform: BotPlatform) {
  const { run: runIssue, isPending: issuing } = useAction<BotLinkCode>();
  const [ticket, setTicket] = useState<LinkTicket | null>(null);
  const [known, setKnown] = useState<string[] | null>(null);
  const [linked, setLinked] = useState<BotLink | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const now = useNow(Boolean(ticket) && !linked);
  const left = ticket ? Math.max(0, ticket.deadline - now) : 0;
  const expired = Boolean(ticket) && left === 0;
  const polling = Boolean(ticket) && !expired && !linked;
  const links = useBotLinks(true, polling);

  useEffect(() => {
    if (!polling || !links.data) return;
    if (!known) {
      setKnown(links.data.map((l) => l.id));
      return;
    }
    const fresh = links.data.find((l) => l.platform === platform && !known.includes(l.id));
    if (fresh) setLinked(fresh);
  }, [polling, links.data, known, platform]);

  const start = useCallback(
    async ({ openBot }: { openBot: boolean }) => {
      setFailure(null);
      setLinked(null);
      // Вкладку открываем сразу по нажатию: после ответа сервера браузер её заблокирует.
      const tab = openBot ? window.open('', '_blank') : null;
      try {
        const result = await runIssue(BOTS_API.linkCode, { platform }, { silent: true });
        setKnown(links.data ? links.data.map((l) => l.id) : null);
        setTicket({ code: result.code, url: result.url, deadline: linkDeadline(result.expiresAt) });
        if (tab && result.url) {
          tab.opener = null;
          tab.location.href = result.url;
        } else tab?.close();
        return result;
      } catch (error) {
        tab?.close();
        setFailure(
          (error as { statusCode?: number }).statusCode === 429
            ? rateLimitText(error, 'Новую ссылку можно получить')
            : errorMessage(error, 'Не удалось получить ссылку. Попробуйте ещё раз'),
        );
        return null;
      }
    },
    [runIssue, links.data, platform],
  );

  const close = useCallback(() => {
    setTicket(null);
    setKnown(null);
    setFailure(null);
  }, []);

  return {
    ticket,
    left,
    expired,
    linked,
    failure,
    issuing,
    links,
    start,
    close,
  };
}
