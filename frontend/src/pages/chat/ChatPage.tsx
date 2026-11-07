import {
  ArrowLeftIcon,
  ArrowUpIcon,
  ArrowsInSimpleIcon,
  BackpackIcon,
  BasketballIcon,
  CalendarBlankIcon,
  ChatCircleDotsIcon,
  ClockCounterClockwiseIcon,
  MapPinIcon,
  ListIcon,
  HandWavingIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
  UsersThreeIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useCustom, useDataProvider, useList } from '@refinedev/core';
import { Input, Modal } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { PageSkeleton } from '@/components';
import { apiRequest } from '@/api/client';
import { AssistantGlyph } from '@/components/Assistant/AssistantGlyph';
import { API, errorMessage, useAction, useMe } from '@/lib/api';
import { formatEventDate } from '@/lib/dates';
import { useSelectedCity } from '@/lib/useSelectedCity';
import { uid } from '@/lib/uid';
import type {
  AssistantDraft,
  EventView,
  MatchOption,
  MatchResult,
  ParsedSearch,
  SportView,
} from '@/types/api';
import type { District } from '@/types/domain';
import { actionRows, manualLink, useAssistantActions, type AssistantAction } from './actions';
import { localReply, type LocalClient } from './engine';
import { ASSISTANT_API, fromRemote, historyFor, type AssistantMode, type RemoteReply } from './remote';
import { EXAMPLES, type ChatAnswer, type ChatThread } from './model';
import { ASSISTANT_NAME } from './name';
import { assistantReturnTo } from './navigation';
import { chatKey, newThread, readActiveChat, readChats, saveActiveChat, saveChats } from './storage';
import styles from './ChatPage.module.css';
import fullStyles from './FullChat.module.css';

const EXAMPLE_ICONS = [BasketballIcon, UsersThreeIcon, HandWavingIcon, BackpackIcon];

