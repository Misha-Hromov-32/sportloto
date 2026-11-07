import {
  ArrowBendUpLeftIcon,
  ArrowRightIcon,
  CalendarCheckIcon,
  ChatCircleTextIcon,
  EyeSlashIcon,
  HandsClappingIcon,
  InfoIcon,
  LockIcon,
  ProhibitIcon,
  PushPinIcon,
  ThumbsUpIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useCreate, useDelete, useList } from '@refinedev/core';
import { App, Input, Modal } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import {
  Avatar,
  Button,
  ErrorState,
  MoreMenu,
  StopAddDialog,
  ownerMeetings,
  stopOwnerOf,
} from '@/components';
import { API, errorMessage, useAction, useMe } from '@/lib/api';
import { formatAgo } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import { truncate } from '@/lib/text';
import type { EventDetails, MessageView } from '@/types/api';
import type { ReactionKey } from '@/types/domain';

import styles from './Discussion.module.css';
import { ReportMessageButton } from './report/Report'; // С16

const REACTIONS: { key: ReactionKey; label: string; icon: ReactNode }[] = [
  { key: 'thanks', label: 'Спасибо', icon: <HandsClappingIcon size={16} aria-hidden /> },
  { key: 'agree', label: 'Полезно', icon: <ThumbsUpIcon size={16} aria-hidden /> },
  { key: 'going', label: 'Тоже иду', icon: <CalendarCheckIcon size={16} aria-hidden /> },
];

const authorName = (m: MessageView) => m.author?.orgName ?? m.author?.name ?? 'Участник';

/** Сообщения сгруппированы в ветки: вопрос, под ним ответы. */
function threads(list: MessageView[]) {
  const byId = new Map(list.map((m) => [m.id, m]));
  const rootOf = (m: MessageView): MessageView => {
    let cur = m;
    for (let i = 0; i < 20 && cur.replyTo && byId.has(cur.replyTo); i++) cur = byId.get(cur.replyTo)!;
    return cur;
  };
  const roots: MessageView[] = [];
  const replies = new Map<string, MessageView[]>();
  for (const m of list) {
    const root = rootOf(m);
    if (root.id === m.id) roots.push(m);
    else replies.set(root.id, [...(replies.get(root.id) ?? []), m]);
  }
  return { roots, replies, byId };
}

