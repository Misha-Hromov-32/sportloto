import { ArrowCounterClockwiseIcon, PencilSimpleIcon, SparkleIcon } from '@phosphor-icons/react';
import { App, DatePicker, Input, TimePicker } from 'antd';
import { useState, type ReactNode } from 'react';

import { AssistantQuestion, AssistantResultHeader, Button } from '@/components';
import { API, useAction, type ApiError } from '@/lib/api';
import { dayjs, formatEventDate } from '@/lib/dates';
import type { AssistantDraft, DraftQuestion, OrganizerView, SportView } from '@/types/api';
import type { EventInput } from '@/types/inputs';

import { AssistantComposer } from './AssistantComposer';
import { EventPreview } from './EventPreview';
import { previewMarks, problemsByRow, type PreviewRow } from './preview';
import { applyDraft, formatDateInput, sportNameOf, startsAtOf, type AssistantState, type EventForm, type FormErrors } from './model';
import {
  AccessFields,
  CapacityFields,
  DateTimeFields,
  DescriptionField,
  FirstStepFields,
  JoinModeField,
  LevelFields,
  PlaceFields,
  PriceFields,
  SportField,
  TitleField,
} from './sections';
import styles from './create.module.css';

const EXAMPLES = [
  'В субботу в 10 футбол в парке Гагарина, нужно 10 человек, новичкам можно, мяч есть',
  'Завтра в 19:00 скандинавская ходьба на острове Татышев, бесплатно, для всех',
  'Играть в лапту в воскресенье утром в Академгородке, человек 8, скидываемся 1200 на аренду',
];

const FILLED_FIELD: Record<string, string> = {
  sportId: 'sport',
  newSportName: 'sport',
  startsAt: 'when',
  place: 'place',
  capacity: 'capacity',
  minParticipants: 'minParticipants',
  joinMode: 'joinMode',
  level: 'level',
  price: 'price',
  firstStep: 'firstStep',
  title: 'title',
};

const SIMILAR = 'similarSport';
const NEW_SPORT = '__new__';

