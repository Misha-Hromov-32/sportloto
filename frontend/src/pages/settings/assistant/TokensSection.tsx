import { CheckCircle, Copy, Key, Plus, Terminal } from '@phosphor-icons/react';
import { App, Input, Popconfirm } from 'antd';
import { useId, useState } from 'react';

import { Button, EmptyState, ErrorState, Section, SkeletonBlock, StatusBadge } from '@/components';
import { errorMessage, useAction, type ApiError } from '@/lib/api';
import { dayjs, formatAgo } from '@/lib/dates';
import type { McpCatalog, McpIssued, McpScope, McpTokenInput, McpTokenView } from '@/types/mcp';

import { ChoiceChips, Field, FieldGroup } from '../../events/create/fields';
import { MCP_API, useMcpTokens } from './api';
import styles from './assistant.module.css';
import { copyText } from './helpers';
import { EXPIRY_LABEL, TOKEN_STATUS } from './labels';

const fullDate = (iso: string) => dayjs(iso).format('D MMMM YYYY');

function IssueForm({
  catalog,
  onIssued,
  onCancel,
}: {
  catalog: McpCatalog;
  onIssued: (issued: McpIssued) => void;
  onCancel: () => void;
}) {
  const nameId = useId();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<McpScope[]>(['read']);
  const [days, setDays] = useState(90);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, isPending } = useAction();
  const { message } = App.useApp();

  const toggle = (scope: McpScope) =>
    setScopes((s) => (s.includes(scope) ? s.filter((x) => x !== scope) : [...s, scope]));

  const submit = async () => {
    if (!name.trim()) {
      setErrors({ name: 'Назовите токен, например «Ассистент на телефоне»' });
      return;
    }
    try {
      const input: McpTokenInput = { name, scopes, expiresInDays: days };
      const issued = (await run(MCP_API.tokens, { ...input }, { silent: true })) as unknown as McpIssued;
      onIssued(issued);
    } catch (error) {
      const fields = (error as ApiError).errors as Record<string, string> | undefined;
      if (fields && Object.keys(fields).length) setErrors(fields);
      else message.error(errorMessage(error));
    }
  };

  return (
    <form
      className={styles.issueForm}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Название" htmlFor={nameId} hint="Чтобы потом понять, где этот токен используется." error={errors.name}>
        <Input
          id={nameId}
          size="large"
          maxLength={60}
          placeholder="Например, ассистент на телефоне"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors({});
          }}
        />
      </Field>
      <FieldGroup legend="Что можно ассистенту" error={errors.scopes}>
        <div className={styles.scopes}>
          {catalog.scopes.map((s) => {
            const locked = s.value === 'read';
            const on = scopes.includes(s.value);
            return (
              <label
                key={s.value}
                className={[styles.scope, on && styles.scopeOn, locked && styles.scopeLocked].filter(Boolean).join(' ')}
              >
                <input type="checkbox" checked={on} disabled={locked} onChange={() => toggle(s.value)} />
                <span className={styles.scopeText}>
                  <span className={styles.scopeTitle}>{s.label}</span>
                  <span className={styles.muted}>{s.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </FieldGroup>
      <FieldGroup legend="Срок действия" hint="Когда срок закончится, ассистент потеряет доступ. Отозвать токен можно в любой момент." error={errors.expiresInDays}>
        <ChoiceChips
          label="Срок действия"
          value={days}
          onChange={setDays}
          options={catalog.expiryDays.map((d) => ({ value: d, label: EXPIRY_LABEL[d] ?? `${d} дней` }))}
        />
      </FieldGroup>
      <div className={styles.row}>
        <Button type="submit" variant="primary" icon={<Key size={20} aria-hidden />} loading={isPending} loadingText="Выпускаем…">
          Выпустить токен
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

function IssuedSecret({
  issued,
  onUse,
  onHide,
}: {
  issued: McpIssued;
  onUse: () => void;
  onHide: () => void;
}) {
  const { message } = App.useApp();
  return (
    <div className={styles.secret} role="status">
      <p className={styles.secretTitle}>
        <CheckCircle size={22} weight="bold" aria-hidden />
        Токен «{issued.token.name}» выпущен
      </p>
      <p>Скопируйте его сейчас и вставьте в настройки ассистента. Когда вы уйдёте со страницы, посмотреть токен снова будет нельзя.</p>
      <p className={styles.secretValue}>{issued.secret}</p>
      <div className={styles.row}>
        <Button
          variant="primary"
          icon={<Copy size={20} aria-hidden />}
          onClick={async () =>
            (await copyText(issued.secret))
              ? message.success('Токен скопирован')
              : message.error('Не получилось скопировать. Выделите токен и скопируйте вручную')
          }
        >
          Скопировать токен
        </Button>
        <Button icon={<Terminal size={20} aria-hidden />} onClick={onUse}>
          Проверить в консоли
        </Button>
        <Button variant="quiet" onClick={onHide}>
          Скрыть токен
        </Button>
      </div>
    </div>
  );
}

function TokenCard({ token, catalog }: { token: McpTokenView; catalog: McpCatalog }) {
  const { run, isPending } = useAction();
  const off = token.status !== 'active';
  const can = catalog.scopes.filter((s) => token.scopes.includes(s.value)).map((s) => s.label.toLowerCase());
  return (
    <li className={[styles.token, off && styles.tokenOff].filter(Boolean).join(' ')}>
      <div className={styles.tokenHead}>
        <span className={styles.tokenName}>{token.name}</span>
        <StatusBadge kind="custom" meta={TOKEN_STATUS[token.status]} />
      </div>
      <dl className={styles.facts}>
        <dt>Может</dt>
        <dd>{can.join(', ')}</dd>
        <dt>Токен</dt>
        <dd>
          <span className={styles.inlineCode}>stp_…{token.last4}</span>
        </dd>
        <dt>Выпущен</dt>
        <dd>{fullDate(token.createdAt)}</dd>
        {token.status === 'revoked' && token.revokedAt ? (
          <>
            <dt>Отозван</dt>
            <dd>{formatAgo(token.revokedAt)}</dd>
          </>
        ) : (
          token.expiresAt && (
            <>
              <dt>{token.status === 'expired' ? 'Закончился' : 'Действует до'}</dt>
              <dd>{fullDate(token.expiresAt)}</dd>
            </>
          )
        )}
        <dt>Последний вызов</dt>
        <dd>{token.lastUsedAt ? formatAgo(token.lastUsedAt) : 'ещё не было'}</dd>
      </dl>
      {token.status === 'active' && (
        <div className={styles.tokenFoot}>
          <Popconfirm
            title={`Отозвать токен «${token.name}»?`}
            description="Ассистент, который им пользуется, сразу потеряет доступ. Вернуть токен нельзя, можно выпустить новый."
            okText="Отозвать"
            cancelText="Оставить"
            okButtonProps={{ danger: true }}
            onConfirm={() => run(MCP_API.revoke(token.id), {}, { success: 'Токен отозван' }).catch(() => undefined)}
          >
            <Button variant="secondary" loading={isPending} loadingText="Отзываем…">
              Отозвать
            </Button>
          </Popconfirm>
        </div>
      )}
    </li>
  );
}

export function TokensSection({
  catalog,
  onUseInConsole,
}: {
  catalog: McpCatalog;
  onUseInConsole: (secret: string) => void;
}) {
  const { data: tokens, isLoading, isError, refetch } = useMcpTokens();
  const [formOpen, setFormOpen] = useState(false);
  const [issued, setIssued] = useState<McpIssued | null>(null);
  const active = tokens?.filter((t) => t.status === 'active').length ?? 0;
  const atLimit = active >= catalog.limits.activeTokens;

  const openForm = (
    <Button variant="primary" icon={<Plus size={20} aria-hidden />} onClick={() => setFormOpen(true)} disabled={atLimit}>
      Выпустить токен
    </Button>
  );

  return (
    <Section title="Токены доступа" actions={!formOpen && tokens?.length ? openForm : undefined}>
      <div className={styles.stack}>
        <p className={styles.lead}>
          Токен — это ключ, по которому ассистент действует от вашего имени. Выдавайте только те права, которые нужны, и отзывайте токен, если перестали им пользоваться.
        </p>
        {atLimit && (
          <p className={styles.muted}>
            Действующих токенов уже {catalog.limits.activeTokens}. Отзовите ненужный, чтобы выпустить новый.
          </p>
        )}
        {issued && (
          <IssuedSecret
            issued={issued}
            onUse={() => onUseInConsole(issued.secret)}
            onHide={() => setIssued(null)}
          />
        )}
        {formOpen && (
          <IssueForm
            catalog={catalog}
            onCancel={() => setFormOpen(false)}
            onIssued={(res) => {
              setIssued(res);
              setFormOpen(false);
            }}
          />
        )}
        {isLoading ? (
          <div className={styles.tokens} aria-busy="true" aria-label="Загружаем токены">
            <SkeletonBlock height={190} />
            <SkeletonBlock height={190} />
          </div>
        ) : isError ? (
          <ErrorState title="Не удалось загрузить токены" onRetry={() => void refetch()} />
        ) : !tokens?.length ? (
          !formOpen && (
            <EmptyState
              title="Токенов пока нет"
              icon={<Key size={28} aria-hidden />}
              actions={openForm}
            >
              Выпустите токен, чтобы подключить ассистента. Начать можно с права только смотреть.
            </EmptyState>
          )
        ) : (
          <ul className={styles.tokens}>
            {tokens.map((t) => (
              <TokenCard key={t.id} token={t} catalog={catalog} />
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