/** Обсуждение под событием: вопросы и ответы организатора, ответы с цитатой, реакции. */
export function Discussion({ event: e }: { event: EventDetails }) {
  const { me } = useMe();
  const [search, setSearch] = useSearchParams();
  const { message: toast } = App.useApp();
  const { result, query } = useList<MessageView>({
    resource: 'messages',
    filters: [
      { field: 'eventId', operator: 'eq', value: e.id },
      { field: 'invite', operator: 'eq', value: search.get('invite') },
    ],
    pagination: { mode: 'off' },
  });
  const messages = result.data ?? [];
  const pinned = messages.find((m) => m.pinnedAt && m.status === 'visible' && m.text);
  const { roots, replies, byId } = threads(messages);
  const visibleCount = messages.filter((m) => !m.system && m.text !== null).length;

  const { mutateAsync: create } = useCreate<MessageView>();
  const [sending, setSending] = useState(false);
  const { mutateAsync: remove } = useDelete();
  const { run } = useAction();
  const { modal } = App.useApp();

  const inputId = useId();
  const inputRef = useRef<TextAreaRef>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<MessageView | null>(null);
  const [sendError, setSendError] = useState('');
  const [hiding, setHiding] = useState<MessageView | null>(null);
  const [stopUserId, setStopUserId] = useState<string | null>(null);
  const stopOwner = stopOwnerOf(e.organizer);

  const open = e.state === 'upcoming' || e.state === 'live';
  const canModerate = e.isOrganizer || e.can.moderate;
  const canReact = Boolean(me) && open;

  const submit = async (ev?: FormEvent) => {
    ev?.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    setSendError('');
    setSending(true);
    try {
      await create({
        resource: 'messages',
        values: { eventId: e.id, text: value, replyTo: replyTo?.id ?? null },
        successNotification: false,
        errorNotification: false,
      });
      setText('');
      setReplyTo(null);
      toast.success(
        e.isOrganizer ? 'Ответ опубликован' : 'Вопрос отправлен. Организатор получит уведомление',
      );
    } catch (error) {
      setSendError(errorMessage(error, 'Сообщение не отправлено. Проверьте интернет'));
    } finally {
      setSending(false);
    }
  };

  const reply = (m: MessageView) => {
    setReplyTo(m);
    inputRef.current?.focus();
  };

  // «Ответить в карточке» из управления событием: сразу открываем ответ на нужное сообщение.
  const replyParam = search.get('reply');
  const target = replyParam ? byId.get(replyParam) : undefined;
  useEffect(() => {
    if (!replyParam || !target || !me || !open) return;
    setReplyTo(target);
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.resizableTextArea?.textArea.scrollIntoView({ block: 'center' });
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('reply');
        return next;
      },
      { replace: true },
    );
  }, [replyParam, target, me, open, setSearch]);

  const react = (m: MessageView, key: ReactionKey) =>
    void run(API.reactMessage(m.id), { key }).catch(() => undefined);

  const del = (m: MessageView) =>
    modal.confirm({
      title: 'Удалить ваше сообщение?',
      content: 'Вместо текста все увидят «Сообщение удалено автором». Вернуть его нельзя.',
      okText: 'Удалить сообщение',
      okButtonProps: { danger: true },
      cancelText: 'Оставить',
      onOk: async () => {
        await remove({ resource: 'messages', id: m.id, successNotification: false });
      },
    });

  const renderMessage = (m: MessageView, nested: boolean) => {
    const parent = m.replyTo ? byId.get(m.replyTo) : null;
    return (
      <Bubble
        key={m.id}
        message={m}
        quote={parent && (!nested || parent.replyTo) ? parent : null}
        nested={nested}
        canReact={canReact}
        onReact={react}
        onReply={me && open ? reply : undefined}
        onHide={canModerate && open ? setHiding : undefined}
        onDelete={m.mine && m.text !== null ? del : undefined}
        onPin={
          e.isOrganizer && open && m.mine && !m.system && m.status === 'visible'
            ? async (msg) => {
                try {
                  await run(
                    `/messages/${msg.id}/pin`,
                    {},
                    {
                      method: msg.pinnedAt ? 'delete' : 'put',
                      success: msg.pinnedAt ? 'Сообщение откреплено' : 'Сообщение закреплено',
                    },
                  );
                  await query.refetch();
                } catch {
                  /* Ошибка уже показана. */
                }
              }
            : undefined
        }
        stopLabel={e.isOrganizer ? `Не пускать на ${ownerMeetings(stopOwner)}` : undefined}
        onStop={e.isOrganizer ? (msg) => setStopUserId(msg.author?.id ?? null) : undefined}
      />
    );
  };

  return (
    <section className={styles.chat} id="discussion" aria-labelledby="discussion-title">
      <h2 id="discussion-title" className={styles.title}>
        Обсуждение
        {visibleCount > 0 && <span className={styles.count}>{visibleCount}</span>}
      </h2>

      {e.discussion === 'participants' && open && (
        <p className={styles.note}>
          <LockIcon size={18} aria-hidden />
          Писать могут участники и те, кто отправил заявку. Читать обсуждение может каждый.
        </p>
      )}
      {!open && (
        <p className={styles.note}>
          <LockIcon size={18} aria-hidden />
          {e.state === 'past'
            ? 'Событие прошло, обсуждение только для чтения.'
            : e.state === 'cancelled'
              ? 'Событие отменено, обсуждение только для чтения.'
              : 'Событие снято с публикации, обсуждение только для чтения.'}
        </p>
      )}

      {query.isLoading ? (
        <div className={styles.list} role="status">
          <span className="sr-only">Загружаем обсуждение…</span>
          <span className={styles.skeleton} />
          <span className={styles.skeleton} />
        </div>
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()}>Не удалось загрузить обсуждение.</ErrorState>
      ) : roots.length === 0 ? (
        <p className={styles.empty}>
          {!open
            ? 'В обсуждении не было сообщений.'
            : e.can.ask || !me
              ? 'Вопросов пока нет. Спросите первым: что взять, где встречаемся, можно ли с ребёнком. Организатор ответит здесь.'
              : 'Вопросов пока нет.'}
        </p>
      ) : (
        <>
          {pinned && (
            <aside className={styles.note} aria-label="Закреплённое сообщение">
              <PushPinIcon size={18} aria-hidden />
              <strong>Закреплено организатором</strong>
              <p>{pinned.text}</p>
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById(`message-${pinned.id}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              >
                К сообщению
              </button>
            </aside>
          )}
          <ol className={styles.list} aria-label={`Сообщения: ${count(visibleCount, WORDS.message)}`}>
            {roots.map((root) => (
              <li key={root.id} className={styles.thread}>
                {renderMessage(root, false)}
                {(replies.get(root.id) ?? []).length > 0 && (
                  <ol className={styles.replies}>
                    {(replies.get(root.id) ?? []).map((m) => (
                      <li key={m.id}>{renderMessage(m, true)}</li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {open && e.can.ask && (
        <form className={styles.form} onSubmit={(ev) => void submit(ev)}>
          {replyTo && (
            <p className={styles.replyTo}>
              <ArrowBendUpLeftIcon size={16} aria-hidden />
              <span>
                Ответ {authorName(replyTo)}: «{truncate(replyTo.text ?? '', 70)}»
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                aria-label="Не отвечать на это сообщение"
              >
                <XIcon size={16} weight="bold" aria-hidden />
              </button>
            </p>
          )}
          <div className={styles.inputRow}>
            <label htmlFor={inputId} className="sr-only">
              {e.isOrganizer ? 'Ваш ответ участникам' : 'Ваш вопрос организатору'}
            </label>
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 10 }}
              ref={inputRef}
              id={inputId}
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              placeholder={replyTo ? 'Ваш ответ…' : e.isOrganizer ? 'Написать участникам…' : 'Задать вопрос…'}
              maxLength={1000}
              autoComplete="off"
              aria-invalid={Boolean(sendError) || undefined}
            />
            <button
              type="submit"
              className={styles.send}
              disabled={sending || !text.trim()}
              aria-label={
                replyTo ? 'Отправить ответ' : e.isOrganizer ? 'Отправить сообщение' : 'Задать вопрос'
              }
            >
              <ArrowRightIcon size={22} weight="bold" aria-hidden />
            </button>
          </div>
          {sendError && (
            <p className={styles.error} role="alert">
              Не отправлено: {sendError}{' '}
              <button type="button" className={styles.retry} onClick={() => void submit()}>
                Повторить
              </button>
            </p>
          )}
        </form>
      )}

      {open && !e.can.ask && (
        <div className={styles.closed}>
          <ChatCircleTextIcon size={22} aria-hidden />
          {me ? (
            <p>{e.can.askReason}</p>
          ) : (
            <>
              <p>Войдите, чтобы задать вопрос организатору. Потом вернём вас сюда.</p>
              <Button
                variant="secondary"
                size="sm"
                to={`/login?to=${encodeURIComponent(`/events/${e.id}#discussion`)}`}
              >
                Войти и спросить
              </Button>
            </>
          )}
        </div>
      )}

      <HideDialog message={hiding} onClose={() => setHiding(null)} />
      <StopAddDialog
        open={Boolean(stopUserId)}
        owner={stopOwner}
        userId={stopUserId}
        onClose={() => setStopUserId(null)}
      />
    </section>
  );
}

function Bubble({
  message: m,
  quote,
  nested,
  canReact,
  onReact,
  onReply,
  onHide,
  onDelete,
  onPin,
  onStop,
  stopLabel,
}: {
  message: MessageView;
  quote: MessageView | null;
  nested: boolean;
  canReact: boolean;
  onReact: (m: MessageView, key: ReactionKey) => void;
  onReply?: (m: MessageView) => void;
  onHide?: (m: MessageView) => void;
  onDelete?: (m: MessageView) => void;
  onPin?: (m: MessageView) => void;
  /** D-16: организатор не пускает автора сообщения на свои встречи. */
  onStop?: (m: MessageView) => void;
  stopLabel?: string;
}) {
  if (m.system) {
    return (
      <div className={styles.system} role="note">
        <InfoIcon size={18} aria-hidden />
        <p>
          {m.text}
          <time dateTime={m.createdAt}> {formatAgo(m.createdAt)}</time>
        </p>
      </div>
    );
  }
  if (m.text === null) {
    return (
      <div className={styles.removed}>
        {m.status === 'deleted' ? (
          <TrashIcon size={18} aria-hidden />
        ) : (
          <EyeSlashIcon size={18} aria-hidden />
        )}
        <p>{m.status === 'deleted' ? 'Сообщение удалено автором' : 'Сообщение скрыто модератором'}</p>
      </div>
    );
  }
  const isOrg = Boolean(m.author?.isOrganizer);
  const name = authorName(m);
  return (
    <article
      id={`message-${m.id}`}
      className={[
        styles.msg,
        isOrg && styles.msgOrg,
        m.mine && !isOrg && styles.msgMine,
        nested && styles.msgNested,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className={styles.head}>
        <Avatar
          name={name}
          src={m.author?.orgLogoUrl ?? m.author?.avatarUrl}
          size={32}
          shape={m.author?.orgName ? 'org' : 'person'}
        />
        <b>{name}</b>
        {isOrg && <span className={styles.roleTag}>Организатор</span>}
        {m.mine && !isOrg && <span className={styles.meTag}>Вы</span>}
        {m.pinnedAt && m.status === 'visible' && (
          <span className={styles.roleTag}>
            <PushPinIcon size={14} aria-hidden /> Закреплено
          </span>
        )}
        <time dateTime={m.createdAt}>{formatAgo(m.createdAt)}</time>
      </header>
      {quote && (
        <p className={styles.quote}>
          <ArrowBendUpLeftIcon size={14} aria-hidden />
          <span>
            В ответ {authorName(quote)}: «{truncate(quote.text ?? 'сообщение скрыто', 80)}»
          </span>
        </p>
      )}
      <p className={styles.text}>{m.text}</p>
      {m.status === 'hidden' && <p className={styles.hiddenNote}>Скрыто модератором: {m.hiddenReason}</p>}
      <footer className={styles.actions}>
        {onPin && (
          <button type="button" className={styles.action} onClick={() => onPin(m)}>
            <PushPinIcon size={16} aria-hidden />
            {m.pinnedAt ? 'Открепить' : 'Закрепить'}
          </button>
        )}
        {REACTIONS.map((r) => {
          const n = m.reactions[r.key]?.length ?? 0;
          const on = m.myReactions.includes(r.key);
          if (!canReact && n === 0) return null;
          return (
            <button
              key={r.key}
              type="button"
              className={[styles.reaction, on && styles.reactionOn].filter(Boolean).join(' ')}
              aria-pressed={on}
              disabled={!canReact}
              onClick={() => onReact(m, r.key)}
              aria-label={`${r.label}${n ? `: ${n}` : ''}`}
              title={r.label}
            >
              {r.icon}
              <span className={styles.reactionLabel}>{r.label}</span>
              {n > 0 && <span className="tabular">{n}</span>}
            </button>
          );
        })}
        {onReply && (
          <button type="button" className={styles.action} onClick={() => onReply(m)}>
            <ArrowBendUpLeftIcon size={16} aria-hidden />
            Ответить
          </button>
        )}
        {onHide && !m.mine && m.status === 'visible' && (
          <button type="button" className={styles.action} onClick={() => onHide(m)}>
            <EyeSlashIcon size={16} aria-hidden />
            Скрыть
          </button>
        )}
        {onDelete && (
          <button type="button" className={styles.action} onClick={() => onDelete(m)}>
            <TrashIcon size={16} aria-hidden />
            Удалить
          </button>
        )}
        {/* С16: жалоба на сообщение */}
        <ReportMessageButton message={m} />
        {onStop && stopLabel && m.author && !m.author.isOrganizer && !m.mine && (
          <MoreMenu
            className={styles.action}
            label={`Действия: ${name}`}
            items={[
              { key: 'stop', label: stopLabel, icon: <ProhibitIcon size={18} aria-hidden />, danger: true },
            ]}
            onSelect={() => onStop(m)}
          />
        )}
      </footer>
    </article>
  );
}

/** Скрыть сообщение в своём событии: причина обязательна, её увидит автор. */
function HideDialog({ message, onClose }: { message: MessageView | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const { run, isPending } = useAction();
  const id = useId();
  const close = () => {
    setReason('');
    setError('');
    onClose();
  };
  const submit = async () => {
    if (reason.trim().length < 3) {
      setError('Напишите причину: её увидит автор сообщения');
      return;
    }
    try {
      await run(
        API.moderateMessage(message!.id),
        { action: 'hide', reason: reason.trim() },
        { success: 'Сообщение скрыто' },
      );
      close();
    } catch {
      /* текст ошибки показан */
    }
  };
  return (
    <Modal
      open={Boolean(message)}
      title="Скрыть сообщение"
      onCancel={close}
      onOk={() => void submit()}
      okText="Скрыть сообщение"
      cancelText="Не скрывать"
      okButtonProps={{ danger: true, loading: isPending }}
      destroyOnHidden
    >
      {message && <p className={styles.hideQuote}>«{truncate(message.text ?? '', 160)}»</p>}
      <label htmlFor={id} className={styles.hideLabel}>
        Причина
      </label>
      <Input.TextArea
        id={id}
        value={reason}
        onChange={(ev) => {
          setReason(ev.target.value);
          setError('');
        }}
        autoSize={{ minRows: 2, maxRows: 5 }}
        placeholder="Например: реклама, не относится к событию"
        status={error ? 'error' : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} className={styles.error}>
          {error}
        </p>
      )}
      <p className={styles.hideHint}>
        Вместо текста все увидят «Сообщение скрыто модератором». Автор получит уведомление с причиной.
      </p>
      <Link to="/rules" className={styles.hideRules}>
        Правила платформы
      </Link>
    </Modal>
  );
}
