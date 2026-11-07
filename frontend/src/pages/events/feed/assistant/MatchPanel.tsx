import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  MapPinIcon,
  SparkleIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { AssistantThinking, Button, SportIcon } from '@/components';
import { API, assistantFallbackQuery, errorMessage, useAction, useMe, type ApiError } from '@/lib/api';
import { JOIN_MODE } from '@/lib/labels';
import { selectedCityId } from '@/lib/cities';
import { capitalize } from '@/lib/text';
import type { MatchFilters, MatchItem, MatchOption, MatchResult } from '@/types/api';

import { Spots } from '../FeedCard';
import { whenShort } from '../filters';
import styles from './MatchPanel.module.css';

interface Step {
  id: string;
  label: string;
  patch: MatchOption['patch'];
}

interface MatchPanelProps {
  phrase: string;
  onClose: () => void;
  /** «Показать все в ленте»: фильтры подбора переходят в обычную ленту. */
  onShowAll: (filters: MatchFilters) => void;
}

/**
 * В2. Короткий диалог подбора под строкой поиска: помощник отвечает реальными событиями
 * с объяснением, уточняет кнопками и предлагает расширить условия. «Записаться» ведёт
 * в обычную запись карточки с тем же подтверждением.
 */
export function MatchPanel({ phrase, onClose, onShowAll }: MatchPanelProps) {
  const { run } = useAction<MatchResult>();
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ down: boolean; text: string } | null>(null);
  const request = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    async (nextSteps: Step[]) => {
      const n = ++request.current;
      setLoading(true);
      setFailure(null);
      try {
        const res = await run(
          API.assistantMatch,
          {
            text: phrase,
            steps: nextSteps.map(({ id, patch }) => ({ id, patch })),
            cityId: selectedCityId(),
          },
          { silent: true },
        );
        if (n !== request.current) return;
        setResult(res);
        setSteps(nextSteps);
      } catch (error) {
        if (n !== request.current) return;
        const down =
          (error as ApiError)?.code === 'assistant_unavailable' || Boolean(assistantFallbackQuery(error));
        setFailure({ down, text: errorMessage(error, 'Не получилось подобрать. Попробуйте ещё раз') });
      } finally {
        if (n === request.current) setLoading(false);
      }
    },
    [phrase, run],
  );

  useEffect(() => {
    void load([]);
  }, [load]);

  const choose = (option: MatchOption) => {
    void load([...steps, { id: option.id, label: option.label, patch: option.patch }]);
    headingRef.current?.focus();
  };

  return (
    <section className={styles.panel} aria-labelledby="match-title" aria-busy={loading}>
      <header className={styles.head}>
        <h2 id="match-title" ref={headingRef} tabIndex={-1} className={styles.title}>
          <SparkleIcon size={20} weight="fill" aria-hidden className={styles.spark} />
          Подбирает помощник
        </h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Скрыть подбор">
          <XIcon size={20} weight="bold" aria-hidden />
        </button>
      </header>

      <p className={styles.asked}>
        <span className="sr-only">Ваш запрос: </span>«{phrase}»
        {steps.length > 0 && (
          <span className={styles.trail}>
            {steps.map((s) => (
              <span key={s.id} className={styles.trailItem}>
                <CheckIcon size={14} weight="bold" aria-hidden />
                {s.label}
              </span>
            ))}
          </span>
        )}
      </p>

      {loading && !result ? (
        <AssistantThinking text="Подбираю события по вашей фразе…" />
      ) : failure ? (
        <Failure failure={failure} onRetry={() => void load(steps)} onClose={onClose} />
      ) : result ? (
        <Answer
          result={result}
          loading={loading}
          canUndo={steps.length > 0}
          onChoose={choose}
          onUndo={() => void load([])}
          onShowAll={() => onShowAll(result.filters)}
        />
      ) : null}
    </section>
  );
}

function Failure({
  failure,
  onRetry,
  onClose,
}: {
  failure: { down: boolean; text: string };
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.failure} role="alert">
      <WarningCircleIcon size={22} aria-hidden className={styles.failureIcon} />
      <div className={styles.failureBody}>
        <p className={styles.failureTitle}>
          {failure.down ? 'Помощник сейчас не отвечает' : 'Не получилось подобрать'}
        </p>
        <p>
          {failure.down
            ? 'Показываем результаты поиска по словам из вашего запроса. Фильтры доступны. Подбор с помощником можно повторить позже.'
            : failure.text}
        </p>
        <div className={styles.row}>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Повторить подбор
          </Button>
          <Button variant="quiet" size="sm" onClick={onClose}>
            Скрыть
          </Button>
        </div>
      </div>
    </div>
  );
}

