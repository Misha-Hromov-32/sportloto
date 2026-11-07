import { CheckIcon } from '@phosphor-icons/react';
import { Checkbox, Input } from 'antd';
import { useId } from 'react';

import { PARTICIPATION_STATUS_FOR_ORGANIZER } from '@/lib/labels';
import { formatEventDate } from '@/lib/dates';
import type { StopOwnerKey, StopPreview } from '@/types/api';

import { STOP_REASONS, STOP_TERMS, firstName } from './stopApi';
import type { StopDraft, StopErrors } from './stopDraft';
import styles from './StopList.module.css';

interface StopFieldsProps {
  owner: StopOwnerKey;
  preview: StopPreview;
  draft: StopDraft;
  errors: StopErrors;
  onChange: (next: StopDraft) => void;
  /** Эту встречу не считаем среди «других предстоящих»: человека и так убирают из неё. */
  exceptEventId?: string;
}

/** Причина, заметка, срок и отмена записей — общие для «Не пускать» и «Убрать из участников». */
export function StopFields({ owner, preview, draft, errors, onChange, exceptEventId }: StopFieldsProps) {
  const id = useId();
  const set = (patch: Partial<StopDraft>) => onChange({ ...draft, ...patch });
  const upcoming = preview.upcoming.filter((u) => u.eventId !== exceptEventId);
  const name = firstName(preview.user.name);
  const club = owner.startsWith('org:');

  return (
    <div className={styles.fields}>
      <fieldset
        className={styles.fieldset}
        aria-describedby={errors.reasonCode ? `${id}-reason-error` : undefined}
      >
        <legend className={styles.legend}>Почему</legend>
        <div className={styles.options}>
          {STOP_REASONS.map((r) => (
            <OptionCard
              key={r.value}
              name={`${id}-reason`}
              checked={draft.reasonCode === r.value}
              onSelect={() => set({ reasonCode: r.value })}
            >
              {r.label}
            </OptionCard>
          ))}
        </div>
        {errors.reasonCode && (
          <p id={`${id}-reason-error`} className={styles.error} role="alert">
            {errors.reasonCode}
          </p>
        )}
      </fieldset>

      {draft.reasonCode === 'other' && (
        <div>
          <label htmlFor={`${id}-other`} className={styles.label}>
            Ваша причина
          </label>
          <Input.TextArea
            id={`${id}-other`}
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={200}
            value={draft.reasonText}
            onChange={(ev) => set({ reasonText: ev.target.value })}
            placeholder="Например, приводит детей на взрослую тренировку"
            status={errors.reasonText ? 'error' : undefined}
            aria-describedby={errors.reasonText ? `${id}-other-error` : undefined}
            autoFocus
          />
          {errors.reasonText && (
            <p id={`${id}-other-error`} className={styles.error} role="alert">
              {errors.reasonText}
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor={`${id}-note`} className={styles.label}>
          Заметка <span className={styles.optional}>необязательно</span>
        </label>
        <Input.TextArea
          id={`${id}-note`}
          autoSize={{ minRows: 2, maxRows: 4 }}
          maxLength={300}
          value={draft.note}
          onChange={(ev) => set({ note: ev.target.value })}
          placeholder="Например, три раза записывался и не пришёл"
          status={errors.note ? 'error' : undefined}
          aria-describedby={`${id}-note-hint${errors.note ? ` ${id}-note-error` : ''}`}
        />
        <p id={`${id}-note-hint`} className={styles.hint}>
          {club ? 'Для вас и соуправляющих, человек её не увидит.' : 'Только для вас, человек её не увидит.'}
        </p>
        {errors.note && (
          <p id={`${id}-note-error`} className={styles.error} role="alert">
            {errors.note}
          </p>
        )}
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Срок</legend>
        <div className={[styles.options, styles.optionsTerm].join(' ')}>
          {STOP_TERMS.map((t) => (
            <OptionCard
              key={t.value}
              name={`${id}-term`}
              checked={draft.term === t.value}
              onSelect={() => set({ term: t.value })}
            >
              {t.label}
            </OptionCard>
          ))}
        </div>
      </fieldset>

      {upcoming.length > 0 && (
        <div className={styles.cancelBox}>
          <Checkbox
            checked={draft.cancelUpcoming}
            onChange={(ev) => set({ cancelUpcoming: ev.target.checked })}
          >
            <span className={styles.checkLabel}>
              Отменить его записи на {exceptEventId ? 'другие ' : ''}
              {club ? 'предстоящие встречи клуба' : 'мои предстоящие встречи'} ({upcoming.length})
            </span>
          </Checkbox>
          <ul className={styles.upcoming}>
            {upcoming.map((u) => (
              <li key={u.eventId}>
                «{u.title}», {formatEventDate(u.startsAt).toLowerCase()}:{' '}
                {PARTICIPATION_STATUS_FOR_ORGANIZER[u.status].label.toLowerCase()}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className={styles.notice}>
        {name} получит уведомление и увидит причину. Заметку{' '}
        {club ? 'видите только вы и команда клуба' : 'видите только вы'}.
      </p>
    </div>
  );
}

function OptionCard({
  name,
  checked,
  onSelect,
  children,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: string;
}) {
  return (
    <label className={[styles.option, checked && styles.optionOn].filter(Boolean).join(' ')}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className={styles.radio} />
      <span className={styles.mark} aria-hidden>
        {checked && <CheckIcon size={16} weight="bold" />}
      </span>
      <span className={styles.optionText}>{children}</span>
    </label>
  );
}
