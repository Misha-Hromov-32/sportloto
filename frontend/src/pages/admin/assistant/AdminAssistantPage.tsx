import { CopyIcon, PlugsConnectedIcon, PlugsIcon } from '@phosphor-icons/react';
import { useCustom } from '@refinedev/core';
import { App, Checkbox, Input, InputNumber, Radio, Select, Switch } from 'antd';
import { useEffect, useState } from 'react';

import { Button, ErrorState, PageHeader, Section, SkeletonBlock } from '@/components';
import { errorMessage, useAction } from '@/lib/api';
import { ASSISTANT_API, type AiFeature, type AssistantMode } from '@/pages/chat/remote';

import adminStyles from '../parts/admin.module.css';
import styles from './assistant.module.css';

type Mode = AssistantMode['mode'];
type Provider = 'openai' | 'gigachat' | 'yandexgpt';

interface AssistantSettings {
  enabled: boolean;
  features: Record<AiFeature, boolean>;
  mode: Mode;
  timeoutSeconds: number;
  local: { url: string; model: string };
  api: {
    provider: Provider;
    url: string;
    model: string;
    folderId: string;
    apiKeySet: boolean;
    apiKeyHint: string;
  };
  bridge: {
    keySet: boolean;
    keyHint: string;
    issuedAt: string;
    connected: boolean;
    clients: {
      name: string;
      engine: string;
      version: string;
      connectedAt: number;
      lastSeenAt: number;
      answered: number;
      busy: number;
    }[];
  };
}

interface TestResult {
  ok: boolean;
  engine?: string;
  ms: number;
  error?: string;
  reply?: {
    text: string;
    links: { label: string; to: string }[];
    search: string | null;
    action: { summary: string } | null;
  };
}

const FEATURES: { value: AiFeature; title: string; text: string }[] = [
  {
    value: 'chat',
    title: 'Ответы в чате',
    text: 'Выключено: чат отвечает по базе знаний сайта, без модели.',
  },
  {
    value: 'forms',
    title: 'Заполнение форм по одной фразе',
    text: 'Встреча, организация и объявление. Выключено: остаётся обычная форма.',
  },
  {
    value: 'search',
    title: 'Поиск фразой и подбор',
    text: 'В ленте и на главной. Выключено: поиск по словам и фильтрам.',
  },
  {
    value: 'premoderation',
    title: 'Предмодерация текстов',
    text: 'Отмечает для администратора грубые тексты и спам. Выключено: пометок нет.',
  },
  {
    value: 'covers',
    title: 'Рисование обложек',
    text: 'Кнопка в форме встречи. Работает только через мост на компьютере.',
  },
  {
    value: 'profile',
    title: 'Профиль из ВКонтакте',
    text: 'Модель дополняет анкету. Выключено: анкета заполняется без модели.',
  },
  {
    value: 'digest',
    title: 'Письмо подборки дня',
    text: 'Модель пишет вступление. Выключено: вступление обычное.',
  },
  {
    value: 'bots',
    title: 'Бот ВКонтакте',
    text: 'Свободный текст и встреча одной фразой. Выключено: кнопки, обычный поиск и создание по шагам.',
  },
  {
    value: 'mcp',
    title: 'Подключение внешних ассистентов (MCP)',
    text: 'Раздел в настройках и кнопка на главной. Выключено: подключение закрыто.',
  },
];

const MODES: { value: Mode; title: string; text: string }[] = [
  {
    value: 'local',
    title: 'Локальная модель',
    text: 'Модель на своём сервере: Ollama, LM Studio или другой сервер с OpenAI-совместимым API.',
  },
  {
    value: 'websocket',
    title: 'Мост на компьютере',
    text: 'Программа на компьютере подключается к сайту по WebSocket и отвечает через Codex.',
  },
  {
    value: 'api',
    title: 'Внешний API',
    text: 'Облачная модель по ключу: OpenAI-совместимый API, GigaChat или YandexGPT.',
  },
];

