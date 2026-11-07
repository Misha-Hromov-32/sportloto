import {
  ArrowCounterClockwiseIcon,
  CopySimpleIcon,
  MagnifyingGlassIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useCreate, useOne, useUpdate } from '@refinedev/core';
import { App, Input, Modal } from 'antd';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import {
  AssistantUnavailable,
  AvatarStack,
  Button,
  ErrorState,
  EventStateBanner,
  GoneState,
  ModeSwitch,
  NoAccessState,
  PageHeader,
  PageSkeleton,
  type FillMode,
} from '@/components';
import { errorMessage, isSportSimilar, useAppealEvent, useMe, type ApiError } from '@/lib/api';
import { formatAgo, formatDuration, formatEventDate } from '@/lib/dates';
import { priceSummary } from '@/lib/money';
import { count, WORDS } from '@/lib/plural';
import type {
  CompanionView,
  EventDetails,
  Identity,
  OrganizerView,
  SportSuggestion,
  SportView,
} from '@/types/api';
import type { PlatformRule } from '@/types/domain';

import { useAiFeature } from '@/lib/aiFeatures';

import { AuthorPicker } from './create/AuthorPicker';
import styles from './create/create.module.css';
import { EventAssistant } from './create/EventAssistant';
import {
  EMPTY_ASSISTANT,
  EMPTY_FORM,
  firstStepWithError,
  fromEvent,
  fromQuery,
  priceOf,
  serverErrors,
  seriesCount,
  startsAtOf,
  toInput,
  toPatch,
  validateAll,
  type AssistantState,
  type EventForm,
  type FormErrors,
  type StepKey,
} from './create/model';
import { SuccessScreen } from './create/SuccessScreen';
import { useSportsCatalog } from './create/useSportsCatalog';
import { Wizard, type FieldChange } from './create/Wizard';
import { PersonalPage } from '../shared/PersonalPage';
// С11: «Создать похожее» и шаблоны в начале мастера
import { SimilarGate, type SimilarSource } from './create/templates/CreateSimilar';
import { TemplatePicker } from './create/templates/TemplatePicker';

export default function EventCreatePage() {
  const params = useParams();
  const [search] = useSearchParams();
  const editId = params.id ?? search.get('edit');
  const fromId = search.get('from'); // С11
  if (editId) return <EditEvent id={editId} />;
  if (fromId)
    return (
      <SimilarGate key={`${fromId}:${search.get('again')}`} id={fromId} again={search.get('again') === '1'}>
        {(source) => <CreateEvent similar={source} />}
      </SimilarGate>
    );
  return <CreateEvent />;
}

// ---------- Черновик ----------

interface StoredDraft {
  savedAt: string;
  mode: FillMode;
  step: StepKey;
  form: EventForm;
  marks: Record<string, string>;
  assistant: AssistantState;
  usedAssistant: boolean;
}

const draftKey = (userId: string) => `vmeste:event-draft:${userId}`;

function readDraft(userId: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as StoredDraft;
    if (!d?.form) return null;
    return { ...d, form: { ...EMPTY_FORM, ...d.form }, assistant: { ...EMPTY_ASSISTANT, ...d.assistant } };
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

function hasContent(form: EventForm): boolean {
  return Boolean(
    form.title.trim() ||
    form.sport ||
    form.newSportName ||
    form.description.trim() ||
    form.date ||
    form.address.trim(),
  );
}

/** Ошибка поля снимается, как только поле поправили. */
const ERROR_KEYS: Partial<Record<keyof EventForm, string[]>> = {
  sport: ['sport'],
  newSportName: ['sport'],
  date: ['date'],
  time: ['time', 'date'],
  priceKind: ['price'],
  priceAmount: ['price'],
  priceTotal: ['price'],
  capacity: ['capacity', 'minParticipants'],
  repeat: ['repeatUntil'],
};

function useFormState(initial: EventForm) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const set = useCallback((patch: Partial<EventForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const keys = Object.keys(patch).flatMap((k) => ERROR_KEYS[k as keyof EventForm] ?? [k]);
      if (!keys.some((k) => e[k])) return e;
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });
  }, []);
  return { form, setForm, set, errors, setErrors };
}

