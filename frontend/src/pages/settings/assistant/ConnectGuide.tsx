import { Copy, Info } from '@phosphor-icons/react';
import { App } from 'antd';

import { Button, Section } from '@/components';
import { count } from '@/lib/plural';
import type { McpCatalog } from '@/types/mcp';

import styles from './assistant.module.css';
import { copyText } from './helpers';

const TOOL_WORDS = ['инструмент', 'инструмента', 'инструментов'] as const;
const RESOURCE_WORDS = ['материал', 'материала', 'материалов'] as const;
const CALL_WORDS = ['вызова', 'вызовов', 'вызовов'] as const;

function endpointUrl(catalog: McpCatalog): string {
  return `${window.location.origin}${catalog.endpointPath}`;
}

function clientConfig(catalog: McpCatalog): string {
  return JSON.stringify(
    {
      mcpServers: {
        [catalog.serverInfo.name]: {
          type: 'http',
          url: endpointUrl(catalog),
          headers: { Authorization: 'Bearer <ваш токен>' },
        },
      },
    },
    null,
    2,
  );
}

export function ConnectGuide({ catalog }: { catalog: McpCatalog }) {
  const { message } = App.useApp();
  const copy = async (text: string, what: string) =>
    (await copyText(text)) ? message.success(`${what} скопирован`) : message.error('Не получилось скопировать. Выделите текст и скопируйте вручную');
  const url = endpointUrl(catalog);
  const config = clientConfig(catalog);

  return (
    <Section title="Как подключить">
      <div className={styles.guide}>
        <div className={styles.stack}>
          <p className={styles.lead}>Подойдёт любой ассистент с поддержкой MCP: в его настройках можно добавить свой сервер.</p>
          <ol className={styles.steps}>
            <li>Выпустите токен выше и скопируйте его.</li>
            <li>
              В настройках ассистента добавьте сервер MCP. Адрес:
              <span className={styles.endpoint}>
                <span className={styles.inlineCode}>{url}</span>
                <Button size="sm" variant="quiet" icon={<Copy size={18} aria-hidden />} onClick={() => void copy(url, 'Адрес')}>
                  Скопировать адрес
                </Button>
              </span>
            </li>
            <li>
              Способ связи: Streamable HTTP. В заголовке <span className={styles.inlineCode}>Authorization</span> укажите{' '}
              <span className={styles.inlineCode}>Bearer</span> и ваш токен.
            </li>
            <li>Попросите ассистента, например: «Найди волейбол на выходных для новичков». Запись, отмену и вопросы организатору он сначала покажет и выполнит, только когда вы согласитесь.</li>
          </ol>
          <p className={styles.note}>
            <Info size={20} weight="bold" aria-hidden />
            <span>Проверить инструменты без ассистента можно в консоли ниже.</span>
          </p>
        </div>
        <div className={styles.stack}>
          <div className={styles.rawHead}>
            <span>Пример настройки</span>
            <Button size="sm" variant="quiet" icon={<Copy size={18} aria-hidden />} onClick={() => void copy(config, 'Пример')}>
              Скопировать пример
            </Button>
          </div>
          <pre className={styles.code} aria-label="Пример настройки ассистента в формате JSON">{config}</pre>
          <p className={styles.muted}>
            Ассистенту доступны {count(catalog.tools.length, TOOL_WORDS)} и {count(catalog.resources.length, RESOURCE_WORDS)}. Не больше {count(catalog.limits.callsPerMinute, CALL_WORDS)} в минуту на один токен.
          </p>
        </div>
      </div>
    </Section>
  );
}
