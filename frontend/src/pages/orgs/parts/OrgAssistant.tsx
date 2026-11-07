import { PencilSimpleIcon, SparkleIcon } from '@phosphor-icons/react';
import { Input } from 'antd';
import { useState } from 'react';

import {
  AssistantMark,
  AssistantQuestion,
  AssistantResultHeader,
  AssistantThinking,
  AssistantUnavailable,
  Button,
} from '@/components';
import { API, useAction, type ApiError } from '@/lib/api';
import { ORG_TYPE } from '@/lib/labels';
import type { AssistantDraft, SportView } from '@/types/api';
import type { District } from '@/types/domain';
import type { OrganizationInput } from '@/types/inputs';

import styles from './FormParts.module.css';
import type { AssistantState, OrgField, OrgFormValues } from './formModel';

interface OrgAssistantProps {
  state: AssistantState;
  onState: (next: AssistantState) => void;
  values: OrgFormValues;
  onValues: (patch: Partial<OrgFormValues>) => void;
  /** Переход к ручной форме; поле — куда поставить фокус. */
  onManual: (field?: OrgField) => void;
  onRestart: () => void;
  catalog: SportView[];
  districts: District[];
}

const SUMMARY: { field: OrgField; label: string }[] = [
  { field: 'name', label: 'Название' },
  { field: 'type', label: 'Кто вы' },
  { field: 'sportIds', label: 'Направления' },
  { field: 'districtId', label: 'Район' },
  { field: 'contacts', label: 'Контакты' },
  { field: 'description', label: 'О деятельности' },
];

