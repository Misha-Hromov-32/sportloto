import { HandWavingIcon, MedalMilitaryIcon, PlantIcon } from '@phosphor-icons/react';
import { useId, useState } from 'react';

import { Button } from '@/components';
import { API, useAction, useLiveGet, useMe } from '@/lib/api';
import type { EventView, GreeterView } from '@/types/api';

import styles from './greeter.module.css';

function useGreeter(eventId: string) {
  return useLiveGet<GreeterView>(API.greeter(eventId), ['events', 'participations']);
}

/** С1, Н2 в карточке события: кто встречает новичков и что даёт программа. Видно всем, без примет. */
export function NewcomerNote({ event: e }: { event: EventView }) {
  const { data } = useGreeter(e.id);
  const program = e.program ?? null;
  if (!data?.greeter && !program) return null;
  return (
    <section className={styles.welcome} aria-labelledby={`welcome-${e.id}`}>
      <h2 id={`welcome-${e.id}`} className={styles.welcomeTitle}>
        <HandWavingIcon size={22} aria-hidden />
        Впервые? Вас встретят
      </h2>
      {program && (
        <p className={styles.programTag}>
          <MedalMilitaryIcon size={18} aria-hidden />
          {program.label}
        </p>
      )}
      {data?.greeter ? (
        <p>
          Новичков встречает {data.mentor ? 'наставник ' : ''}
          {data.greeter.name}
          {data.greeter.isOrganizer ? ', организатор' : ''}. Отметьте «Я здесь впервые», когда будете
          записываться: он будет знать, кого ждать, а вам придёт памятка, как найти группу.
        </p>
      ) : (
        <p>Отметьте «Я здесь впервые» при записи: организатор будет знать, что вы придёте в первый раз.</p>
      )}
      {program && (
        <p>
          В первый раз вас встретит наставник и всё покажет.
          {program.withCompanion ? ' Можно прийти с близким человеком.' : ''}
        </p>
      )}
    </section>
  );
}

/** «Я здесь впервые» при записи. Галочка уходит вместе с записью, отдельного шага нет. */
export function FirstVisitCheck({
  event: e,
  checked,
  onChange,
  withCompanion,
  onCompanion,
}: {
  event: EventView;
  checked: boolean;
  onChange: (v: boolean) => void;
  withCompanion: boolean;
  onCompanion: (v: boolean) => void;
}) {
  const { me } = useMe();
  const id = useId();
  if (!me || e.isOrganizer || !e.can.join) return null;
  return (
    <div className={styles.firstCheck}>
      <label className={styles.check} htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(ev) => onChange(ev.target.checked)} />
        <span className={styles.checkText}>
          <strong>Я здесь впервые</strong>
          <span className={styles.muted}>Организатор узнает, а вам придёт памятка, как найти группу.</span>
        </span>
      </label>
      {checked && e.program?.withCompanion && (
        <label className={styles.check} htmlFor={`${id}-c`}>
          <input
            id={`${id}-c`}
            type="checkbox"
            checked={withCompanion}
            onChange={(ev) => onCompanion(ev.target.checked)}
          />
          <span>Приду с близким человеком</span>
        </label>
      )}
    </div>
  );
}

/** Памятка новичку и список новичков для встречающего — внутри «Что дальше». */
export function FirstVisitMemo({ event: e }: { event: EventView }) {
  const { data } = useGreeter(e.id);
  const { run, isPending } = useAction<GreeterView>();
  const [withCompanion, setWithCompanion] = useState(false);
  const companionId = useId();
  if (!data) return null;

  const mark = (on: boolean) =>
    run(API.firstVisit(e.id), on ? { withCompanion } : {}, {
      method: on ? 'put' : 'delete',
      success: on ? 'Отметили: вы здесь впервые' : 'Отметка снята',
    }).catch(() => undefined);

  return (
    <>
      {data.isGreeter && (
        <div className={styles.memo}>
          <p className={styles.memoTitle}>
            <HandWavingIcon size={20} aria-hidden />
            Вы встречаете новичков
          </p>
          <p>Где вас ждут: {data.note}</p>
          <p>
            {data.newcomers?.length
              ? `Придут впервые: ${data.newcomers.map((n) => `${n.name}${n.withCompanion ? ' (с близким)' : ''}`).join(', ')}.`
              : 'Новичков пока нет. Если кто-то отметит «Я здесь впервые», придёт уведомление.'}
          </p>
        </div>
      )}

      {data.memo ? (
        <div className={styles.memo}>
          <p className={styles.memoTitle}>
            <PlantIcon size={20} aria-hidden />
            Памятка для первого раза
          </p>
          <dl>
            <div>
              <dt>Как найти группу</dt>
              <dd>{data.memo.find}</dd>
            </div>
            <div>
              <dt>Кто встретит</dt>
              <dd>{data.memo.who}</dd>
            </div>
            <div>
              <dt>Чего ожидать</dt>
              <dd>{data.memo.expect}</dd>
            </div>
          </dl>
          <Button variant="quiet" size="sm" loading={isPending} onClick={() => void mark(false)}>
            Я здесь уже бывал
          </Button>
        </div>
      ) : (
        data.canMark &&
        !data.my?.firstVisit &&
        !data.isGreeter && (
          <div className={styles.firstCheck}>
            <p className={styles.label}>Впервые на этой встрече?</p>
            <p className={styles.muted}>
              {data.greeter
                ? 'Вас встретят. Отметьте, и вы получите памятку: где ждать и кто подойдёт.'
                : 'Отметьте, и организатор будет знать, что вы придёте в первый раз.'}
            </p>
            {data.withCompanionAllowed && (
              <label className={styles.check} htmlFor={companionId}>
                <input
                  id={companionId}
                  type="checkbox"
                  checked={withCompanion}
                  onChange={(ev) => setWithCompanion(ev.target.checked)}
                />
                <span>Приду с близким человеком</span>
              </label>
            )}
            <Button variant="secondary" size="sm" loading={isPending} onClick={() => void mark(true)}>
              Я здесь впервые
            </Button>
          </div>
        )
      )}
    </>
  );
}
