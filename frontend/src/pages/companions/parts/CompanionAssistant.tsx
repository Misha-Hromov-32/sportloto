import { ArrowCounterClockwiseIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { App, Input, Select } from 'antd';
import { useState, type ReactNode } from 'react';

import { AssistantQuestion, AssistantResultHeader, Button } from '@/components';
import { API, useAction, type ApiError } from '@/lib/api';
import type { AssistantDraft, CompanionView, DraftQuestion, SportView } from '@/types/api';
import type { District } from '@/types/domain';
import type { CompanionInput } from '@/types/inputs';

import { AssistantComposer } from '../../events/create/AssistantComposer';
import { FieldError } from '../../events/create/fields';
import createStyles from '../../events/create/create.module.css';
import type { AssistantState } from '../../events/create/model';
import { SportPicker } from '../../events/create/SportPicker';
import { CompanionCard } from './CompanionCard';
import type { CompanionMarkKey } from './CompanionFields';
import { mergeCompanionDraft, type CompanionForm } from './model';

const EXAMPLES = [
  'Хочу бегать по утрам в Академгородке, я новичок',
  'Ищу партнёра по теннису на вечер вторника и четверга, Октябрьский район',
  'Соберу компанию на скандинавскую ходьбу по выходным на Татышеве',
];

const FILLED: Record<string, CompanionMarkKey> = {
  sportId: 'sport',
  newSportName: 'sport',
  when: 'when',
  districtId: 'district',
  level: 'level',
  readiness: 'readiness',
};

const MARK_FIELDS: Record<CompanionMarkKey, (keyof CompanionForm)[]> = {
  sport: ['sport', 'newSportName'],
  text: ['text'],
  district: ['districtId'],
  when: ['when'],
  level: ['level'],
  readiness: ['readiness'],
};

const SIMILAR = 'similarSport';
const NEW_SPORT = '__new__';

interface Props {
  form: CompanionForm;
  base: CompanionForm;
  set: (patch: Partial<CompanionForm>) => void;
  setForm: (form: CompanionForm) => void;
  state: AssistantState;
  setState: (patch: Partial<AssistantState>) => void;
  marks: Partial<Record<CompanionMarkKey, string>>;
  setMarks: (marks: Partial<Record<CompanionMarkKey, string>>) => void;
  sports: SportView[];
  districts: District[];
  preview: CompanionView;
  publishing: boolean;
  problems: string[];
  onPublish: () => void;
  onManual: () => void;
  onFailed: (text: string) => void;
  onRestart: () => void;
}

/** «Хочу бегать по утрам в Академгородке» → черновик объявления → уточнения → предпросмотр. */
export function CompanionAssistant({
  form,
  base,
  set,
  setForm,
  state,
  setState,
  marks,
  setMarks,
  sports,
  districts,
  preview,
  publishing,
  problems,
  onPublish,
  onManual,
  onFailed,
  onRestart,
}: Props) {
  const { run, isPending } = useAction<AssistantDraft<CompanionInput>>();
  const { modal } = App.useApp();
  const [inputError, setInputError] = useState('');
  const [custom, setCustom] = useState(false);

  const unmark = (key: CompanionMarkKey) => {
    const next = { ...marks };
    delete next[key];
    setMarks(next);
  };

  const submit = async () => {
    setInputError('');
    try {
      const res = (await run(API.assistantDraft, { kind: 'companion', text: state.text }, { silent: true })) as AssistantDraft<CompanionInput>;
      const { form: merged, touched } = mergeCompanionDraft(form, base, res.draft, sports);
      const nextMarks: Partial<Record<CompanionMarkKey, string>> = { text: 'Это ваш текст как есть. Можно поправить' };
      for (const f of res.filled) {
        const key = FILLED[f.field];
        if (key) nextMarks[key] = f.why;
      }
      for (const [key, fields] of Object.entries(MARK_FIELDS) as [CompanionMarkKey, (keyof CompanionForm)[]][])
        if (fields.some((f) => touched.includes(f))) delete nextMarks[key];
      const questions: DraftQuestion[] = [];
      if (res.newSport && res.newSport.similar.length > 0) {
        questions.push({
          field: SIMILAR,
          question: `Возможно, вы имели в виду «${res.newSport.similar[0]!.name}»?`,
          options: [
            { label: 'Да, это оно', value: res.newSport.similar[0]!.id },
            { label: `Нет, создать «${res.newSport.name}»`, value: NEW_SPORT },
          ],
          allowCustom: false,
        });
      }
      questions.push(...res.missing.filter((q) => !(q.field === 'districtId' && touched.includes('districtId'))));
      const limited = questions.slice(0, 3);
      setForm(merged);
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
    if (q.field === SIMILAR || q.field === 'sportId') {
      const sport = sports.find((s) => s.id === v);
      if (sport) set({ sport, newSportName: '' });
      unmark('sport');
    } else if (q.field === 'when') {
      set({ when: v });
      unmark('when');
    } else if (q.field === 'districtId') {
      set({ districtId: v });
      unmark('district');
    }
    next();
  };

  const restart = () =>
    modal.confirm({
      title: 'Начать заново?',
      content: 'Черновик очистится, текст можно будет написать снова.',
      okText: 'Начать заново',
      cancelText: 'Оставить черновик',
      onOk: onRestart,
    });

  if (state.phase === 'input')
    return (
      <AssistantComposer
        value={state.text}
        onChange={(text) => setState({ text })}
        onSubmit={submit}
        loading={isPending}
        label="Расскажите, с кем и чем хотите заниматься"
        placeholder="Например: хочу бегать по утрам в Академгородке, я новичок"
        examples={EXAMPLES}
        error={inputError}
      />
    );

  if (state.phase === 'questions') {
    const q = state.questions[state.step];
    if (!q) return null;
    let customEditor: ReactNode = null;
    if (q.field === 'sportId' || q.field === SIMILAR)
      customEditor = (
        <SportPicker
          value={form.sport}
          newName={form.newSportName}
          query={form.sportQuery}
          onQueryChange={(sportQuery) => set({ sportQuery })}
          onSelect={(sport) => set({ sport, newSportName: '', sportQuery: '' })}
          onCreate={(name) => set({ sport: null, newSportName: name, sportQuery: '' })}
          onClear={() => set({ sport: null, newSportName: '' })}
        />
      );
    else if (q.field === 'districtId')
      customEditor = (
        <Select
          size="large"
          value={form.districtId ?? undefined}
          onChange={(v: string) => set({ districtId: v })}
          placeholder="Выберите район"
          options={districts.map((d) => ({ value: d.id, label: d.name }))}
          aria-label="Район"
        />
      );
    else if (q.field === 'when')
      customEditor = (
        <Input
          size="large"
          value={form.when}
          onChange={(e) => set({ when: e.target.value })}
          placeholder="Например, вторник и четверг после 19:00"
          aria-label="Когда удобно"
        />
      );
    return (
      <div className={createStyles.assistantFlow}>
        <AssistantResultHeader>Осталось уточнить пару вещей. Ответьте кнопкой или выберите «Другое».</AssistantResultHeader>
        <p className={createStyles.counter}>
          Вопрос {state.step + 1} из {state.questions.length}
        </p>
        {custom ? (
          <div className={createStyles.customAnswer}>
            <p className={createStyles.customTitle}>{q.question}</p>
            {customEditor}
            <div className={createStyles.rowActions}>
              <Button variant="primary" onClick={next}>
                Готово
              </Button>
              <Button variant="quiet" onClick={() => setCustom(false)}>
                Вернуться к вариантам
              </Button>
            </div>
          </div>
        ) : (
          <AssistantQuestion question={q} onAnswer={(value) => answer(q, value)} onCustom={() => setCustom(true)} />
        )}
        <div className={createStyles.rowActions}>
          <Button variant="quiet" onClick={next}>
            Пропустить вопрос
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={createStyles.assistantFlow}>
      <AssistantResultHeader>
        Так объявление увидят другие. Поля с пометкой заполнил помощник, поправить их можно в форме.
      </AssistantResultHeader>
      <CompanionCard companion={preview} marks={marks} preview />
      {problems.map((p) => (
        <FieldError key={p} error={p} />
      ))}
      <div className={createStyles.finalActions}>
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
