import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { useCreate, useList } from '@refinedev/core';
import { App } from 'antd';
import { useCallback, useEffect, useState } from 'react';

import { AssistantUnavailable, Button, ModeSwitch, type FillMode } from '@/components';
import { errorMessage, useMe, type ApiError } from '@/lib/api';
import { formatAgo } from '@/lib/dates';
import { getSelectedCity, selectedCityId } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { CompanionView, Identity } from '@/types/api';
import type { District } from '@/types/domain';

import createStyles from '../events/create/create.module.css';
import { PersonalPage } from '../shared/PersonalPage';
import { EMPTY_ASSISTANT, type AssistantState } from '../events/create/model';
import { useSportsCatalog } from '../events/create/useSportsCatalog';
import { useLocation } from 'react-router'; // В2
import {
  applyCompanionPrefill,
  prefillMarks,
  readCompanionPrefill,
} from '../events/feed/assistant/companionPrefill'; // В2
import { CompanionAssistant } from './parts/CompanionAssistant';
import { useAiFeature } from '@/lib/aiFeatures';
import { CompanionCard } from './parts/CompanionCard';
import { CompanionFields, type CompanionMarkKey } from './parts/CompanionFields';
import styles from './parts/companions.module.css';
import {
  EMPTY_COMPANION,
  previewCompanion,
  toCompanionInput,
  validateCompanion,
  type CompanionErrors,
  type CompanionForm,
} from './parts/model';

type Marks = Partial<Record<CompanionMarkKey, string>>;

interface StoredDraft {
  savedAt: string;
  mode: FillMode;
  form: CompanionForm;
  marks: Marks;
  assistant: AssistantState;
  usedAssistant: boolean;
}

const draftKey = (userId: string) => `vmeste:companion-draft:${userId}:${selectedCityId()}`;

function readDraft(userId: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as StoredDraft;
    if (!d?.form) return null;
    return {
      ...d,
      form: { ...EMPTY_COMPANION, ...d.form },
      assistant: { ...EMPTY_ASSISTANT, ...d.assistant },
    };
  } catch {
    return null;
  }
}

