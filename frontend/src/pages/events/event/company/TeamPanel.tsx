import { Input, Modal, Select, Spin } from 'antd';
import { useState } from 'react';
import { Button, ErrorState } from '@/components';
import { count, WORDS } from '@/lib/plural';
import { API, useAction, useLiveGet, useMe } from '@/lib/api';
import { formatEventDate } from '@/lib/dates';
import type { EventDetails, PersonSuggestion, TeamState, TeamView } from '@/types/api';
import styles from './Company.module.css';

const STATUS = {
  invited: 'Ждём ответа',
  agreed: 'Согласился, ждём организатора',
  joined: 'Идёт',
  declined: 'Отказался',
  expired: 'Резерв истёк',
};

function TeamMembers({ team }: { team: TeamView }) {
  return (
    <div className={styles.stack}>
      <p>
        Записал: {team.captain.name}.{' '}
        {team.status === 'closed' ? 'Сбор команды завершён.' : `Ответить до ${formatEventDate(team.until)}.`}
      </p>
      {team.needsApproval && !team.accepted && team.status === 'active' && (
        <p className={styles.note}>
          Команда ждёт решения организатора. Друзья уже могут подтвердить участие.
        </p>
      )}
      <ul className={styles.list}>
        {team.members.map((m) => (
          <li key={m.user.id}>
            <span>{m.user.name}</span>
            <small>{STATUS[m.status]}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TeamPanel({ event: e }: { event: EventDetails }) {
  const { me } = useMe();
  const enabled = Boolean(me && !e.isOrganizer && e.state === 'upcoming');
  const state = useLiveGet<TeamState>(API.team(e.id), ['events', 'participations', 'teams', 'demo'], enabled);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<PersonSuggestion[]>([]);
  const people = useLiveGet<PersonSuggestion[]>(
    `${API.suggestPeople}?q=${encodeURIComponent(search)}`,
    [],
    enabled && open && search.trim().length >= 2,
  );
  const { run, isPending } = useAction();
  if (!enabled) return null;
  if (state.isLoading)
    return (
      <section className={styles.panel}>
        <Spin aria-label="Загружаем запись компанией" />
      </section>
    );
  if (state.isError)
    return (
      <section className={styles.panel}>
        <ErrorState title="Не удалось загрузить команды" onRetry={() => void state.refetch()} />
      </section>
    );
  const data = state.data;
  if (!data || (!data.mine && !data.invitation && !data.maxFriends)) return null;
  const team = data.mine ?? data.invitation;
  const pending =
    data.invitation &&
    ['invited', 'agreed'].includes(data.invitation.myStatus) &&
    data.invitation.status === 'active';
  const create = async () => {
    try {
      await run(
        API.team(e.id),
        { userIds: ids, note },
        { success: 'Команда записана. Друзья получат приглашения подтвердить места' },
      );
      setOpen(false);
      setIds([]);
      setPicked([]);
      setNote('');
    } catch {
      /* сообщение API */
    }
  };
  const respond = async (accept: boolean) => {
    try {
      await run(
        accept ? API.confirmTeamPlace(e.id) : API.declineTeamPlace(e.id),
        {},
        { success: accept ? 'Ответ сохранён' : 'Вы отказались от места в команде' },
      );
    } catch {
      /* сообщение API */
    }
  };
  return (
    <section id="team" className={styles.panel} aria-label="Запись компанией">
      <h2>Идём компанией</h2>
      {team ? (
        <TeamMembers team={team} />
      ) : (
        <p>
          Выберите друзей на сайте. Каждому придёт приглашение. Места будут зарезервированы до ответа, но не
          больше чем на сутки.
        </p>
      )}
      {pending && (
        <div className={styles.actions}>
          {data.invitation?.myStatus === 'invited' && (
            <Button variant="primary" loading={isPending} onClick={() => void respond(true)}>
              Я иду с командой
            </Button>
          )}
          <Button variant="quiet" disabled={isPending} onClick={() => void respond(false)}>
            Отказаться от места
          </Button>
        </div>
      )}
      {!team && data.maxFriends > 0 && (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Записать нас
        </Button>
      )}
      <Modal
        title="Кто пойдёт с вами"
        open={open}
        onCancel={() => setOpen(false)}
        footer={
          <Button variant="primary" disabled={!ids.length} loading={isPending} onClick={() => void create()}>
            Записать {count(ids.length + 1, WORDS.person)}
          </Button>
        }
      >
        <div className={styles.stack}>
          <p>
            Вы участвуете вместе с друзьями. Можно добавить до {data.maxFriends} человек. Если нужна заявка,
            организатор рассматривает команду целиком.
          </p>
          <label>
            Друзья на платформе
            <Select
              style={{ width: '100%' }}
              mode="multiple"
              aria-label="Друзья на платформе"
              placeholder="Начните вводить имя или почту"
              value={ids}
              searchValue={search}
              onSearch={setSearch}
              filterOption={false}
              loading={people.isLoading}
              maxCount={data.maxFriends}
              options={[
                ...new Map(
                  [...picked, ...(people.data ?? [])]
                    .filter((p) => p.id !== me?.id)
                    .map((p) => [p.id, { value: p.id, label: `${p.name} · ${p.hint}` }]),
                ).values(),
              ]}
              onChange={(next: string[]) => {
                setIds(next);
                setPicked((old) => [
                  ...new Map(
                    [...old, ...(people.data ?? [])].filter((p) => next.includes(p.id)).map((p) => [p.id, p]),
                  ).values(),
                ]);
              }}
              notFoundContent={
                people.isLoading ? (
                  <Spin size="small" />
                ) : search.length < 2 ? (
                  'Введите хотя бы 2 буквы'
                ) : (
                  'Никого не нашли'
                )
              }
            />
          </label>
          {people.isError && (
            <ErrorState title="Поиск людей не ответил" onRetry={() => void people.refetch()} />
          )}
          {e.joinMode === 'approval' && (
            <label>
              Пару слов о команде
              <Input.TextArea
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
                maxLength={500}
                rows={3}
              />
            </label>
          )}
          <p className={styles.note}>Друзья сами подтвердят участие. Их контактные данные не раскрываются.</p>
        </div>
      </Modal>
    </section>
  );
}

export function OrganizerTeams({ event: e }: { event: EventDetails }) {
  const { data, isError, refetch } = useLiveGet<TeamView[]>(
    API.teams(e.id),
    ['events', 'participations', 'teams', 'demo'],
    e.isOrganizer,
  );
  if (!e.isOrganizer) return null;
  if (isError) return <ErrorState title="Не удалось загрузить команды" onRetry={() => void refetch()} />;
  if (!data?.length) return null;
  return (
    <section className={styles.panel}>
      <h2>Команды участников</h2>
      {data.map((t) => (
        <TeamMembers key={t.id} team={t} />
      ))}
    </section>
  );
}
