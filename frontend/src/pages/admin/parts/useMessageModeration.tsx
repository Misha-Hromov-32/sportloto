import { App } from 'antd';
import { useState } from 'react';

import { API, useAction } from '@/lib/api';
import { count, WORDS } from '@/lib/plural';
import type { MessageView } from '@/types/api';
import type { PlatformRule } from '@/types/domain';

import { DecisionModal } from './DecisionModal';
import { HIDE_TEMPLATES } from './labels';

/** Скрыть, оставить или вернуть сообщения — по одному или пачкой. Решение пишется в журнал на стороне домена. */
export function useMessageModeration(rules: PlatformRule[], onDone?: () => void) {
  const { run } = useAction();
  const { message } = App.useApp();
  const [toHide, setToHide] = useState<MessageView[] | null>(null);
  const [busyIds, setBusyIds] = useState<string[]>([]);

  const each = async (list: MessageView[], payload: Record<string, unknown>, done: (n: number) => string) => {
    setBusyIds(list.map((m) => m.id));
    try {
      for (const m of list) await run(API.moderateMessage(m.id), payload);
      message.success(done(list.length));
      onDone?.();
    } finally {
      setBusyIds([]);
    }
  };

  const keep = (list: MessageView[]) =>
    each(list, { action: 'keep' }, (n) =>
      n === 1 ? 'Сообщение оставлено, пометка снята' : `Оставлено: ${count(n, WORDS.message)}`,
    ).catch(() => undefined);

  const restore = (list: MessageView[]) =>
    each(list, { action: 'restore' }, (n) =>
      n === 1 ? 'Сообщение снова видно всем' : `Снова видно: ${count(n, WORDS.message)}`,
    ).catch(() => undefined);

  const n = toHide?.length ?? 0;
  const modal = (
    <DecisionModal
      open={n > 0}
      title={n === 1 ? 'Скрыть сообщение?' : `Скрыть ${count(n, WORDS.message)}?`}
      confirmLabel={n === 1 ? 'Скрыть сообщение' : 'Скрыть сообщения'}
      confirmTone="danger"
      consequences={[
        'Вместо текста участники увидят «Сообщение скрыто модератором».',
        n === 1 ? 'Автор получит уведомление с причиной.' : 'Каждый автор получит уведомление с причиной.',
        'Вернуть можно в разделе «Обсуждения», на вкладке «Скрытые».',
      ]}
      rules={{ list: rules, required: false }}
      reason={{
        label: 'Причина для автора',
        required: true,
        templates: HIDE_TEMPLATES,
        placeholder: 'Например: реклама, не относится к событию',
      }}
      onConfirm={({ ruleId, reason }) =>
        each(toHide ?? [], { action: 'hide', reason, ruleId }, (k) =>
          k === 1 ? 'Сообщение скрыто' : `Скрыто: ${count(k, WORDS.message)}`,
        )
      }
      onClose={() => setToHide(null)}
    />
  );

  return { askHide: setToHide, keep, restore, modal, busyIds };
}