function organizerFor(me: Identity, orgId: string | null): OrganizerView {
  const org = me.orgs.find((o) => o.id === orgId);
  if (org)
    return {
      kind: 'org',
      id: org.id,
      name: org.name,
      avatarUrl: null,
      verified: org.status === 'approved',
      orgType: null,
      facts: { held: 0, cancelled: 0, upcoming: 0 },
      link: `/orgs/${org.id}`,
    };
  return {
    kind: 'user',
    id: me.id,
    name: me.name,
    avatarUrl: me.avatarUrl,
    verified: false,
    orgType: null,
    facts: { held: me.facts.held, cancelled: me.facts.cancelled, upcoming: me.facts.upcoming },
    link: `/profile/${me.id}`,
  };
}

// ---------- Создание ----------

interface Initial {
  base: EventForm;
  draft: StoredDraft | null;
  pendingSportId: string | null;
  fromQuery: boolean;
}

/** От имени организации можно только допущенной: чужой или недопущенный orgId из ссылки сбрасываем. */
const allowedOrg = (me: Identity, orgId: string | null) =>
  me.orgs.some((o) => o.id === orgId && o.status === 'approved') ? orgId : null;

function initialFor(me: Identity, search: URLSearchParams, similar?: SimilarSource): Initial {
  // С11: копия своей встречи — без черновика и без параметров из адреса
  if (similar)
    return {
      base: { ...similar.form, orgId: allowedOrg(me, similar.form.orgId) },
      draft: null,
      pendingSportId: null,
      fromQuery: false,
    };
  const q = fromQuery(search);
  const base = { ...EMPTY_FORM, ...q.patch, orgId: allowedOrg(me, q.patch.orgId ?? null) };
  const onlyOrg = Object.keys(q.patch).every((k) => k === 'orgId') && !q.sportId;
  if (!onlyOrg) return { base, draft: null, pendingSportId: q.sportId, fromQuery: true };
  const draft = readDraft(me.id);
  if (draft) draft.form.orgId = base.orgId ?? allowedOrg(me, draft.form.orgId);
  return {
    base,
    draft: draft && (hasContent(draft.form) || draft.assistant.text.trim()) ? draft : null,
    pendingSportId: null,
    fromQuery: false,
  };
}

function CreateEvent({ similar }: { similar?: SimilarSource }) {
  const { me, isLoading } = useMe();
  if (isLoading)
    return (
      <div className="container">
        <PageSkeleton label="Загружаем форму встречи…" />
      </div>
    );
  if (!me)
    return (
      <div className="container">
        <NoAccessState
          title="Войдите, чтобы создать встречу"
          actions={
            <Button variant="primary" to="/login?to=%2Fevents%2Fnew">
              Войти
            </Button>
          }
        />
      </div>
    );
  return <CreateEventForm key={me.id} user={me} similar={similar} />;
}

