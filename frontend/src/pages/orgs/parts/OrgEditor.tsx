import {
  ClockCountdownIcon,
  FloppyDiskIcon,
  PaperPlaneTiltIcon,
  UserCircleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useCreate, useList } from '@refinedev/core';
import { useEffect, useState, type ReactNode } from 'react';

import { Button, ModeSwitch, type FillMode } from '@/components';
import { errorMessage, type ApiError } from '@/lib/api';
import { choosable, WITH_HIDDEN } from '@/lib/sportChoices';
import type { Identity, SportView } from '@/types/api';
import type { District } from '@/types/domain';
import type { OrganizationInput } from '@/types/inputs';

import styles from './FormParts.module.css';
import { logoUrlOf } from './logos';
import { OrgAssistant } from './OrgAssistant';
import { useAiFeature } from '@/lib/aiFeatures';
import { OrgForm } from './OrgForm';
import {
  EMPTY_ASSISTANT,
  EMPTY_VALUES,
  type AssistantState,
  type ErrorField,
  FIELD_LABEL,
  FIELD_ORDER,
  hasContent,
  toInput,
  validate,
  type OrgErrors,
  type OrgField,
  type OrgFormValues,
} from './formModel';
import { OrgPreview } from './OrgPreview';

export type EditorPurpose = 'create' | 'resubmit' | 'edit';

interface OrgEditorProps {
  me: Identity;
  initial: OrgFormValues;
  purpose: EditorPurpose;
  /** Ключ черновика на этом устройстве: введённое не теряется при уходе со страницы. */
  draftKey?: string;
  onSubmit: (input: OrganizationInput) => Promise<void>;
  onCancel?: () => void;
  /** Над формой: например, причина отказа, которую нужно исправить. */
  intro?: ReactNode;
}

interface Draft {
  values: OrgFormValues;
  mode: FillMode;
  assistant: AssistantState;
}

function readDraft(key: string | undefined): Draft | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    return { ...draft, values: { ...EMPTY_VALUES, ...draft.values } };
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch {
    /* хранилище недоступно: черновик живёт, пока открыта страница */
  }
}

const FOCUS_TARGET: Record<ErrorField, string> = {
  name: 'org-name',
  type: 'org-type',
  description: 'org-description',
  logoUrl: 'org-logo-upload',
  coverUrl: 'org-cover-upload',
  sportIds: 'org-sportIds',
  districtId: 'org-districtId',
  address: 'org-address',
  contacts: 'org-phone',
};

function focusField(field: ErrorField) {
  window.setTimeout(() => {
    const el = document.getElementById(FOCUS_TARGET[field]);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
  }, 60);
}