const PROVIDERS: { value: Provider; label: string; url: string; model: string }[] = [
  { value: 'openai', label: 'OpenAI-совместимый', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  {
    value: 'gigachat',
    label: 'GigaChat',
    url: 'https://gigachat.devices.sberbank.ru/api/v1',
    model: 'GigaChat',
  },
  {
    value: 'yandexgpt',
    label: 'YandexGPT',
    url: 'https://llm.api.cloud.yandex.net/foundationModels/v1',
    model: 'yandexgpt-lite/latest',
  },
];

const time = (ms: number) =>
  new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export default function AdminAssistantPage() {
  const { message } = App.useApp();
  const { query, result } = useCustom<AssistantSettings>({
    url: ASSISTANT_API.admin,
    method: 'get',
    queryOptions: { refetchInterval: 5000 },
  });
  // До ответа сервера Refine отдаёт пустой объект: считаем настройки загруженными, когда есть режим
  const loaded = result.data as AssistantSettings | undefined;
  const saved = loaded?.mode ? loaded : undefined;
  const [draft, setDraft] = useState<AssistantSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [question, setQuestion] = useState('Как записаться на встречу?');
  const [test, setTest] = useState<TestResult | null>(null);
  const { run, isPending } = useAction();

  useEffect(() => {
    if (saved && !draft) setDraft(saved);
  }, [saved, draft]);

  const header = (
    <PageHeader
      title="ИИ на сайте"
      subtitle="Модель можно подключить отдельно от поиска и заполнения форм. Выберите способ подключения и укажите его настройки. Если модель недоступна, помощник отвечает по справке сайта."
    />
  );
  if (query.isError)
    return (
      <div className={adminStyles.page}>
        {header}
        <ErrorState title="Не удалось открыть настройки помощника" onRetry={() => void query.refetch()} />
      </div>
    );
  if (!saved || !draft)
    return (
      <div className={adminStyles.page} aria-busy="true">
        {header}
        <SkeletonBlock height={220} />
      </div>
    );

  const set = (patch: Partial<AssistantSettings>) => setDraft({ ...draft, ...patch });
  const bridge = saved.bridge;
  const changed =
    JSON.stringify({ ...draft, bridge: null }) !== JSON.stringify({ ...saved, bridge: null }) || apiKey;

  const save = async () => {
    try {
      const next = (await run(
        ASSISTANT_API.admin,
        {
          enabled: draft.enabled,
          features: draft.features,
          ...(draft.mode === 'builtin' ? {} : { mode: draft.mode }),
          timeoutSeconds: draft.timeoutSeconds,
          local: draft.local,
          api: {
            provider: draft.api.provider,
            url: draft.api.url,
            model: draft.api.model,
            folderId: draft.api.folderId,
            ...(apiKey ? { apiKey } : {}),
          },
        },
        { method: 'put', success: 'Настройки помощника сохранены' },
      )) as unknown as AssistantSettings;
      setDraft(next);
      setApiKey('');
      void query.refetch();
    } catch {
      // текст ошибки уже показан
    }
  };
  const issue = async () => {
    try {
      const res = (await run(ASSISTANT_API.bridgeKey, {}, { silent: true })) as unknown as { key: string };
      setIssuedKey(res.key);
      void query.refetch();
    } catch (error) {
      message.error(errorMessage(error));
    }
  };
  const runTest = async () => {
    setTest(null);
    try {
      setTest((await run(ASSISTANT_API.test, { text: question }, { silent: true })) as unknown as TestResult);
    } catch (error) {
      setTest({ ok: false, ms: 0, error: errorMessage(error) });
    }
  };
  const provider = PROVIDERS.find((p) => p.value === draft.api.provider)!;

  return (
    <div className={adminStyles.page}>
      {header}

      <Section title="ИИ на сайте" aside={saved.enabled ? 'включён' : 'выключен'}>
        <label className={styles.master}>
          <Switch
            checked={draft.enabled}
            onChange={(enabled) => set({ enabled })}
            aria-label="Включить ИИ на сайте"
          />
          <span>
            <strong>{draft.enabled ? 'Включено' : 'Выключено'}</strong>
            {draft.enabled
              ? 'Заработает после сохранения, если ниже указаны ключ и данные.'
              : 'Чат отвечает по справке и правилам. Разбор форм, поиск, предмодерация и MCP включаются отдельно ниже. Настройки модели сохраняются.'}
          </span>
        </label>
      </Section>

      <Section title="Чем работать">
        <Radio.Group
          className={styles.modes}
          value={draft.mode}
          onChange={(e) => set({ mode: e.target.value as Mode })}
          aria-label="Чем работает ИИ"
        >
          {MODES.map((m) => (
            <Radio key={m.value} value={m.value} className={styles.mode}>
              <strong>{m.title}</strong>
              <span>{m.text}</span>
              {saved.enabled && saved.mode === m.value && <em>Сейчас включён</em>}
            </Radio>
          ))}
        </Radio.Group>
      </Section>

      {draft.mode === 'local' && (
        <Section title="Локальная модель">
          <div className={styles.fields}>
            <label>
              Адрес сервера
              <Input
                value={draft.local.url}
                onChange={(e) => set({ local: { ...draft.local, url: e.target.value } })}
                placeholder="http://host.docker.internal:11434/v1"
              />
              <small>Для Ollama на этом же сервере: http://host.docker.internal:11434/v1</small>
            </label>
            <label>
              Модель
              <Input
                value={draft.local.model}
                onChange={(e) => set({ local: { ...draft.local, model: e.target.value } })}
                placeholder="qwen2.5:7b"
              />
            </label>
          </div>
        </Section>
      )}

      {draft.mode === 'api' && (
        <Section title="Внешний API">
          <div className={styles.fields}>
            <label>
              Провайдер
              <Select
                value={draft.api.provider}
                options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
                onChange={(value: Provider) => {
                  const p = PROVIDERS.find((x) => x.value === value)!;
                  set({ api: { ...draft.api, provider: value, url: p.url, model: p.model } });
                }}
              />
            </label>
            {draft.api.provider === 'openai' && (
              <label>
                Адрес API
                <Input
                  value={draft.api.url}
                  onChange={(e) => set({ api: { ...draft.api, url: e.target.value } })}
                />
                <small>Подойдёт любой сервис с OpenAI-совместимым API, например OpenRouter.</small>
              </label>
            )}
            <label>
              Модель
              <Input
                value={draft.api.model}
                placeholder={provider.model}
                onChange={(e) => set({ api: { ...draft.api, model: e.target.value } })}
              />
            </label>
            {draft.api.provider === 'yandexgpt' && (
              <label>
                Каталог (folder id)
                <Input
                  value={draft.api.folderId}
                  onChange={(e) => set({ api: { ...draft.api, folderId: e.target.value } })}
                />
              </label>
            )}
            <label>
              {draft.api.provider === 'gigachat' ? 'Ключ авторизации' : 'Ключ API'}
              <Input.Password
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  draft.api.apiKeySet
                    ? `Сохранён (${draft.api.apiKeyHint}). Оставьте пустым, чтобы не менять`
                    : 'Вставьте ключ'
                }
                autoComplete="off"
              />
            </label>
          </div>
        </Section>
      )}

      {draft.mode === 'websocket' && (
        <Section title="Мост на компьютере" aside={bridge.connected ? 'подключён' : 'не подключён'}>
          <div className={styles.bridge}>
            <p className={styles.status} data-on={bridge.connected ? '' : undefined}>
              {bridge.connected ? (
                <PlugsConnectedIcon size={22} aria-hidden />
              ) : (
                <PlugsIcon size={22} aria-hidden />
              )}
              {bridge.connected
                ? `Подключено: ${bridge.clients.map((c) => `${c.name} (${c.engine} ${c.version})`).join(', ')}`
                : 'Сейчас ни один компьютер не подключён. Пока его нет, чат отвечает без модели.'}
            </p>
            {bridge.clients.map((c) => (
              <p key={c.name + c.connectedAt} className={styles.client}>
                {c.name}: на связи с {time(c.connectedAt)}, ответов: {c.answered}, сейчас в работе: {c.busy}
              </p>
            ))}
            <ol className={styles.howto}>
              <li>Выпустите ключ моста кнопкой ниже и скопируйте его.</li>
              <li>
                На компьютере с Codex откройте папку <code>bridge</code> из репозитория, скопируйте{' '}
                <code>config.example.json</code> в <code>config.json</code> и вставьте ключ.
              </li>
              <li>
                Запустите <code>install-autostart.ps1</code>: мост будет работать постоянно и запускаться
                вместе с Windows.
              </li>
            </ol>
            <div className={styles.keyRow}>
              <Button variant="secondary" onClick={() => void issue()} loading={isPending}>
                {bridge.keySet ? 'Выпустить новый ключ' : 'Выпустить ключ моста'}
              </Button>
              {bridge.keySet && !issuedKey && (
                <span>
                  Ключ выпущен {bridge.issuedAt ? time(Date.parse(bridge.issuedAt)) : ''} ({bridge.keyHint})
                </span>
              )}
            </div>
            {issuedKey && (
              <div className={styles.issued} role="status">
                <p>
                  Новый ключ. Скопируйте его сейчас: потом он будет скрыт. Старый ключ больше не работает.
                </p>
                <code>{issuedKey}</code>
                <Button
                  variant="quiet"
                  icon={<CopyIcon size={18} aria-hidden />}
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(issuedKey)
                      .then(() => message.success('Ключ скопирован'))
                  }
                >
                  Скопировать
                </Button>
              </div>
            )}
          </div>
        </Section>
      )}

      <Section
        title="Что включить"
        aside={draft.enabled ? undefined : 'Модель выключена; функции на правилах доступны отдельно'}
      >
        <div className={styles.features}>
          {FEATURES.map((f) => (
            <Checkbox
              key={f.value}
              className={styles.feature}
              checked={draft.features[f.value]}
              disabled={!draft.enabled && !['forms', 'search', 'premoderation', 'mcp'].includes(f.value)}
              onChange={(e) => set({ features: { ...draft.features, [f.value]: e.target.checked } })}
            >
              <strong>{f.title}</strong>
              <span>{f.text}</span>
            </Checkbox>
          ))}
        </div>
      </Section>

      {draft.mode !== 'builtin' && (
        <Section title="Сколько ждать ответа">
          <label className={styles.inline}>
            <InputNumber
              min={5}
              max={120}
              value={draft.timeoutSeconds}
              onChange={(v) => set({ timeoutSeconds: Number(v ?? 45) })}
            />
            секунд, потом чат ответит без модели
          </label>
        </Section>
      )}

      <div className={styles.saveRow}>
        <Button
          variant="primary"
          size="lg"
          disabled={!changed}
          loading={isPending}
          onClick={() => void save()}
        >
          Сохранить
        </Button>
        {changed && (
          <Button
            variant="quiet"
            onClick={() => {
              setDraft(saved);
              setApiKey('');
            }}
          >
            Отменить изменения
          </Button>
        )}
      </div>

      <Section title="Проверить ответ">
        <div className={styles.test}>
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={400}
            aria-label="Вопрос для проверки"
          />
          <Button
            variant="secondary"
            onClick={() => void runTest()}
            loading={isPending}
            disabled={saved.mode === 'builtin'}
          >
            Спросить
          </Button>
        </div>
        {saved.mode === 'builtin' && (
          <p className={styles.note}>Сначала выберите, чем работать, укажите данные и сохраните.</p>
        )}
        {test && (
          <div className={styles.result} data-ok={test.ok ? '' : undefined}>
            {test.ok && test.reply ? (
              <>
                <p>{test.reply.text}</p>
                {test.reply.search && <p className={styles.note}>Подбор встреч: «{test.reply.search}»</p>}
                {test.reply.action && (
                  <p className={styles.note}>Предложит действие: {test.reply.action.summary}</p>
                )}
                <p className={styles.note}>Ответил за {(test.ms / 1000).toFixed(1)} с</p>
              </>
            ) : (
              <p>Модель не ответила: {test.error}. Чат в это время отвечает без модели.</p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