function CreateEventForm({ user, similar }: { user: Identity; similar?: SimilarSource }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { message } = App.useApp();
  const { sports } = useSportsCatalog();
  const [init] = useState(() => initialFor(user, search, similar));
  const [copiedFrom, setCopiedFrom] = useState(similar?.title ?? null); // С11
  const [templateUsed, setTemplateUsed] = useState(false); // С11
  const [base, setBase] = useState(init.base);
  const { form, setForm, set, errors, setErrors } = useFormState(init.draft?.form ?? init.base);
  const formsOn = useAiFeature('forms');
  const [chosenMode, setMode] = useState<FillMode>(init.draft?.mode ?? 'manual');
  const mode: FillMode = formsOn ? chosenMode : 'manual';
  const [step, setStep] = useState<StepKey>(init.draft?.step ?? 'what');
  const [marks, setMarks] = useState<Record<string, string>>(init.draft?.marks ?? {});
  const [assistant, setAssistantState] = useState<AssistantState>(init.draft?.assistant ?? EMPTY_ASSISTANT);
  const [usedAssistant, setUsedAssistant] = useState(init.draft?.usedAssistant ?? false);
  const [restoredAt, setRestoredAt] = useState<string | null>(init.draft?.savedAt ?? null);
  const [prefilled, setPrefilled] = useState(init.fromQuery);
  const [assistantDown, setAssistantDown] = useState(false);
  const [pendingSportId, setPendingSportId] = useState(init.pendingSportId);
  const [created, setCreated] = useState<{ event: EventDetails; meetings: number; gathered: number } | null>(
    null,
  );
  const [similarSports, setSimilarSports] = useState<SportSuggestion[] | null>(null);
  const { mutateAsync: createEvent, mutation } = useCreate<EventDetails>();

  const setAssistant = useCallback(
    (patch: Partial<AssistantState>) => setAssistantState((s) => ({ ...s, ...patch })),
    [],
  );

  const pendingSport = useOne<SportView>({
    resource: 'sports',
    id: pendingSportId ?? '',
    queryOptions: { enabled: Boolean(pendingSportId) },
  });
  useEffect(() => {
    const sport = pendingSport.result;
    if (!pendingSportId || !sport) return;
    setPendingSportId(null);
    setForm((f) => (f.sport ? f : { ...f, sport, newSportName: '' }));
    setBase((b) => ({ ...b, sport }));
  }, [pendingSport.result, pendingSportId, setForm]);

  const companion = useOne<CompanionView>({
    resource: 'companions',
    id: form.companionId ?? '',
    queryOptions: { enabled: Boolean(form.companionId) },
  });
  const companionView = form.companionId ? companion.result : undefined;
  const companionOk = Boolean(companionView?.isMine && companionView.status === 'open');

  useEffect(() => {
    if (created) return;
    const t = setTimeout(() => {
      if (hasContent(form) || assistant.text.trim())
        writeDraft(user.id, {
          savedAt: new Date().toISOString(),
          mode,
          step,
          form,
          marks,
          assistant,
          usedAssistant,
        });
    }, 400);
    return () => clearTimeout(t);
  }, [form, mode, step, marks, assistant, usedAssistant, created, user.id]);

  const organizer = useMemo(() => organizerFor(user, form.orgId), [user, form.orgId]);

  const reset = (keepOrg = true) => {
    const fresh = { ...EMPTY_FORM, orgId: keepOrg ? form.orgId : null };
    setForm(fresh);
    setBase(fresh);
    setErrors({});
    setMarks({});
    setAssistantState(EMPTY_ASSISTANT);
    setUsedAssistant(false);
    setStep('what');
    setRestoredAt(null);
    setPrefilled(false);
    setAssistantDown(false);
    setCopiedFrom(null); // С11
    setTemplateUsed(false);
    clearDraft(user.id);
  };

  const publish = async (override?: EventForm) => {
    const current = override ?? form;
    const errs = validateAll(current, { edit: false });
    if (Object.keys(errs).length) {
      setErrors(errs);
      if (mode === 'manual') setStep(firstStepWithError(errs) ?? 'review');
      message.error('Проверьте отмеченные поля');
      return;
    }
    try {
      const res = await createEvent({
        resource: 'events',
        values: toInput({ ...current, companionId: companionOk ? current.companionId : null }, usedAssistant),
        successNotification: false,
        errorNotification: false,
      });
      setCreated({
        event: res.data,
        meetings: seriesCount(form),
        gathered: companionOk ? (companionView?.metooCount ?? 0) : 0,
      });
      clearDraft(user.id);
      window.scrollTo({ top: 0 });
    } catch (error) {
      // Похожее направление (обычно черновик помощника): человек решает сам в окне выбора.
      if (isSportSimilar(error) && error.similar?.length) {
        setSimilarSports(error.similar);
        return;
      }
      const se = serverErrors((error as ApiError).errors as Record<string, string> | undefined);
      if (Object.keys(se).length) {
        setErrors(se);
        if (mode === 'manual') setStep(firstStepWithError(se) ?? step);
      }
      message.error(errorMessage(error, 'Не удалось опубликовать. Попробуйте ещё раз'));
    }
  };

  const chooseSimilar = (sport: SportSuggestion) => {
    const next = { ...form, sport, newSportName: '', confirmNewSport: false, extra: {} };
    setSimilarSports(null);
    set({ sport, newSportName: '', confirmNewSport: false, extra: {} });
    void publish(next);
  };

  const confirmNewSport = () => {
    const next = { ...form, confirmNewSport: true };
    setSimilarSports(null);
    set({ confirmNewSport: true });
    void publish(next);
  };

  if (created) {
    return (
      <div className="container">
        <SuccessScreen
          event={created.event}
          meetings={created.meetings}
          gathered={created.gathered}
          onAnother={() => {
            setCreated(null);
            reset();
            navigate('/events/new', { replace: true });
          }}
        />
      </div>
    );
  }

  const switchMode = (next: FillMode) => {
    setMode(next);
    setAssistantDown(false);
  };

  return (
    <PersonalPage
      title="Создать встречу"
      description={`Выберите занятие, место и время, остальное можно добавить потом.${formsOn ? ' Или расскажите помощнику своими словами.' : ''}`}
    >
      <div className={styles.page}>
        <div className={styles.top}>
          {formsOn && (
            <ModeSwitch value={mode} onChange={switchMode} label="Как заполнить карточку события" />
          )}
          <AuthorPicker me={user} value={form.orgId} onChange={(orgId) => set({ orgId })} />
          {restoredAt && (
            <div className={styles.notice} role="status">
              <ArrowCounterClockwiseIcon size={22} aria-hidden />
              <p className={styles.noticeText}>Вернули ваш черновик, сохранённый {formatAgo(restoredAt)}.</p>
              <Button variant="quiet" size="sm" onClick={() => reset(false)}>
                Начать с чистого листа
              </Button>
            </div>
          )}
          {prefilled && !form.companionId && (
            <div className={styles.notice} role="status">
              <MagnifyingGlassIcon size={22} aria-hidden />
              <p className={styles.noticeText}>Подставили то, что вы искали. Проверьте и дополните.</p>
              <Button variant="quiet" size="sm" onClick={() => setPrefilled(false)}>
                Понятно
              </Button>
            </div>
          )}
          {/* С11: копия своей встречи и шаблоны */}
          {copiedFrom && (
            <div className={styles.notice} role="status">
              <CopySimpleIcon size={22} aria-hidden />
              <p className={styles.noticeText}>
                Скопировали «{copiedFrom}» и поставили дату на неделю позже, время то же. Проверьте и
                опубликуйте.
              </p>
              <Button variant="quiet" size="sm" onClick={() => setCopiedFrom(null)}>
                Понятно
              </Button>
            </div>
          )}
          {mode === 'manual' &&
            step === 'what' &&
            !similar &&
            !restoredAt &&
            !prefilled &&
            !form.companionId &&
            (templateUsed || !hasContent(form)) && (
              <TemplatePicker
                sports={sports}
                onApply={(patch) => {
                  set(patch);
                  setTemplateUsed(true);
                }}
              />
            )}
          {form.companionId && (
            <CompanionNotice
              companion={companionView}
              loading={companion.query.isLoading}
              ok={companionOk}
              onUnlink={() => set({ companionId: null })}
            />
          )}
        </div>

        {mode === 'manual' ? (
          <Wizard
            form={form}
            set={set}
            errors={errors}
            setErrors={setErrors}
            step={step}
            setStep={setStep}
            organizer={organizer}
            marks={marks}
            submitting={mutation.isPending}
            submitLabel="Опубликовать"
            onSubmit={() => publish()}
            top={assistantDown ? <AssistantUnavailable /> : null}
          />
        ) : (
          <EventAssistant
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
            organizer={organizer}
            errors={{ ...validateAll(form, { edit: false }), ...errors }}
            publishing={mutation.isPending}
            onPublish={() => publish()}
            onManual={() => {
              setMode('manual');
              setStep('what');
            }}
            onFailed={(text) => {
              setForm((f) => ({
                ...f,
                description: f.description.includes(text.trim())
                  ? f.description
                  : [f.description.trim(), text.trim()].filter(Boolean).join('\n\n'),
              }));
              setMode('manual');
              setStep('what');
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
      <Modal
        open={similarSports !== null}
        title="Такое направление уже есть?"
        onCancel={() => setSimilarSports(null)}
        footer={null}
        destroyOnHidden
      >
        <p>
          В каталоге есть похожие направления. Выберите подходящее, чтобы вас легче было найти, или создайте «
          {form.newSportName}» как новое.
        </p>
        <div className={styles.similarChoices}>
          {(similarSports ?? []).slice(0, 3).map((s) => (
            <Button key={s.id} variant="secondary" onClick={() => chooseSimilar(s)}>
              Выбрать «{s.name}»
            </Button>
          ))}
          <Button variant="primary" onClick={confirmNewSport}>
            Создать «{form.newSportName}»
          </Button>
        </div>
      </Modal>
    </PersonalPage>
  );
}

function CompanionNotice({
  companion,
  loading,
  ok,
  onUnlink,
}: {
  companion: CompanionView | undefined;
  loading: boolean;
  ok: boolean;
  onUnlink: () => void;
}) {
  if (loading || !companion) return null;
  if (!ok)
    return (
      <div className={styles.notice} role="status">
        <WarningCircleIcon size={22} aria-hidden />
        <p className={styles.noticeText}>
          Объявление уже закрыто или собрано, поэтому участников из него не добавим. Встречу можно
          опубликовать как обычно.
        </p>
        <Button variant="quiet" size="sm" onClick={onUnlink}>
          Понятно
        </Button>
      </div>
    );
  return (
    <div className={styles.companion}>
      <UsersThreeIcon size={28} aria-hidden />
      <div className={styles.companionText}>
        <p className={styles.noticeTitle}>Собираете встречу по своему объявлению</p>
        <p className="text-2">
          {companion.metooCount > 0
            ? `${count(companion.metooCount, WORDS.person)} откликнулись. После публикации они сразу будут в списке участников и получат уведомление.`
            : 'Пока никто не откликнулся. Объявление закроется и превратится во встречу.'}
        </p>
      </div>
      {companion.metooPeople.length > 0 && <AvatarStack people={companion.metooPeople} />}
      <Button variant="quiet" size="sm" onClick={onUnlink}>
        Не связывать с объявлением
      </Button>
    </div>
  );
}

// ---------- Правка ----------

function EditEvent({ id }: { id: string }) {
  const { result: event, query } = useOne<EventDetails>({ resource: 'events', id });
  const ruleId = event?.moderation?.ruleId ?? null;
  const rule = useOne<PlatformRule>({
    resource: 'rules',
    id: ruleId ?? '',
    queryOptions: { enabled: Boolean(ruleId) },
  });

  if (query.isLoading)
    return (
      <div className="container">
        <PageSkeleton />
      </div>
    );
  if (query.isError || !event) {
    const code = (query.error as ApiError | null)?.code;
    return (
      <div className="container">
        {code === 'event_deleted' ? (
          <GoneState title="Событие удалено" actions={<Button to="/me">Мои занятия</Button>}>
            Его удалил модератор, изменить его нельзя.
          </GoneState>
        ) : code === 'not_found' ? (
          <GoneState title="Такого события нет" actions={<Button to="/me">Мои занятия</Button>}>
            Возможно, ссылка устарела. Свои события ищите в «Моих занятиях» на вкладке «Организую».
          </GoneState>
        ) : (
          <ErrorState layout="page" title="Не удалось открыть событие" onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }
  const header = (
    <PageHeader
      title="Изменить событие"
      context={event.title}
      back={{ to: `/events/${event.id}`, label: 'К событию' }}
    />
  );
  if (!event.can.manage)
    return (
      <div className="container">
        {header}
        <NoAccessState
          title="Изменять событие может только организатор"
          actions={<Button to={`/events/${event.id}`}>Открыть событие</Button>}
        >
          Если хотите что-то уточнить, задайте вопрос в обсуждении события.
        </NoAccessState>
      </div>
    );
  // Снятое модератором событие организатор исправляет и просит вернуть (домен это разрешает).
  const appealMode = event.state === 'removed' && event.can.appeal;
  if (appealMode)
    return (
      <EditForm
        key={event.id}
        event={event}
        appeal
        header={
          <>
            {header}
            <EventStateBanner
              state={event.state}
              cancelReason={event.cancelReason}
              moderation={event.moderation}
              rule={rule.result ?? null}
              isOrganizer
            />
          </>
        }
      />
    );
  if (event.state !== 'upcoming')
    return (
      <div className={['container', styles.page].join(' ')}>
        {header}
        <EventStateBanner
          state={event.state}
          cancelReason={event.cancelReason}
          moderation={event.moderation}
          rule={rule.result ?? null}
          isOrganizer
          actions={
            <>
              <Button variant="secondary" to="/events/new">
                Создать новое событие
              </Button>
              {event.state === 'removed' && (
                <Button variant="quiet" to="/rules">
                  Правила платформы
                </Button>
              )}
            </>
          }
        />
        <p className="text-2">
          {event.state === 'removed'
            ? 'Пока событие снято, изменить его нельзя.'
            : event.state === 'cancelled'
              ? 'Отменённое событие изменить нельзя. Создайте новое, если встреча всё-таки будет.'
              : 'Изменить можно только событие, которое ещё не началось.'}
        </p>
      </div>
    );
  return <EditForm key={event.id} event={event} header={header} />;
}

function changesBetween(o: EventForm, f: EventForm, confirmed: number): FieldChange[] {
  const out: FieldChange[] = [];
  const os = startsAtOf(o);
  const fs = startsAtOf(f);
  if (os !== fs)
    out.push({
      label: 'Время',
      from: os ? formatEventDate(os) : '—',
      to: fs ? formatEventDate(fs) : 'не указано',
    });
  if (o.durationMin !== f.durationMin)
    out.push({
      label: 'Длительность',
      from: formatDuration(o.durationMin),
      to: formatDuration(f.durationMin),
    });
  if (o.address.trim() !== f.address.trim())
    out.push({ label: 'Место', from: o.address, to: f.address.trim() || 'не указано' });
  if (o.capacity !== f.capacity)
    out.push({
      label: 'Мест',
      from: o.capacity ? String(o.capacity) : 'без ограничений',
      to: f.capacity ? String(f.capacity) : 'без ограничений',
    });
  if (o.joinMode !== f.joinMode)
    out.push({
      label: 'Запись',
      from: o.joinMode === 'open' ? 'свободная' : 'по заявке',
      to: f.joinMode === 'open' ? 'свободная' : 'по заявке',
    });
  const op = priceSummary(priceOf(o), confirmed, o.minParticipants).main;
  const fp = priceSummary(priceOf(f), confirmed, f.minParticipants).main;
  if (JSON.stringify(priceOf(o)) !== JSON.stringify(priceOf(f)))
    out.push({ label: 'Стоимость', from: op, to: fp });
  return out;
}

function EditForm({
  event,
  header,
  appeal = false,
}: {
  event: EventDetails;
  header: ReactNode;
  appeal?: boolean;
}) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [original] = useState(() => fromEvent(event));
  const { form, set, errors, setErrors } = useFormState(original);
  const [step, setStep] = useState<StepKey>('what');
  const { mutateAsync: update, mutation } = useUpdate<EventDetails>();
  const { appeal: sendAppeal, isPending: appealing } = useAppealEvent();
  const [appealComment, setAppealComment] = useState('');
  const { me } = useMe();
  const changes = changesBetween(original, form, event.counts.confirmed);
  const participants = event.counts.confirmed + event.counts.pending + event.counts.waitlist;

  const save = async () => {
    const errs = validateAll(form, { edit: true });
    if (Object.keys(errs).length) {
      setErrors(errs);
      setStep(firstStepWithError(errs) ?? 'review');
      message.error('Проверьте отмеченные поля');
      return;
    }
    try {
      await update({
        resource: 'events',
        id: event.id,
        values: toPatch(form),
        successNotification: false,
        errorNotification: false,
      });
      if (appeal) {
        await sendAppeal(event.id, appealComment.trim(), { silent: true });
        message.success('Исправления сохранены и отправлены администратору на повторную проверку');
        navigate(`/events/${event.id}/manage`);
        return;
      }
      message.success(
        changes.length && participants
          ? 'Изменения сохранены. Участники получили уведомление'
          : 'Изменения сохранены',
      );
      navigate(`/events/${event.id}`);
    } catch (error) {
      const se = serverErrors((error as ApiError).errors as Record<string, string> | undefined);
      if (Object.keys(se).length) {
        setErrors(se);
        setStep(firstStepWithError(se) ?? step);
      }
      message.error(errorMessage(error, 'Не удалось сохранить. Попробуйте ещё раз'));
    }
  };

  return (
    <div className="container">
      {header}
      <div className={styles.page}>
        {me && <AuthorPicker me={me} value={form.orgId} onChange={() => undefined} locked />}
        {appeal && (
          <label className={styles.appealNote}>
            <span>Что вы исправили (необязательно). Администратор увидит это вместе с карточкой</span>
            <Input.TextArea
              value={appealComment}
              onChange={(e) => setAppealComment(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 5 }}
              maxLength={500}
              placeholder="Например: убрал ссылку на сторонний сайт и уточнил место встречи"
            />
          </label>
        )}
        <Wizard
          form={form}
          set={set}
          errors={errors}
          setErrors={setErrors}
          step={step}
          setStep={setStep}
          organizer={event.organizerView}
          edit
          counts={event.counts}
          changes={changes}
          participants={participants}
          submitting={mutation.isPending || appealing}
          submitLabel={appeal ? 'Сохранить и попросить вернуть' : 'Сохранить изменения'}
          onSubmit={save}
        />
      </div>
    </div>
  );
}