/** Какие поля формы стоят за пометкой помощника: если человек их уже заполнил сам, пометку не ставим. */
const MARK_FIELDS: Record<string, (keyof EventForm)[]> = {
  sport: ['sport', 'newSportName'],
  title: ['title'],
  description: ['description'],
  when: ['date', 'time'],
  place: ['address'],
  capacity: ['capacity'],
  minParticipants: ['minParticipants'],
  joinMode: ['joinMode'],
  level: ['level', 'beginnersWelcome'],
  price: ['priceKind', 'priceAmount', 'priceTotal'],
  firstStep: ['bring', 'firstTimeNote'],
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface EventAssistantProps {
  form: EventForm;
  /** Исходная форма: всё, что человек поменял относительно неё, помощник не трогает. */
  base: EventForm;
  set: (patch: Partial<EventForm>) => void;
  setForm: (form: EventForm) => void;
  state: AssistantState;
  setState: (patch: Partial<AssistantState>) => void;
  marks: Record<string, string>;
  setMarks: (marks: Record<string, string>) => void;
  sports: SportView[];
  organizer: OrganizerView;
  errors: FormErrors;
  publishing: boolean;
  onPublish: () => void;
  onManual: () => void;
  onFailed: (text: string) => void;
  onRestart: () => void;
}

/** Режим «Создать с помощником»: фраза → черновик → до трёх уточнений → предпросмотр с пометками. */
export function EventAssistant({
  form,
  base,
  set,
  setForm,
  state,
  setState,
  marks,
  setMarks,
  sports,
  organizer,
  errors,
  publishing,
  onPublish,
  onManual,
  onFailed,
  onRestart,
}: EventAssistantProps) {
  const { run, isPending } = useAction<AssistantDraft<EventInput>>();
  const { modal } = App.useApp();
  const [inputError, setInputError] = useState('');
  const [custom, setCustom] = useState(false);
  const [editing, setEditing] = useState<PreviewRow | null>(null);

  const unmark = (...keys: string[]) => {
    const next = { ...marks };
    for (const k of keys) delete next[k];
    setMarks(next);
  };

  const submit = async () => {
    setInputError('');
    try {
      const res = (await run(API.assistantDraft, { kind: 'event', text: state.text }, { silent: true })) as AssistantDraft<EventInput>;
      const applied = applyDraft(base, res.draft, sports).form;
      const touched = (Object.keys(form) as (keyof EventForm)[]).filter((k) => !same(form[k], base[k]));
      const merged = { ...applied } as Record<keyof EventForm, unknown>;
      for (const k of touched) merged[k] = form[k];
      const nextMarks: Record<string, string> = {};
      for (const f of res.filled) {
        const key = FILLED_FIELD[f.field];
        if (key) nextMarks[key] = nextMarks[key] ? `${nextMarks[key]}. ${f.why}` : f.why;
      }
      nextMarks.description = 'Это ваш текст как есть. Можно дополнить';
      for (const [key, fields] of Object.entries(MARK_FIELDS))
        if (fields.some((f) => touched.includes(f))) delete nextMarks[key];
      const questions: DraftQuestion[] = [];
      if (res.newSport && res.newSport.similar.length > 0) {
        questions.push({
          field: SIMILAR,
          question: `Возможно, вы имели в виду «${res.newSport.similar[0]!.name}»?`,
          options: [
            ...res.newSport.similar.slice(0, 2).map((s, i) => ({
              label: i === 0 ? 'Да, это оно' : s.name,
              value: s.id,
            })),
            { label: `Нет, создать «${res.newSport.name}»`, value: NEW_SPORT },
          ],
          allowCustom: false,
        });
      }
      questions.push(...res.missing);
      const limited = questions.slice(0, 3);
      setForm(merged as EventForm);
      setMarks(nextMarks);
      setCustom(false);
      setState({ phase: limited.length ? 'questions' : 'preview', questions: limited, step: 0 });
    } catch (error) {
      const e = error as ApiError;
      if (e?.code === 'validation') setInputError(e.message);
      else onFailed(state.text);
    }
  };

  const next = () => {
    setCustom(false);
    if (state.step + 1 < state.questions.length) setState({ step: state.step + 1 });
    else setState({ phase: 'preview' });
  };

  const answer = (q: DraftQuestion, value: unknown) => {
    const v = String(value);
    if (q.field === SIMILAR) {
      if (v !== NEW_SPORT) {
        const sport = sports.find((s) => s.id === v);
        if (sport) set({ sport, newSportName: '' });
      }
      unmark('sport');
    } else if (q.field === 'sportId') {
      const sport = sports.find((s) => s.id === v);
      if (sport) set({ sport, newSportName: '', title: form.title.startsWith('Встреча') ? form.title.replace('Встреча', sport.name) : form.title });
      unmark('sport');
    } else if (q.field === 'date') {
      set({ date: dayjs(v).format('YYYY-MM-DD') });
      unmark('when');
    } else if (q.field === 'time') {
      set({ time: v });
      unmark('when');
    } else if (q.field === 'place') {
      set({ address: v });
      unmark('place');
    }
    next();
  };

  const restart = () =>
    modal.confirm({
      title: 'Начать заново?',
      content: 'Черновик очистится, текст можно будет написать снова.',
      okText: 'Начать заново',
      cancelText: 'Оставить черновик',
      onOk: () => {
        setEditing(null);
        onRestart();
      },
    });

  if (state.phase === 'input') {
    return (
      <AssistantComposer
        value={state.text}
        onChange={(text) => setState({ text })}
        onSubmit={submit}
        loading={isPending}
        label="Расскажите о встрече одной-двумя фразами"
        placeholder="Что, когда, где и сколько нужно людей. Например: в субботу в 10 волейбол в парке Горького, человек 12"
        examples={EXAMPLES}
        error={inputError}
      />
    );
  }

  if (state.phase === 'questions') {
    const q = state.questions[state.step];
    if (!q) return null;
    return (
      <div className={styles.assistantFlow}>
        <AssistantResultHeader>Осталось уточнить пару вещей. Ответьте кнопкой или выберите «Другое».</AssistantResultHeader>
        <Understood form={form} marks={marks} />
        <p className={styles.counter}>
          Вопрос {state.step + 1} из {state.questions.length}
        </p>
        {custom ? (
          <div className={styles.customAnswer}>
            <p className={styles.customTitle}>{q.question}</p>
            <CustomAnswer field={q.field} form={form} set={set} />
            <div className={styles.rowActions}>
              <Button variant="primary" onClick={next}>
                Ответить
              </Button>
              <Button variant="quiet" onClick={() => setCustom(false)}>
                Вернуться к вариантам
              </Button>
            </div>
          </div>
        ) : (
          <AssistantQuestion question={q} onAnswer={(value) => answer(q, value)} onCustom={() => setCustom(true)} />
        )}
        <div className={styles.rowActions}>
          <Button variant="quiet" onClick={next}>
            Пропустить вопрос
          </Button>
        </div>
      </div>
    );
  }

  const renderEditor = (row: PreviewRow): ReactNode => {
    const props = { form, set, errors, marks: {} };
    const editors: Record<PreviewRow, ReactNode> = {
      sport: <SportField {...props} />,
      title: <TitleField {...props} />,
      when: <DateTimeFields {...props} />,
      place: <PlaceFields {...props} />,
      joinMode: <JoinModeField {...props} />,
      capacity: <CapacityFields {...props} />,
      price: <PriceFields {...props} />,
      level: <LevelFields {...props} />,
      firstStep: (
        <div className={styles.editorStack}>
          <LevelFields {...props} />
          <FirstStepFields {...props} />
        </div>
      ),
      description: <DescriptionField {...props} />,
      discussion: <AccessFields {...props} />,
    };
    const done = () => {
      unmark(row, ...(row === 'capacity' ? ['minParticipants'] : row === 'firstStep' ? ['level'] : []));
      setEditing(null);
    };
    return (
      <div className={styles.editorStack}>
        {editors[row]}
        <div className={styles.rowActions}>
          <Button variant="secondary" onClick={done}>
            Сохранить
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.assistantFlow}>
      <AssistantResultHeader>
        Так встречу увидят участники. Поля с пометкой заполнил помощник: нажмите «Изменить», чтобы поправить.
      </AssistantResultHeader>
      <EventPreview
        form={form}
        organizer={organizer}
        marks={previewMarks(marks)}
        problems={problemsByRow(errors)}
        onEdit={(row) => setEditing(row)}
        editing={editing}
        renderEditor={renderEditor}
      />
      <div className={styles.finalActions}>
        <Button variant="primary" size="lg" onClick={onPublish} loading={publishing} loadingText="Публикуем…">
          Опубликовать
        </Button>
        <Button variant="secondary" icon={<PencilSimpleIcon size={20} aria-hidden />} onClick={onManual}>
          Изменить вручную
        </Button>
        <Button variant="quiet" icon={<ArrowCounterClockwiseIcon size={20} aria-hidden />} onClick={restart}>
          Начать заново
        </Button>
      </div>
    </div>
  );
}

/** Что помощник уже понял — короткой строкой, чтобы вопрос не казался оторванным. */
function Understood({ form, marks }: { form: EventForm; marks: Record<string, string> }) {
  const start = startsAtOf(form);
  const items = [
    marks.sport && sportNameOf(form),
    marks.when && start && formatEventDate(start),
    marks.place && form.address,
    marks.capacity && form.capacity && `${form.capacity} мест`,
    marks.price && (form.priceKind === 'free' ? 'бесплатно' : form.priceKind === 'split' ? 'скидываемся' : 'платно'),
    marks.level && form.beginnersWelcome && 'рады новичкам',
  ].filter(Boolean) as string[];
  if (!items.length) return null;
  return (
    <div className={styles.understood}>
      <span className={styles.understoodTitle}>Уже понял:</span>
      <div className={styles.understoodList}>
        {items.map((i) => (
          <span key={i} className={styles.understoodItem}>
            <SparkleIcon size={14} weight="fill" aria-hidden />
            {i}
          </span>
        ))}
      </div>
    </div>
  );
}

function CustomAnswer({
  field,
  form,
  set,
}: {
  field: string;
  form: EventForm;
  set: (patch: Partial<EventForm>) => void;
}) {
  if (field === 'sportId' || field === SIMILAR) return <SportField form={form} set={set} errors={{}} />;
  if (field === 'date')
    return (
      <DatePicker
        size="large"
        value={form.date ? dayjs(form.date) : null}
        onChange={(d) => set({ date: d ? d.format('YYYY-MM-DD') : '' })}
        format={formatDateInput}
        placeholder="Выберите дату"
        disabledDate={(d) => d.isBefore(dayjs().startOf('day'))}
        inputReadOnly
        aria-label="Дата встречи"
      />
    );
  if (field === 'time')
    return (
      <TimePicker
        size="large"
        value={form.time ? dayjs(`2000-01-01T${form.time}`) : null}
        onChange={(t) => set({ time: t ? t.format('HH:mm') : '' })}
        format="HH:mm"
        minuteStep={5}
        needConfirm={false}
        placeholder="Время начала"
        inputReadOnly
        aria-label="Время начала"
      />
    );
  if (field === 'place')
    return (
      <Input
        size="large"
        value={form.address}
        onChange={(e) => set({ address: e.target.value })}
        placeholder="Адрес или понятный ориентир"
        aria-label="Где встречаемся"
      />
    );
  return null;
}