export function OrgEditor({ me, initial, purpose, draftKey, onSubmit, onCancel, intro }: OrgEditorProps) {
  const [restored] = useState(() => readDraft(draftKey));
  const [values, setValues] = useState<OrgFormValues>(restored?.values ?? initial);
  const formsOn = useAiFeature('forms');
  const [chosenMode, setMode] = useState<FillMode>(restored?.mode ?? 'manual');
  const mode: FillMode = formsOn ? chosenMode : 'manual';
  const [assistant, setAssistant] = useState<AssistantState>(restored?.assistant ?? EMPTY_ASSISTANT);
  const [showRestored, setShowRestored] = useState(Boolean(restored && hasContent(restored.values)));
  const [errors, setErrors] = useState<OrgErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const { mutateAsync: createSport } = useCreate<SportView>();

  const sports = useList<SportView>({ resource: 'sports', filters: WITH_HIDDEN, pagination: { mode: 'off' } });
  const districtsQuery = useList<District>({ resource: 'districts', pagination: { mode: 'off' } });
  const catalog = choosable(sports.result.data ?? [], values.sportIds);
  const districts = districtsQuery.result.data ?? [];

  useEffect(() => {
    if (!draftKey) return;
    if (hasContent(values) || assistant.text.trim()) writeDraft(draftKey, { values, mode, assistant });
  }, [draftKey, values, mode, assistant]);

  const change = (patch: Partial<OrgFormValues>, field?: ErrorField) => {
    setValues((prev) => {
      const assisted = { ...(patch.assisted ?? prev.assisted) };
      if (field && !patch.assisted) delete assisted[field as OrgField];
      return { ...prev, ...patch, assisted };
    });
    if (field && errors[field]) setErrors(({ [field]: _, ...rest }) => rest);
  };

  const restart = () => {
    setValues(initial);
    setAssistant(EMPTY_ASSISTANT);
    setErrors({});
    setShowRestored(false);
    if (draftKey) writeDraft(draftKey, null);
  };

  const toManual = (field?: OrgField) => {
    setMode('manual');
    if (field) focusField(field);
  };

  const submit = async () => {
    const found = validate(values);
    if (Object.keys(found).length) {
      setErrors(found);
      setMode('manual');
      const first = FIELD_ORDER.find((f) => found[f]);
      if (first) focusField(first);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const ids = [...values.sportIds];
      for (const name of values.customSports) {
        const res = await createSport({
          resource: 'sports',
          values: { name },
          successNotification: false,
          errorNotification: false,
        });
        ids.push(String(res.data.id));
      }
      const sportIds = [...new Set(ids)];
      if (values.customSports.length) setValues((prev) => ({ ...prev, sportIds, customSports: [] }));
      await onSubmit(toInput(values, sportIds, logoUrlOf(values.logo)));
      if (draftKey) writeDraft(draftKey, null);
    } catch (error) {
      const err = error as ApiError & { errors?: Record<string, string> };
      if (err.errors && Object.keys(err.errors).length) {
        const fields = err.errors as OrgErrors;
        setErrors(fields);
        setMode('manual');
        const first = FIELD_ORDER.find((f) => fields[f]);
        if (first) focusField(first);
      } else {
        setErrors({
          form: errorMessage(error, 'Заявка не отправилась. Проверьте интернет и попробуйте ещё раз'),
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const ready = mode === 'manual' || assistant.stage === 'result';
  const fieldErrors = FIELD_ORDER.filter((f) => errors[f]);

  return (
    <div className={styles.editor}>
      {intro}
      {purpose === 'create' && formsOn && (
        <ModeSwitch value={mode} onChange={setMode} label="Как заполнить заявку организации" />
      )}
      {showRestored && (
        <div className={styles.restored} role="status">
          <FloppyDiskIcon size={22} aria-hidden />
          <p>Черновик сохранён на этом устройстве. Можно продолжить с того же места.</p>
          <Button variant="quiet" size="sm" onClick={restart}>
            Начать заново
          </Button>
        </div>
      )}

      <div className={[styles.layout, !ready && styles.layoutSingle].filter(Boolean).join(' ')}>
        <div className={styles.main}>
          {mode === 'manual' ? (
            <OrgForm
              values={values}
              onChange={change}
              errors={errors}
              catalog={catalog}
              districts={districts}
              me={me}
            />
          ) : (
            <OrgAssistant
              state={assistant}
              onState={setAssistant}
              values={values}
              onValues={(patch) => change(patch)}
              onManual={toManual}
              onRestart={restart}
              catalog={catalog}
              districts={districts}
            />
          )}
        </div>

        {ready && (
          <aside className={styles.aside}>
            <div className={styles.sticky}>
              <OrgPreview values={values} catalog={catalog} districts={districts} />
            </div>
          </aside>
        )}

        {ready && (
          <div className={styles.submit}>
            {purpose !== 'edit' ? (
              <section className={styles.next} aria-labelledby="org-next-title">
                <h2 id="org-next-title" className={styles.nextTitle}>
                  Что будет дальше
                </h2>
                <ul className={styles.nextList}>
                  <li>
                    <ClockCountdownIcon size={22} aria-hidden />
                    <span>Администратор проверит заявку, обычно до одного дня.</span>
                  </li>
                  <li>
                    <UserCircleIcon size={22} aria-hidden />
                    <span>
                      До решения публиковать от имени организации нельзя, но вы можете создавать встречи от
                      себя.
                    </span>
                  </li>
                  <li>
                    <PaperPlaneTiltIcon size={22} aria-hidden />
                    <span>Решение придёт в уведомления и появится в кабинете организации.</span>
                  </li>
                </ul>
              </section>
            ) : (
              <p className={styles.hint}>
                Изменения появятся на странице организации сразу после сохранения.
              </p>
            )}

            {(fieldErrors.length > 0 || errors.form) && (
              <div className={styles.summaryError} role="alert">
                <WarningCircleIcon size={22} weight="bold" aria-hidden />
                <div>
                  <p className={styles.summaryErrorTitle}>
                    {errors.form ?? 'Заявка не отправлена: проверьте поля'}
                  </p>
                  {fieldErrors.length > 0 && (
                    <ul className={styles.summaryErrorList}>
                      {fieldErrors.map((f) => (
                        <li key={f}>
                          <button type="button" onClick={() => focusField(f)}>
                            {FIELD_LABEL[f]}: {errors[f]}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            <div className={styles.actions}>
              <Button
                variant="primary"
                size="lg"
                icon={<PaperPlaneTiltIcon size={22} aria-hidden />}
                onClick={() => void submit()}
                loading={submitting}
                loadingText={purpose === 'edit' ? 'Сохраняем…' : 'Отправляем…'}
              >
                {purpose === 'edit'
                  ? 'Сохранить изменения'
                  : purpose === 'resubmit'
                    ? 'Отправить снова'
                    : 'Отправить на проверку'}
              </Button>
              {onCancel && (
                <Button variant="secondary" size="lg" onClick={onCancel} disabled={submitting}>
                  Выйти без изменений
                </Button>
              )}
            </div>
            {draftKey && (
              <p className={styles.draftNote}>
                <FloppyDiskIcon size={18} aria-hidden />
                Черновик сохраняется на этом устройстве, пока вы заполняете.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