export default function ChatPage({ compact = false }: { compact?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = assistantReturnTo(location.state);
  const leave = useCallback(
    (widget = false) => {
      navigate(returnTo, { replace: true, state: widget ? { assistantWidget: true } : null });
    },
    [navigate, returnTo],
  );
  useLayoutEffect(() => {
    if (!compact) window.scrollTo(0, 0);
  }, [compact]);
  const { me, isLoading } = useMe();
  const city = useSelectedCity();
  if (isLoading)
    return (
      <div className={compact ? 'container' : fullStyles.loading}>
        {!compact && <ChatWindowControls onLeave={leave} />}
        <PageSkeleton label="Открываем чат…" />
      </div>
    );
  const scope = chatKey(me?.id ?? null, city.id);
  return (
    <ChatSession
      key={scope}
      storageKey={scope}
      cityId={city.id}
      cityName={city.name}
      guest={!me}
      role={me?.role === 'admin' ? 'admin' : me?.role === 'org' ? 'organizer' : me ? 'user' : 'guest'}
      compact={compact}
      onLeave={leave}
      returnTo={returnTo}
    />
  );
}

function ChatWindowControls({ onLeave }: { onLeave: (widget?: boolean) => void }) {
  return (
    <div className={fullStyles.windowControls} aria-label="Управление окном чата">
      <button type="button" onClick={() => onLeave(true)} aria-label="Свернуть чат" title="Свернуть чат">
        <ArrowsInSimpleIcon size={20} aria-hidden />
        <span>Свернуть</span>
      </button>
      <button
        type="button"
        onClick={() => onLeave()}
        aria-label="Закрыть чат"
        title="Закрыть чат (Esc)"
        aria-keyshortcuts="Escape"
      >
        <XIcon size={21} aria-hidden />
      </button>
    </div>
  );
}

function ChatSession({
  storageKey,
  cityId,
  cityName,
  guest,
  role,
  compact,
  onLeave,
  returnTo,
}: {
  storageKey: string;
  cityId: string;
  cityName: string;
  guest: boolean;
  role: LocalClient['role'];
  compact: boolean;
  onLeave: (widget?: boolean) => void;
  returnTo: string;
}) {
  const [threads, setThreads] = useState<ChatThread[]>(() => {
    const saved = readChats(storageKey);
    return saved.length ? saved : [newThread()];
  });
  const [active, setActive] = useState(() => readActiveChat(storageKey, threads));
  const thread = (threads.find((t) => t.id === active) ?? threads[0])!;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [persisted, setPersisted] = useState(true);
  const sequence = useRef(0);
  const pendingRequest = useRef<AbortController | null>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const input = useRef<TextAreaRef>(null);
  const historyMenu = useRef<HTMLDetailsElement>(null);
  const { run: match } = useAction<MatchResult>();
  const { run: parse } = useAction<ParsedSearch>();
  const { run: draft } = useAction();
  const execute = useAssistantActions();
  const dataProvider = useDataProvider();
  const { pathname } = useLocation();
  const sports = useList<SportView>({ resource: 'sports', pagination: { mode: 'off' } }).result.data;
  const districts = useList<District>({ resource: 'districts', pagination: { mode: 'off' } }).result.data;
  const modeQuery = useCustom<AssistantMode>({
    url: ASSISTANT_API.config,
    method: 'get',
    queryOptions: { retry: false, staleTime: 30_000 },
  });
  const mode = (modeQuery.result.data as AssistantMode | undefined)?.mode
    ? (modeQuery.result.data as AssistantMode)
    : undefined;
  const client = useMemo<LocalClient>(
    () => ({
      parse: (value) => parse(API.assistantSearch, { text: value }, { silent: true }),
      match: (payload) => match(API.assistantMatch, payload, { silent: true }),
      draft: async <T,>(kind: 'event' | 'companion', value: string) =>
        (await draft(
          API.assistantDraft,
          { kind, text: value },
          { silent: true },
        )) as unknown as AssistantDraft<T>,
      sportName: (id) => sports.find((s) => s.id === id)?.name,
      districtName: (id) => districts.find((d) => d.id === id)?.name,
      myEvents: async () => {
        const res = await dataProvider().getList<EventView>({
          resource: 'events',
          filters: [{ field: 'scope', operator: 'eq', value: 'participating' }],
          pagination: { mode: 'off' },
        });
        return res.data
          .filter(
            (e) =>
              e.state === 'upcoming' && e.my && ['confirmed', 'pending', 'waitlist'].includes(e.my.status),
          )
          .map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt }));
      },
      role,
    }),
    [parse, match, draft, sports, districts, dataProvider, role],
  );
  useEffect(() => {
    setPersisted(saveChats(storageKey, threads));
  }, [storageKey, threads]);
  useEffect(() => {
    saveActiveChat(storageKey, active);
  }, [storageKey, active]);
  useEffect(
    () => () => {
      sequence.current++;
      pendingRequest.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const node = conversation.current;
    if (node) {
      const last = thread.messages.at(-1);
      const reply =
        last?.role === 'assistant' ? node.querySelector<HTMLElement>(`[data-message="${last.id}"]`) : null;
      node.scrollTop = !thread.messages.length ? 0 : reply ? reply.offsetTop - 12 : node.scrollHeight;
    }
  }, [thread.messages, active, busy]);
  const stop = () => {
    sequence.current++;
    pendingRequest.current?.abort();
    pendingRequest.current = null;
    setBusy(false);
  };
  const start = () => {
    historyMenu.current?.removeAttribute('open');
    stop();
    const fresh = newThread();
    setThreads((old) => [fresh, ...old.filter((t) => t.messages.length)].slice(0, 8));
    setActive(fresh.id);
    setText('');
    input.current?.focus({ preventScroll: true });
  };
  const send = async (value: string, choice?: MatchOption) => {
    const prompt = value.trim().slice(0, 400);
    if (!prompt || busy) return;
    const request = ++sequence.current;
    const controller = new AbortController();
    pendingRequest.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), 45_000);
    const requestClient: LocalClient = {
      ...client,
      parse: (value) =>
        apiRequest('post', API.assistantSearch, { body: { text: value }, signal: controller.signal }),
      match: (payload) =>
        apiRequest('post', API.assistantMatch, { body: payload, signal: controller.signal }),
      draft: <T,>(kind: 'event' | 'companion', value: string) =>
        apiRequest<AssistantDraft<T>>('post', API.assistantDraft, {
          body: { kind, text: value },
          signal: controller.signal,
        }),
      myEvents: async () => {
        const res = await apiRequest<{ data: EventView[] }>('get', '/events', {
          query: {
            filters: [{ field: 'scope', operator: 'eq', value: 'participating' }],
            pagination: { mode: 'off' },
          },
          signal: controller.signal,
        });
        return res.data
          .filter(
            (e) =>
              e.state === 'upcoming' && e.my && ['confirmed', 'pending', 'waitlist'].includes(e.my.status),
          )
          .map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt }));
      },
    };
    const id = thread.id;
    const append = (answer: ChatAnswer, retry?: string) =>
      setThreads((old) =>
        old.map((t) =>
          t.id === id
            ? {
                ...t,
                messages: [...t.messages, { id: uid(), role: 'assistant' as const, answer, retry }].slice(
                  -32,
                ),
              }
            : t,
        ),
      );
    setText('');
    setBusy(true);
    setThreads((old) =>
      old.map((t) =>
        t.id === id
          ? {
              ...t,
              title: t.messages.length ? t.title : prompt.slice(0, 48),
              messages: [...t.messages, { id: uid(), role: 'user' as const, answer: { text: prompt } }].slice(
                -31,
              ),
            }
          : t,
      ),
    );
    try {
      let result: { answer: ChatAnswer; context: typeof thread.context } | null = null;
      if (mode?.ready && !choice && !thread.context?.pending) {
        try {
          const reply = await apiRequest<RemoteReply>('post', ASSISTANT_API.chat, {
            body: { messages: historyFor(thread.messages, prompt), cityId, page: pathname },
            signal: controller.signal,
          });
          const answer = fromRemote(reply);
          const cards = answer.cards?.map((c) => ({ id: c.id, title: c.title }));
          result = {
            answer,
            context: cards?.length
              ? { ...(thread.context ?? { text: '', filters: {}, asked: [] }), cards }
              : thread.context,
          };
        } catch {
          result = null; // модель недоступна — отвечаем без неё
        }
      }
      if (controller.signal.aborted) throw new Error('Время ожидания ответа истекло. Попробуйте ещё раз.');
      result ??= await localReply(prompt, thread.context, cityId, requestClient, choice);
      if (sequence.current !== request) return;
      setThreads((old) => old.map((t) => (t.id === id ? { ...t, context: result.context } : t)));
      append(result.answer);
      if (result.answer.action && result.answer.autoRun) void confirm(id, null, result.answer.action);
    } catch (error) {
      if (sequence.current !== request) return;
      append(
        {
          text: `Не удалось получить ответ. ${controller.signal.aborted ? 'Время ожидания истекло. Попробуйте ещё раз.' : errorMessage(error, 'Попробуйте ещё раз.')}`,
          links: [{ label: 'Искать в каталоге', to: `/events?phrase=${encodeURIComponent(prompt)}` }],
        },
        prompt,
      );
    } finally {
      window.clearTimeout(deadline);
      if (sequence.current === request) {
        pendingRequest.current = null;
        setBusy(false);
        input.current?.focus({ preventScroll: true });
      }
    }
  };
  const appendTo = (threadId: string, answer: ChatAnswer) =>
    setThreads((old) =>
      old.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: [...t.messages, { id: uid(), role: 'assistant' as const, answer }].slice(-32),
            }
          : t,
      ),
    );
  const markAction = (threadId: string, messageId: string, status: NonNullable<AssistantAction['status']>) =>
    setThreads((old) =>
      old.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: t.messages.map((m) =>
                m.id === messageId && m.answer.action
                  ? { ...m, answer: { ...m.answer, action: { ...m.answer.action, status } } }
                  : m,
              ),
            }
          : t,
      ),
    );
  const dropPending = (threadId: string) =>
    setThreads((old) =>
      old.map((t) =>
        t.id === threadId && t.context ? { ...t, context: { ...t.context, pending: undefined } } : t,
      ),
    );
  /** «Подтвердить»: действие выполняется обычными запросами сайта от имени человека. */
  async function confirm(threadId: string, messageId: string | null, action: AssistantAction) {
    if (messageId) markAction(threadId, messageId, 'done');
    setBusy(true);
    try {
      const outcome = await execute(action);
      if (messageId && !outcome.ok) markAction(threadId, messageId, 'failed');
      if (outcome.ok && action.type === 'create_event') dropPending(threadId);
      if (!(outcome.ok && action.type === 'navigate'))
        appendTo(threadId, { text: outcome.text, links: outcome.links });
    } finally {
      setBusy(false);
    }
  }
  const cancelAction = (threadId: string, messageId: string) => {
    markAction(threadId, messageId, 'cancelled');
    dropPending(threadId);
    appendTo(threadId, { text: 'Хорошо, не делаю. Если передумаете, напишите.' });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };
  const to = (url: string) =>
    guest && /^\/(me|events\/new|companions\/new)(\?|$)/.test(url)
      ? `/login?to=${encodeURIComponent(url)}`
      : url;
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (compact || confirmClear) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      // Let a city picker, account menu or another dialog handle Escape first.
      if (
        Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"], [role="menu"], [role="listbox"]'),
        ).some((node) => node.getClientRects().length > 0)
      )
        return;
      if (historyMenu.current?.open) {
        historyMenu.current.removeAttribute('open');
        historyMenu.current.querySelector('summary')?.focus();
      } else {
        onLeave();
      }
      event.preventDefault();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [compact, confirmClear, onLeave]);
  const chooseThread = (id: string) => {
    stop();
    setActive(id);
    setText('');
  };
  const skin = (part: string) => [styles[part], !compact && fullStyles[part]].filter(Boolean).join(' ');

  const composer = (
    <form className={skin('composer')} onSubmit={submit} aria-label="Сообщение помощнику">
      <div className={skin('inputWrap')}>
        <span className={skin('composerMark')}>
          <AssistantGlyph size={23} />
        </span>
        <label className="sr-only" htmlFor="chat-message">
          Ваше сообщение
        </label>
        <Input.TextArea
          ref={input}
          id="chat-message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoSize={{ minRows: compact || thread.messages.length ? 1 : 2, maxRows: 5 }}
          maxLength={400}
          placeholder={
            compact || thread.messages.length
              ? 'Напишите вопрос или уточнение'
              : 'Например, хочу поиграть в волейбол в выходные'
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        {!compact && (
          <span className={fullStyles.inputNote}>
            <MapPinIcon size={16} /> Встречи в городе {cityName}
          </span>
        )}
        {busy ? (
          <button type="button" className={skin('send')} onClick={stop} aria-label="Остановить ответ">
            <StopIcon size={20} weight="fill" />
          </button>
        ) : (
          <button
            type="submit"
            className={skin('send')}
            disabled={!text.trim()}
            aria-label="Отправить сообщение"
          >
            <ArrowUpIcon size={23} weight="bold" />
          </button>
        )}
      </div>
      <div className={skin('composerFoot')}>
        {compact && thread.messages.length > 0 ? (
          <button type="button" className={styles.footNew} onClick={start}>
            <PlusIcon size={16} />
            Новый разговор
          </button>
        ) : (
          <span>{persisted ? '' : 'Историю не удалось сохранить: она пропадёт после закрытия страницы'}</span>
        )}
        <span>{text.length}/400</span>
      </div>
    </form>
  );

  return (
    <div
      className={[styles.page, compact ? styles.compact : fullStyles.fullPage].filter(Boolean).join(' ')}
      data-assistant-page={compact ? undefined : ''}
      data-chat-widget={compact ? '' : undefined}
      data-empty={!thread.messages.length ? '' : undefined}
    >
      {!compact && <h1 className="sr-only">Чат с помощником</h1>}
      <div className={skin('workspace')}>
        <aside className={skin('sidebar')} aria-label="Ваши разговоры">
          <Link to={returnTo} replace className={skin('backLink')}>
            <ArrowLeftIcon size={17} />
            Вернуться на сайт
          </Link>
          <div className={skin('sideBrand')}>
            <span>
              <AssistantGlyph size={22} />
            </span>
            <strong>{ASSISTANT_NAME}</strong>
          </div>
          <button className={skin('newChat')} onClick={start}>
            <PlusIcon size={20} />
            Новый разговор
          </button>
          <p className={skin('historyCaption')}>
            <ClockCounterClockwiseIcon size={15} /> История разговоров
          </p>
          <nav className={skin('history')}>
            {threads.map((t) => (
              <button
                key={t.id}
                aria-current={thread.id === t.id ? 'page' : undefined}
                onClick={() => chooseThread(t.id)}
              >
                <ChatCircleDotsIcon size={18} />
                <span>{t.title}</span>
              </button>
            ))}
          </nav>
          <div className={skin('sideFoot')}>
            <p>История сохранена в этом браузере</p>
            <button onClick={() => setConfirmClear(true)}>
              <TrashIcon size={16} />
              Очистить историю
            </button>
          </div>
        </aside>
        <section className={skin('chat')} aria-label="Чат с помощником">
          {!compact && (
            <header className={skin('chatHead')}>
              {
                <details ref={historyMenu} className={skin('mobileHistory')}>
                  <summary aria-label="История разговоров">
                    <ListIcon size={21} />
                  </summary>
                  <div>
                    <strong>История разговоров</strong>
                    <button onClick={start}>
                      <PlusIcon size={16} /> Новый разговор
                    </button>
                    {threads.map((t) => (
                      <button
                        key={t.id}
                        onClick={(e) => {
                          chooseThread(t.id);
                          e.currentTarget.closest('details')?.removeAttribute('open');
                        }}
                        aria-current={thread.id === t.id ? 'page' : undefined}
                      >
                        <ChatCircleDotsIcon size={16} />
                        <span>{t.title}</span>
                      </button>
                    ))}
                    <button onClick={() => setConfirmClear(true)}>
                      <TrashIcon size={16} />
                      Очистить историю
                    </button>
                  </div>
                </details>
              }
              <span className={skin('avatar')}>
                <AssistantGlyph size={29} />
              </span>
              <div className={fullStyles.headTitle}>
                <h2>{ASSISTANT_NAME}</h2>
              </div>
              <span className={skin('city')}>
                <MapPinIcon size={16} />
                {cityName}
              </span>
              <ChatWindowControls onLeave={onLeave} />
            </header>
          )}
          <div
            className={skin('conversation')}
            ref={conversation}
            tabIndex={0}
            role="region"
            aria-label="Переписка"
          >
            {!thread.messages.length ? (
              <div className={skin('welcome')} data-chat-welcome="">
                <p className={styles.welcomeText}>
                  Задайте вопрос о сайте или попросите найти встречу, оформить запись либо подготовить встречу
                  или объявление.
                </p>
                {!compact && composer}
                <p className={skin('examplesCaption')}>Можно начать с готового вопроса</p>
                <div className={skin('examples')}>
                  {EXAMPLES.map((example, index) => {
                    const Icon = EXAMPLE_ICONS[index]!;
                    return (
                      <button key={example.title} onClick={() => void send(example.text)}>
                        <span className={skin('exampleTop')}>
                          <span className={skin('exampleIcon')}>
                            <Icon size={20} />
                          </span>
                          <strong>{example.title}</strong>
                        </span>
                        <span className={skin('exampleDetail')}>«{example.text}»</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div
                className={skin('messages')}
                data-motion="off"
                role="log"
                aria-live="polite"
                aria-relevant="additions"
              >
                {thread.messages.map((message, index) => (
                  <article
                    key={message.id}
                    data-message={message.id}
                    data-chat-message=""
                    className={[
                      skin('message'),
                      message.role === 'user' ? skin('user') : skin('assistant'),
                    ].join(' ')}
                    aria-label={message.role === 'user' ? 'Вы' : ASSISTANT_NAME}
                  >
                    {message.role === 'assistant' && (
                      <span className={skin('messageMark')}>
                        <AssistantGlyph size={19} />
                        {ASSISTANT_NAME}
                      </span>
                    )}
                    <p className={skin('messageText')}>{message.answer.text}</p>
                    {message.answer.steps?.length ? (
                      <ol className={styles.steps}>
                        {message.answer.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    ) : null}
                    {message.answer.understood?.length ? (
                      <div className={skin('understood')} aria-label="Условия поиска">
                        {message.answer.understood.map((s) => (
                          <span key={s}>{s}</span>
                        ))}
                      </div>
                    ) : null}
                    {message.answer.cards?.map((card) => (
                      <div key={card.id} className={styles.cardWrap}>
                        <Link to={`/events/${card.id}`} className={skin('eventCard')}>
                          <span className={skin('cardMeta')}>
                            <span className={skin('cardSport')}>{card.sport}</span>
                            <b>{card.price}</b>
                          </span>
                          <strong>{card.title}</strong>
                          <span className={skin('cardAddress')}>
                            <CalendarBlankIcon size={15} />
                            {formatEventDate(card.startsAt)}
                          </span>
                          <span className={skin('cardAddress')}>
                            <MapPinIcon size={15} />
                            {card.address}
                          </span>
                          <small>{card.why.join('; ')}</small>
                        </Link>
                        <button
                          type="button"
                          className={styles.cardJoin}
                          disabled={busy}
                          onClick={() =>
                            void confirm(thread.id, null, {
                              type: 'join_event',
                              summary: `Записаться на «${card.title}»`,
                              params: { eventId: card.id },
                            })
                          }
                        >
                          Записаться
                        </button>
                      </div>
                    ))}
                    {message.answer.question && <p className={skin('question')}>{message.answer.question}</p>}
                    {message.answer.choices?.length ? (
                      <div className={skin('choices')}>
                        {message.answer.choices.map((option) => (
                          <button
                            key={option.id}
                            disabled={busy || index !== thread.messages.length - 1}
                            onClick={() => void send(option.label, option)}
                          >
                            {option.label}
                            {option.hint && <small>{option.hint}</small>}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {message.answer.say?.length ? (
                      <div className={skin('choices')}>
                        {message.answer.say.map((phrase) => (
                          <button
                            key={phrase}
                            disabled={busy || index !== thread.messages.length - 1}
                            onClick={() => void send(phrase)}
                          >
                            {phrase}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {message.answer.action && !message.answer.autoRun ? (
                      <ActionCard
                        action={message.answer.action}
                        busy={busy}
                        onConfirm={() => void confirm(thread.id, message.id, message.answer.action!)}
                        onCancel={() => cancelAction(thread.id, message.id)}
                        to={to}
                      />
                    ) : null}
                    {message.answer.links?.length ? (
                      <div className={skin('links')}>
                        {message.answer.links.map((link) => (
                          <Link key={link.to} to={to(link.to)}>
                            {link.label}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                    {message.retry && (
                      <button
                        className={skin('retry')}
                        disabled={busy}
                        onClick={() => void send(message.retry!)}
                      >
                        Повторить
                      </button>
                    )}
                  </article>
                ))}
                {busy && (
                  <p className={skin('thinking')} role="status">
                    <AssistantGlyph size={22} />
                    Думаю над ответом…
                  </p>
                )}
              </div>
            )}
          </div>
          {(compact || thread.messages.length > 0) && composer}
        </section>
      </div>
      <Modal
        title="Очистить историю чата?"
        open={confirmClear}
        onCancel={() => setConfirmClear(false)}
        okText="Очистить историю"
        cancelText="Оставить"
        onOk={() => {
          start();
          setThreads((old) => [old[0]!]);
          setConfirmClear(false);
        }}
      >
        Все разговоры в городе {cityName} удалятся с этого устройства. Вернуть их не получится.
      </Modal>
    </div>
  );
}

function ActionCard({
  action,
  busy,
  onConfirm,
  onCancel,
  to,
}: {
  action: AssistantAction;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  to: (url: string) => string;
}) {
  const rows = actionRows(action);
  const manual = manualLink(action);
  const done = action.status;
  return (
    <section className={styles.actionCard} aria-label="Действие помощника">
      <strong className={styles.actionTitle}>{action.summary}</strong>
      {rows.length > 0 && (
        <dl className={styles.actionRows}>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {done ? (
        <p className={styles.actionDone}>
          {done === 'done' ? 'Подтверждено' : done === 'cancelled' ? 'Отменено' : 'Не получилось'}
        </p>
      ) : (
        <div className={styles.actionButtons}>
          <button type="button" className={styles.actionOk} disabled={busy} onClick={onConfirm}>
            Подтвердить
          </button>
          <button type="button" className={styles.actionCancel} disabled={busy} onClick={onCancel}>
            Отмена
          </button>
          {manual && (
            <Link to={to(manual.to)} className={styles.actionManual}>
              {manual.label}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