/** Режим «Создать с помощником»: фраза → черновик → до трёх уточнений → проверка. Решает человек. */
export function OrgAssistant({
  state,
  onState,
  values,
  onValues,
  onManual,
  onRestart,
  catalog,
  districts,
}: OrgAssistantProps) {
  const { run, isPending } = useAction<AssistantDraft<OrganizationInput>>();
  const [failed, setFailed] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [customOpen, setCustomOpen] = useState(false);

  const ask = async () => {
    setTextError(null);
    setFailed(false);
    if (state.text.trim().length < 5) {
      setTextError('Напишите хотя бы одну фразу: как называетесь и чем занимаетесь');
      return;
    }
    try {
      const res = await run(API.assistantDraft, { kind: 'organization', text: state.text }, { silent: true });
      const d = res.draft;
      const assisted: OrgFormValues['assisted'] = {};
      res.filled.forEach((f) => {
        if (f.field in values) assisted[f.field as OrgField] = f.why;
        if (f.field === 'contacts') assisted.contacts = f.why;
      });
      if (d.description) assisted.description = 'Взяли ваш текст. Его можно дополнить';
      onValues({
        name: d.name ?? values.name,
        type: d.type ?? values.type,
        description: d.description ?? values.description,
        sportIds: d.sportIds?.length ? d.sportIds : values.sportIds,
        districtId: d.districtId ?? values.districtId,
        city: d.city ?? values.city,
        phone: d.contacts?.phone || values.phone,
        email: d.contacts?.email || values.email,
        social: d.contacts?.social || values.social,
        createdWithAssistant: true,
        assisted,
      });
      onState({ ...state, stage: 'result', questions: res.missing });
    } catch (error) {
      const code = (error as ApiError).code;
      if (code === 'validation') setTextError('Напишите подробнее: как называетесь и чем занимаетесь');
      else setFailed(true);
    }
  };

  const nextQuestion = state.questions[0];
  const answer = (patch: Partial<OrgFormValues>) => {
    onValues(patch);
    setCustom('');
    setCustomOpen(false);
    onState({ ...state, questions: state.questions.slice(1) });
  };
  const answerCustom = () => {
    const v = custom.trim();
    if (!v || !nextQuestion) return;
    if (nextQuestion.field === 'name') answer({ name: v });
    else if (nextQuestion.field === 'contacts') answer(v.includes('@') ? { email: v } : { phone: v });
    else if (nextQuestion.field === 'sportIds') answer({ customSports: [...values.customSports, v] });
  };

  if (state.stage === 'input') {
    return (
      <div className={styles.assistant}>
        <label htmlFor="org-assistant-text" className={styles.label}>
          Расскажите об организации одной-двумя фразами
        </label>
        <p className={styles.hint} id="org-assistant-hint">
          Укажите название организации, занятия, адрес и контакты. Помощник подготовит заявку. Проверьте её
          перед отправкой.
        </p>
        <Input.TextArea
          id="org-assistant-text"
          value={state.text}
          onChange={(e) => onState({ ...state, text: e.target.value })}
          autoSize={{ minRows: 4, maxRows: 10 }}
          maxLength={1500}
          placeholder="Беговой клуб «Енисей»: бегаем по субботам на острове Татышев, есть группа для новичков. Телефон +7 923 310-55-10"
          status={textError ? 'error' : undefined}
          aria-describedby="org-assistant-hint"
          disabled={isPending}
        />
        {textError && <p className={styles.error}>{textError}</p>}
        {isPending ? (
          <AssistantThinking text="Помощник собирает заявку…" />
        ) : failed ? (
          <AssistantUnavailable
            onManual={() => {
              onValues({ description: values.description || state.text.trim() });
              onManual('name');
            }}
          >
            Заполните форму сами, ваш текст перенесётся в поле «О деятельности».
          </AssistantUnavailable>
        ) : (
          <Button
            variant="primary"
            icon={<SparkleIcon size={20} weight="fill" aria-hidden />}
            onClick={() => void ask()}
            className={styles.alignStart}
          >
            Собрать заявку
          </Button>
        )}
      </div>
    );
  }

  const district = districts.find((d) => d.id === values.districtId)?.name;
  const sportNames = [
    ...values.sportIds.map((id) => catalog.find((s) => s.id === id)?.name ?? 'Направление'),
    ...values.customSports,
  ];
  const contacts = [values.phone, values.email, values.social].filter((v) => v.trim()).join(', ');
  const shown: Record<OrgField, string> = {
    name: values.name,
    type: values.type ? ORG_TYPE[values.type] : '',
    sportIds: sportNames.join(', '),
    districtId: district ?? '',
    contacts,
    description: values.description,
    address: values.address,
  };

  return (
    <div className={styles.assistant}>
      <AssistantResultHeader />

      {nextQuestion && (
        <div className={styles.question}>
          {nextQuestion.options.length > 0 && !customOpen ? (
            <AssistantQuestion
              question={nextQuestion}
              onAnswer={(value) => answer({ sportIds: [...new Set([...values.sportIds, String(value)])] })}
              onCustom={() => setCustomOpen(true)}
            />
          ) : (
            <div className={styles.questionCustom}>
              <label htmlFor="org-assistant-answer" className={styles.questionTitle}>
                <SparkleIcon size={18} weight="fill" aria-hidden />
                {nextQuestion.field === 'sportIds'
                  ? 'Как называется ваше направление?'
                  : nextQuestion.question}
              </label>
              <div className={styles.inline}>
                <Input
                  id="org-assistant-answer"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onPressEnter={answerCustom}
                  placeholder={nextQuestion.field === 'contacts' ? '+7 900 123-45-67 или club@mail.ru' : ''}
                />
                <Button variant="secondary" onClick={answerCustom} disabled={!custom.trim()}>
                  Ответить
                </Button>
              </div>
            </div>
          )}
          <Button variant="quiet" size="sm" onClick={() => answer({})} className={styles.alignStart}>
            Пропустить вопрос
          </Button>
        </div>
      )}

      <dl className={styles.summary}>
        {SUMMARY.map(({ field, label }) => (
          <div key={field} className={styles.summaryRow}>
            <dt className={styles.summaryLabel}>
              {label}
              {values.assisted[field] !== undefined && <AssistantMark why={values.assisted[field]} />}
            </dt>
            <dd className={styles.summaryValue}>
              <span className={shown[field] ? undefined : styles.missing}>
                {shown[field] || 'Не заполнено'}
              </span>
              <button type="button" className={styles.edit} onClick={() => onManual(field)}>
                <PencilSimpleIcon size={18} aria-hidden />
                Изменить<span className="sr-only">: {label.toLowerCase()}</span>
              </button>
            </dd>
          </div>
        ))}
      </dl>

      <div className={styles.assistantActions}>
        <Button
          variant="secondary"
          icon={<PencilSimpleIcon size={20} aria-hidden />}
          onClick={() => onManual()}
        >
          Изменить вручную
        </Button>
        <Button variant="quiet" onClick={onRestart}>
          Начать заново
        </Button>
      </div>
    </div>
  );
}