function writeDraft(userId: string, draft: StoredDraft) {
  try {
    localStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch {
    /* хранилище недоступно — черновик живёт до закрытия вкладки */
  }
}

function clearDraft(userId: string) {
  try {
    localStorage.removeItem(draftKey(userId));
  } catch {
    /* нечего чистить */
  }
}

const hasContent = (f: CompanionForm) => Boolean(f.sport || f.newSportName || f.text.trim() || f.when.trim());

function baseFor(me: Identity): CompanionForm {
  return {
    ...EMPTY_COMPANION,
    districtId: me.city === getSelectedCity().name ? me.districtId : null,
    readiness: me.readiness ?? 'join',
  };
}

export default function CompanionCreatePage() {
  const city = useSelectedCity();
  return <CompanionCreateForm key={city.id} />;
}

function CompanionCreateForm() {
  const city = useSelectedCity();
  const { me } = useMe();
  const user = me!;
  const { message } = App.useApp();
  const { sports } = useSportsCatalog();
  const districts = useList<District>({ resource: 'districts', pagination: { mode: 'off' } });
  // В2: «Ищу компанию» из подбора — поля уже заполнены по фразе, человек проверяет и публикует
  const location = useLocation();
  const [prefill] = useState(() => readCompanionPrefill(location.state));
  const [stored] = useState(() => {
    if (prefill) return null;
    const d = readDraft(user.id);
    return d && (hasContent(d.form) || d.assistant.text.trim()) ? d : null;
  });
  const [base, setBase] = useState(() => baseFor(user));
  const [form, setForm] = useState<CompanionForm>(
    stored?.form ?? (prefill ? applyCompanionPrefill(base, prefill) : base),
  );
  const [errors, setErrors] = useState<CompanionErrors>({});
  const formsOn = useAiFeature('forms');
  const [chosenMode, setMode] = useState<FillMode>(stored?.mode ?? 'manual');
  const mode: FillMode = formsOn ? chosenMode : 'manual';
  const [marks, setMarks] = useState<Marks>(stored?.marks ?? (prefill ? prefillMarks(prefill) : {}));
  const [assistant, setAssistantState] = useState<AssistantState>(stored?.assistant ?? EMPTY_ASSISTANT);
  const [usedAssistant, setUsedAssistant] = useState(stored?.usedAssistant ?? Boolean(prefill));
  useEffect(() => {
    const sport = prefill?.sportId ? sports.find((s) => s.id === prefill.sportId) : undefined;
    if (sport) setForm((f) => (f.sport ? f : { ...f, sport, newSportName: '' }));
  }, [prefill, sports]);
  const [restoredAt, setRestoredAt] = useState<string | null>(stored?.savedAt ?? null);
  const [assistantDown, setAssistantDown] = useState(false);
  const [created, setCreated] = useState<CompanionView | null>(null);
  const { mutateAsync, mutation } = useCreate<CompanionView>();

  const set = useCallback((patch: Partial<CompanionForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      if ('sport' in patch || 'newSportName' in patch) delete next.sport;
      if ('text' in patch) delete next.text;
      if ('when' in patch) delete next.when;
      return next;
    });
  }, []);
  const setAssistant = useCallback(
    (patch: Partial<AssistantState>) => setAssistantState((s) => ({ ...s, ...patch })),
    [],
  );

  useEffect(() => {
    if (created) return;
    const t = setTimeout(() => {
      if (hasContent(form) || assistant.text.trim())
        writeDraft(user.id, {
          savedAt: new Date().toISOString(),
          mode,
          form,
          marks,
          assistant,
          usedAssistant,
        });
    }, 400);
    return () => clearTimeout(t);
  }, [form, mode, marks, assistant, usedAssistant, created, user.id]);

  const districtName = districts.result.data.find((d) => d.id === form.districtId)?.name ?? null;
  const preview = previewCompanion(
    form,
    { id: user.id, name: user.name, avatarUrl: user.avatarUrl, initials: user.initials },
    districtName,
  );

  const reset = () => {
    const fresh = baseFor(user);
    setBase(fresh);
    setForm(fresh);
    setErrors({});
    setMarks({});
    setAssistantState(EMPTY_ASSISTANT);
    setUsedAssistant(false);
    setRestoredAt(null);
    setAssistantDown(false);
    clearDraft(user.id);
  };

  const publish = async () => {
    const errs = validateCompanion(form);
    if (Object.keys(errs).length) {
      setErrors(errs);
      if (mode === 'manual')
        requestAnimationFrame(() =>
          document.querySelector('[data-field-error]')?.scrollIntoView({ block: 'center' }),
        );
      message.error('Проверьте отмеченные поля');
      return;
    }
    try {
      const res = await mutateAsync({
        resource: 'companions',
        values: {
          ...toCompanionInput(form, usedAssistant),
          ...(!form.districtId ? { point: city.center } : {}),
        },
        successNotification: false,
        errorNotification: false,
      });
      setCreated(res.data);
      clearDraft(user.id);
      window.scrollTo({ top: 0 });
    } catch (error) {
      const fields = (error as ApiError).errors as Record<string, string> | undefined;
      if (fields) setErrors({ sport: fields.sportId, text: fields.text, when: fields.when });
      message.error(errorMessage(error, 'Не удалось опубликовать. Попробуйте ещё раз'));
    }
  };

  if (created)
    return (
      <div className="container">
        <section className={styles.success} aria-labelledby="companion-done">
          <div className={styles.successHead}>
            <CheckCircleIcon size={40} weight="fill" aria-hidden />
            <div>
              <h1 id="companion-done" className="h1">
                Объявление опубликовано
              </h1>
              <p className={styles.successText}>
                Об откликах «Я тоже» сообщим в уведомлениях. Нажмите «Собрать встречу», чтобы создать встречу
                с откликнувшимися участниками. Клубы видят направление, время и район поиска без имён и тоже
                могут предложить встречу.
              </p>
            </div>
          </div>
          <CompanionCard companion={created} />
          <div className={styles.formActions}>
            <Button variant="primary" size="lg" to="/companions">
              Посмотреть объявления
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setCreated(null);
                reset();
              }}
            >
              Написать ещё одно
            </Button>
          </div>
        </section>
      </div>
    );

  const problems = Object.values(validateCompanion(form)).filter(Boolean) as string[];

  return (
    <PersonalPage
      title="Новое объявление"
      description="Напишите, с кем и чем хотите заниматься. Те, кому по пути, откликнутся «Я тоже»."
      icon={<UsersThreeIcon size={28} />}
      summary={
        <>
          <strong>Что написать</strong>Вид спорта, удобное время и район. Детали обсудите с теми, кто
          откликнется.
        </>
      }
      actions={
        <Button variant="quiet" to="/companions" icon={<ArrowLeftIcon size={18} aria-hidden />}>
          Все объявления
        </Button>
      }
    >
      <div className={createStyles.page}>
        <div className={createStyles.top}>
          {formsOn && (
            <ModeSwitch
              value={mode}
              onChange={(m) => {
                setMode(m);
                setAssistantDown(false);
              }}
              label="Как заполнить объявление"
            />
          )}
          {restoredAt && (
            <div className={createStyles.notice} role="status">
              <ArrowCounterClockwiseIcon size={22} aria-hidden />
              <p className={createStyles.noticeText}>
                Вернули ваш черновик, сохранённый {formatAgo(restoredAt)}.
              </p>
              <Button variant="quiet" size="sm" onClick={reset}>
                Начать с чистого листа
              </Button>
            </div>
          )}
        </div>

        {mode === 'manual' ? (
          <div className={styles.createLayout}>
            <div className={styles.form}>
              {assistantDown && (
                <AssistantUnavailable>
                  Ваш текст перенесён в поле «Кого ищете». Остальные поля заполните сами.
                </AssistantUnavailable>
              )}
              <CompanionFields form={form} set={set} errors={errors} marks={marks} />
              <div className={styles.previewInline}>
                <p className={styles.caption}>Так объявление увидят другие</p>
                <CompanionCard companion={preview} preview />
              </div>
              <div className={styles.formActions}>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={publish}
                  loading={mutation.isPending}
                  loadingText="Публикуем…"
                >
                  Опубликовать
                </Button>
              </div>
            </div>
            <aside className={styles.createAside} aria-label="Предпросмотр объявления">
              <p className={styles.caption}>Так объявление увидят другие</p>
              <CompanionCard companion={preview} preview />
            </aside>
          </div>
        ) : (
          <CompanionAssistant
            form={form}
            base={base}
            set={set}
            setForm={setForm}
            state={assistant}
            setState={setAssistant}
            marks={marks}
            setMarks={(m) => {
              setMarks(m);
              setUsedAssistant(true);
            }}
            sports={sports}
            districts={districts.result.data}
            preview={preview}
            publishing={mutation.isPending}
            problems={problems}
            onPublish={publish}
            onManual={() => setMode('manual')}
            onFailed={(text) => {
              setForm((f) => ({ ...f, text: f.text.trim() ? f.text : text.trim() }));
              setMode('manual');
              setAssistantDown(true);
            }}
            onRestart={() => {
              setForm(base);
              setMarks({});
              setUsedAssistant(false);
              setErrors({});
              setAssistantState(EMPTY_ASSISTANT);
            }}
          />
        )}
      </div>
    </PersonalPage>
  );
}