function Answer({
  result,
  loading,
  canUndo,
  onChoose,
  onUndo,
  onShowAll,
}: {
  result: MatchResult;
  loading: boolean;
  canUndo: boolean;
  onChoose: (option: MatchOption) => void;
  onUndo: () => void;
  onShowAll: () => void;
}) {
  const question = result.questions[0];
  return (
    <div className={[styles.answer, loading && styles.answerBusy].filter(Boolean).join(' ')}>
      {result.understood.length > 0 && (
        <p className={styles.understood}>
          <span className={styles.understoodLabel}>Понял так:</span> {result.understood.join(', ')}
        </p>
      )}
      <p className={styles.reply} role="status" aria-live="polite">
        {loading ? 'Подбираю заново…' : result.reply}
      </p>

      {result.items.length > 0 && (
        <ul className={styles.items}>
          {result.items.map((item, i) => (
            <li key={item.event.id}>
              <MatchCard item={item} main={i === 0} />
            </li>
          ))}
        </ul>
      )}

      {question && (
        <fieldset className={styles.choice}>
          <legend className={styles.choiceTitle}>{question.question}</legend>
          <div className={styles.options}>
            {question.options.map((o) => (
              <OptionButton key={o.id} option={o} onChoose={onChoose} disabled={loading} />
            ))}
          </div>
        </fieldset>
      )}

      {result.widen.length > 0 && (
        <fieldset className={styles.choice}>
          <legend className={styles.choiceTitle}>Можно поискать шире</legend>
          <div className={styles.options}>
            {result.widen.map((o) => (
              <OptionButton key={o.id} option={o} onChoose={onChoose} disabled={loading} />
            ))}
          </div>
        </fieldset>
      )}

      {result.companion && <CompanionOffer companion={result.companion} strong={result.total === 0} />}

      <div className={styles.foot}>
        <span className={styles.footNote}>
          <SparkleIcon size={16} weight="fill" aria-hidden />
          Подобрал помощник. Записываетесь вы сами, условия смотрите в карточке.
        </span>
        <span className={styles.row}>
          {canUndo && (
            <Button
              variant="quiet"
              size="sm"
              onClick={onUndo}
              disabled={loading}
              icon={<ArrowCounterClockwiseIcon size={18} aria-hidden />}
            >
              Вернуть мой запрос
            </Button>
          )}
          {result.total > result.items.length && (
            <Button variant="quiet" size="sm" onClick={onShowAll} disabled={loading}>
              Показать все {result.total} в ленте
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}

function OptionButton({
  option,
  onChoose,
  disabled,
}: {
  option: MatchOption;
  onChoose: (o: MatchOption) => void;
  disabled: boolean;
}) {
  return (
    <button type="button" className={styles.option} onClick={() => onChoose(option)} disabled={disabled}>
      <span className={styles.optionLabel}>{option.label}</span>
      {option.hint && <span className={styles.optionHint}>{option.hint}</span>}
    </button>
  );
}

function MatchCard({ item, main }: { item: MatchItem; main: boolean }) {
  const { event: e, why } = item;
  const { me } = useMe();
  const navigate = useNavigate();
  const full = e.capacity !== null && e.counts.spotsLeft === 0;
  const action = full ? 'Встать в лист ожидания' : JOIN_MODE[e.joinMode].action;
  const join = () => {
    const to = `/events/${e.id}?intent=join`;
    navigate(me ? to : `/login?to=${encodeURIComponent(to)}`);
  };
  return (
    <article className={styles.card} aria-labelledby={`match-${e.id}`}>
      <div className={styles.cardMain}>
        <p className={styles.when}>{whenShort(e.startsAt)}</p>
        <h3 id={`match-${e.id}`} className={styles.cardTitle}>
          {e.title}
        </h3>
        <p className={styles.place}>
          <MapPinIcon size={16} aria-hidden />
          <span>
            {e.place.address}
            {e.districtName && `, ${e.districtName}`}
          </span>
        </p>
        <p className={styles.meta}>
          <span className={styles.sport}>
            <SportIcon sport={e.sport} size={16} />
            {e.sport.name}
          </span>
          <span className={e.joinMode === 'open' ? styles.modeOpen : styles.modeWait}>
            {JOIN_MODE[e.joinMode].label}
          </span>
        </p>
        <Spots counts={e.counts} capacity={e.capacity} minParticipants={e.minParticipants} />
      </div>
      {why.length > 0 && (
        <div className={styles.why}>
          <p className={styles.whyTitle}>Почему подходит</p>
          <ul className={styles.whyList}>
            {why.map((w) => (
              <li key={w}>
                <CheckIcon size={16} weight="bold" aria-hidden />
                {capitalize(w)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.cardActions}>
        <Button variant={main ? 'primary' : 'secondary'} onClick={join}>
          {action}
        </Button>
        <Button variant="quiet" to={`/events/${e.id}`}>
          Открыть событие
        </Button>
      </div>
    </article>
  );
}

function CompanionOffer({
  companion,
  strong,
}: {
  companion: NonNullable<MatchResult['companion']>;
  strong: boolean;
}) {
  const { me } = useMe();
  const navigate = useNavigate();
  const open = () => {
    if (!me) {
      navigate(`/login?to=${encodeURIComponent('/companions/new')}`);
      return;
    }
    navigate('/companions/new', { state: { prefill: companion } });
  };
  return (
    <div className={[styles.companion, strong && styles.companionStrong].filter(Boolean).join(' ')}>
      <UsersThreeIcon size={24} aria-hidden className={styles.companionIcon} />
      <div className={styles.companionBody}>
        <p className={styles.companionTitle}>{strong ? 'Найдите компанию' : 'Не то, что нужно?'}</p>
        <p>
          Помощник заполнит объявление «Ищу компанию»
          {companion.sportName
            ? `: ${companion.sportName.toLowerCase()}, ${companion.when.toLowerCase()}`
            : ''}
          . Вы проверите его перед публикацией. Клубы видят спрос и могут предложить встречу.
        </p>
      </div>
      <Button variant={strong ? 'primary' : 'secondary'} size="sm" onClick={open}>
        Ищу компанию
      </Button>
    </div>
  );
}
