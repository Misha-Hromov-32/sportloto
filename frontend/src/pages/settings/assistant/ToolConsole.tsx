import { CheckCircle, Clock, Play, WarningCircle } from '@phosphor-icons/react';
import { useList } from '@refinedev/core';
import { Input, Select } from 'antd';
import { useId, useMemo, useState } from 'react';

import { Button, Section } from '@/components';
import { errorMessage, useAction } from '@/lib/api';
import { formatShortDate, formatTime } from '@/lib/dates';
import type { EventView } from '@/types/api';
import type { JsonRpcResponse, McpCatalog, McpExchange, McpTool, McpToolResult } from '@/types/mcp';

import { Field } from '../../events/create/fields';
import { MCP_API } from './api';
import styles from './assistant.module.css';
import { cleanArgs, initialArgs, type ArgValues } from './helpers';
import { SchemaForm, type EventOption } from './SchemaForm';

interface Target {
  key: string;
  label: string;
  method: string;
  tool?: McpTool;
  uri?: string;
}

function targetsOf(catalog: McpCatalog): { label: string; options: Target[] }[] {
  return [
    {
      label: 'Инструменты',
      options: catalog.tools.map((t) => ({ key: `tool:${t.name}`, label: `${t.title} (${t.name})`, method: 'tools/call', tool: t })),
    },
    {
      label: 'Материалы',
      options: catalog.resources.map((r) => ({ key: `res:${r.uri}`, label: `${r.title} (resources/read)`, method: 'resources/read', uri: r.uri })),
    },
    {
      label: 'Служебные вызовы',
      options: [
        { key: 'initialize', label: 'Подключение (initialize)', method: 'initialize' },
        { key: 'tools/list', label: 'Список инструментов (tools/list)', method: 'tools/list' },
        { key: 'resources/list', label: 'Список материалов (resources/list)', method: 'resources/list' },
      ],
    },
  ];
}

function useEventOptions(): EventOption[] {
  const { result } = useList<EventView>({
    resource: 'events',
    filters: [{ field: 'scope', operator: 'eq', value: 'feed' }],
    pagination: { mode: 'off' },
  });
  return useMemo(
    () =>
      (result.data ?? []).map((e) => ({
        value: e.id,
        label: `${e.title}, ${formatShortDate(e.startsAt)}, ${formatTime(e.startsAt)} (${e.id})`,
      })),
    [result.data],
  );
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

function maskToken(token: string) {
  return token.length > 12 ? `${token.slice(0, 4)}…${token.slice(-4)}` : token;
}

/** Ссылки, по которым видно, что вызов изменил данные. */
function effectLinks(tool: string | undefined, data: Record<string, unknown>) {
  const event = data.event as { id?: string } | undefined;
  if (tool === 'create_event_draft' && typeof data.path === 'string')
    return [{ to: data.path, label: 'Открыть черновик' }];
  if (!data.done || !event?.id) return [];
  if (tool === 'ask_organizer') return [{ to: `/events/${event.id}#discussion`, label: 'Открыть обсуждение' }];
  return [
    { to: '/me', label: 'Мои занятия' },
    { to: `/events/${event.id}`, label: 'Открыть событие' },
  ];
}

function Answer({
  exchange,
  tool,
  onConfirm,
}: {
  exchange: McpExchange;
  tool?: McpTool;
  onConfirm: () => void;
}) {
  const res = exchange.response as JsonRpcResponse | null;
  if (!res)
    return (
      <div className={styles.answer}>
        <p>Сервер принял уведомление. Ответ на уведомления не отправляется.</p>
      </div>
    );
  if ('error' in res)
    return (
      <div className={[styles.answer, styles.answerError].join(' ')} role="alert">
        <p className={styles.secretTitle}>
          <WarningCircle size={22} weight="bold" aria-hidden />
          Сервер не выполнил вызов
        </p>
        <p className={styles.answerText}>{res.error.message}</p>
        <p className={styles.muted}>Код ошибки JSON-RPC: {res.error.code}</p>
      </div>
    );
  const result = res.result as Partial<McpToolResult> & Record<string, unknown>;
  if (Array.isArray(result.content)) {
    const data = (result.structuredContent ?? {}) as Record<string, unknown>;
    const preview = data.preview === true;
    const links = effectLinks(tool?.name, data);
    const tone = result.isError ? styles.answerError : preview ? styles.answerWait : styles.answerOk;
    return (
      <div className={[styles.answer, tone].join(' ')} role="status">
        <p className={styles.secretTitle}>
          {result.isError ? (
            <WarningCircle size={22} weight="bold" aria-hidden />
          ) : preview ? (
            <Clock size={22} weight="bold" aria-hidden />
          ) : (
            <CheckCircle size={22} weight="bold" aria-hidden />
          )}
          {result.isError ? 'Инструмент отказал' : preview ? 'Предпросмотр' : 'Выполнено'}
        </p>
        <p className={styles.answerText}>{result.content.map((c) => c.text).join('\n')}</p>
        {(preview || links.length > 0) && (
          <div className={styles.row}>
            {preview && (
              <Button variant="primary" onClick={onConfirm}>
                Подтвердить и выполнить
              </Button>
            )}
            {links.map((l) => (
              <Button key={l.to} to={l.to} variant="secondary">
                {l.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  }
  const summary = Array.isArray(result.tools)
    ? `Инструментов в ответе: ${result.tools.length}.`
    : Array.isArray(result.resources)
      ? `Материалов в ответе: ${result.resources.length}.`
      : Array.isArray(result.contents)
        ? 'Текст материала показан в ответе ниже.'
        : typeof result.protocolVersion === 'string'
          ? `Подключение установлено, версия протокола ${result.protocolVersion}.`
          : 'Ответ получен.';
  return (
    <div className={[styles.answer, styles.answerOk].join(' ')} role="status">
      <p className={styles.secretTitle}>
        <CheckCircle size={22} weight="bold" aria-hidden />
        {summary}
      </p>
    </div>
  );
}

export function ToolConsole({ catalog, token, onTokenChange }: { catalog: McpCatalog; token: string; onTokenChange: (v: string) => void }) {
  const tokenId = useId();
  const targetId = useId();
  const groups = useMemo(() => targetsOf(catalog), [catalog]);
  const all = useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const [key, setKey] = useState('tool:search_events');
  const target = all.find((t) => t.key === key) ?? all[0]!;
  const [args, setArgs] = useState<ArgValues>(() => (target.tool ? initialArgs(target.tool.inputSchema) : {}));
  const [requestId, setRequestId] = useState(1);
  const [last, setLast] = useState<{ request: unknown; exchange: McpExchange; tool?: McpTool } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const events = useEventOptions();
  const { run, isPending } = useAction();

  const choose = (next: string) => {
    const t = all.find((x) => x.key === next);
    setKey(next);
    setArgs(t?.tool ? initialArgs(t.tool.inputSchema) : {});
    setLast(null);
    setFailure(null);
  };

  const buildRequest = (values: ArgValues) => {
    const params =
      target.method === 'tools/call'
        ? { name: target.tool!.name, arguments: cleanArgs(values) }
        : target.method === 'resources/read'
          ? { uri: target.uri }
          : target.method === 'initialize'
            ? { protocolVersion: catalog.protocolVersion, capabilities: {}, clientInfo: { name: 'console', version: '1.0' } }
            : undefined;
    return { jsonrpc: '2.0' as const, id: requestId, method: target.method, ...(params ? { params } : {}) };
  };
  const request = buildRequest(args);

  const execute = async (values: ArgValues) => {
    const message = buildRequest(values);
    setFailure(null);
    try {
      const auth = token.trim() ? `Bearer ${token.trim()}` : undefined;
      const exchange = (await run(MCP_API.endpoint, { authorization: auth, message }, { silent: true })) as unknown as McpExchange;
      setLast({ request: message, exchange, tool: target.tool });
      setRequestId((n) => n + 1);
    } catch (error) {
      setFailure(errorMessage(error, 'Не удалось выполнить вызов. Попробуйте ещё раз'));
    }
  };

  const confirmAndRun = () => {
    const next = { ...args, confirm: true };
    setArgs(next);
    void execute(next);
  };

  const fieldErrors =
    last?.exchange.response && 'result' in last.exchange.response
      ? (((last.exchange.response.result.structuredContent as { error?: { fields?: Record<string, string> } } | undefined)?.error?.fields) ?? {})
      : {};

  const headers = [
    `POST ${catalog.endpointPath} HTTP/1.1`,
    'Content-Type: application/json',
    'Accept: application/json, text/event-stream',
    `MCP-Protocol-Version: ${catalog.protocolVersion}`,
    token.trim() ? `Authorization: Bearer ${maskToken(token.trim())}` : '# Заголовка Authorization нет',
  ].join('\n');

  return (
    <Section title="Проверить инструменты" id="console">
      <div className={styles.stack}>
        <p className={styles.lead}>
          Здесь можно сделать те же вызовы, что сделает ассистент, на ваших данных. Вызов идёт от имени владельца токена: запись через консоль появится в «Моих занятиях» и у организатора.
        </p>
        <div className={styles.console}>
          <div className={styles.panel}>
            <Field
              label="Токен"
              htmlFor={tokenId}
              hint="Полный токен виден только сразу после выпуска. Без токена или с отозванным токеном сервер ответит ошибкой."
            >
              <Input.Password
                id={tokenId}
                size="large"
                autoComplete="off"
                placeholder="stp_…"
                value={token}
                onChange={(e) => onTokenChange(e.target.value)}
              />
            </Field>
            <Field label="Что вызвать" htmlFor={targetId}>
              <Select
                id={targetId}
                size="large"
                value={key}
                onChange={choose}
                options={groups.map((g) => ({ label: g.label, options: g.options.map((o) => ({ value: o.key, label: o.label })) }))}
              />
            </Field>
            {target.tool && (
              <div className={styles.toolInfo}>
                <p>{target.tool.description}</p>
                <ul className={styles.toolTags}>
                  <li className={styles.tag}>
                    Нужно право: {catalog.scopes.find((s) => s.value === target.tool!._meta.scope)?.label.toLowerCase()}
                  </li>
                  <li className={styles.tag}>
                    {target.tool.annotations.readOnlyHint ? 'Ничего не меняет' : 'Меняет данные, сначала предпросмотр'}
                  </li>
                </ul>
              </div>
            )}
            {target.tool && (
              <SchemaForm
                schema={target.tool.inputSchema}
                values={args}
                onChange={(v) => {
                  setArgs(v);
                  setLast(null);
                }}
                errors={fieldErrors}
                events={events}
              />
            )}
            <div className={styles.row}>
              <Button
                variant="primary"
                icon={<Play size={20} weight="fill" aria-hidden />}
                loading={isPending}
                loadingText="Выполняем…"
                onClick={() => void execute(args)}
              >
                Выполнить
              </Button>
            </div>
          </div>

          <div className={styles.panel} aria-live="polite">
            {failure && (
              <div className={[styles.answer, styles.answerError].join(' ')} role="alert">
                <p className={styles.answerText}>{failure}</p>
              </div>
            )}
            {last && <Answer exchange={last.exchange} tool={last.tool} onConfirm={confirmAndRun} />}
            <div className={styles.stack}>
              <div className={styles.rawHead}>
                <span>{last ? 'Отправленный запрос' : 'Запрос'}</span>
                <span className={styles.muted}>JSON-RPC 2.0</span>
              </div>
              <pre className={[styles.code, styles.codeTall].join(' ')}>
                {`${headers}\n\n${pretty(last ? last.request : request)}`}
              </pre>
            </div>
            {last && (
              <div className={styles.stack}>
                <div className={styles.rawHead}>
                  <span>Ответ</span>
                  <span className={styles.muted}>HTTP {last.exchange.httpStatus}</span>
                </div>
                <pre className={[styles.code, styles.codeTall].join(' ')}>
                  {last.exchange.response ? pretty(last.exchange.response) : '(пустое тело)'}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}
