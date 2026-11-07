import { CheckIcon, SparkleIcon } from '@phosphor-icons/react';
import { useCustom, useUpdate, type HttpError } from '@refinedev/core';
import { App, Checkbox, Input } from 'antd';
import { useId, useState } from 'react';

import { Avatar, Button } from '@/components';
import { errorMessage, useAction, type ApiError } from '@/lib/api';
import type { Identity } from '@/types/api';
import type { SkillLevel } from '@/types/domain';
import type { ProfilePatch } from '@/types/inputs';

import { LEVEL_WORDS } from './levels';
import styles from './VkImport.module.css';

/** Что сайт нашёл на странице ВКонтакте. Ничего не сохраняется без «Перенести в анкету». */
interface VkPreview {
  name: string;
  link: string;
  closed: boolean;
  city: string | null;
  about: string;
  sports: { sportId: string; name: string; why: string; suggested?: boolean }[];
  /** Сколько последних записей со стены посмотрели. */
  posts: number;
  level: SkillLevel | null;
  photo: string | null;
  source: 'rules' | 'model';
}

interface Props {
  me: Identity;
  /** Виды спорта, уже выбранные в анкете. */
  interests: () => string[];
  /** Перенести в поля анкеты; сохранит человек кнопкой «Сохранить профиль». */
  onApply: (patch: { about?: string; interests: string[]; levels: Record<string, SkillLevel> }) => void;
}

const VK_API = { status: '/profile/vk', preview: '/profile/vk/preview' } as const;

/** «Заполнить из ВКонтакте»: ссылка на страницу → что нашли → человек сам выбирает, что перенести. */
export function VkImport({ me, interests, onApply }: Props) {
  const titleId = useId();
  const { message } = App.useApp();
  const status = useCustom<{ enabled: boolean }>({
    url: VK_API.status,
    method: 'get',
    queryOptions: { retry: false, staleTime: 300_000 },
  });
  const { run, isPending } = useAction();
  const { mutateAsync: update, mutation } = useUpdate<
    Identity,
    HttpError,
    ProfilePatch & { avatarUrl: string }
  >();
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<VkPreview | null>(null);
  const [about, setAbout] = useState('');
  const [takeAbout, setTakeAbout] = useState(true);
  const [takePhoto, setTakePhoto] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  if (!(status.result.data as { enabled?: boolean } | undefined)?.enabled) return null;

  const search = async () => {
    setError(null);
    setDone(false);
    try {
      const res = (await run(VK_API.preview, { link }, { silent: true })) as unknown as VkPreview;
      setFound(res);
      setAbout(res.about);
      setTakeAbout(Boolean(res.about));
      setTakePhoto(Boolean(res.photo));
      setPicked(res.sports.map((s) => s.sportId));
    } catch (e) {
      const field = (e as ApiError).errors as Record<string, string> | undefined;
      setError(field?.link ?? errorMessage(e, 'Не получилось открыть страницу. Попробуйте ещё раз'));
    }
  };

  const apply = async () => {
    if (!found) return;
    const current = interests();
    const added = picked.filter((id) => !current.includes(id));
    onApply({
      ...(takeAbout && about.trim() ? { about: about.trim().slice(0, 500) } : {}),
      interests: [...current, ...added],
      levels: Object.fromEntries(added.map((id) => [id, found.level ?? 'beginner'])),
    });
    if (takePhoto && found.photo) {
      try {
        await update({
          resource: 'users',
          id: me.id,
          values: { avatarUrl: found.photo },
          successNotification: false,
          errorNotification: false,
        });
      } catch (e) {
        setError(errorMessage(e, 'Фото не получилось сохранить. Остальное перенесли'));
      }
    }
    setDone(true);
    message.success('Перенесли. Проверьте анкету и нажмите «Сохранить профиль»');
  };

  return (
    <section className={styles.box} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.title}>
        Заполнить из ВКонтакте
      </h3>
      <p className={styles.hint}>
        Вставьте ссылку на свою страницу. Мы посмотрим открытые сведения: фото, «о себе», интересы и 10
        последних записей на стене, и подберём виды спорта. Записи не сохраняем. Вы сами выберете, что
        перенести.
      </p>
      <div className={styles.row}>
        <Input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onPressEnter={(e) => {
            e.preventDefault();
            void search();
          }}
          placeholder="vk.com/ваше_имя"
          aria-label="Ссылка на страницу ВКонтакте"
          inputMode="url"
          autoComplete="url"
        />
        <Button
          variant="secondary"
          onClick={() => void search()}
          loading={isPending}
          loadingText="Ищем…"
          disabled={!link.trim()}
        >
          Найти страницу
        </Button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {found && (
        <div className={styles.preview} aria-live="polite">
          <div className={styles.who}>
            <Avatar name={found.name} initials={found.name.slice(0, 1)} src={found.photo} size={56} />
            <div>
              <strong>{found.name}</strong>
              <span>{[found.city, found.link.replace('https://', '')].filter(Boolean).join(' · ')}</span>
            </div>
          </div>
          {found.closed && (
            <p className={styles.note}>
              Страница закрыта: видны только имя и фото. Остальное заполните сами.
            </p>
          )}
          {found.photo && (
            <Checkbox checked={takePhoto} onChange={(e) => setTakePhoto(e.target.checked)}>
              Взять фото со страницы
            </Checkbox>
          )}
          {found.about ? (
            <div className={styles.field}>
              <Checkbox checked={takeAbout} onChange={(e) => setTakeAbout(e.target.checked)}>
                Взять текст «О себе»
              </Checkbox>
              <Input.TextArea
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                rows={3}
                maxLength={500}
                disabled={!takeAbout}
                aria-label="Текст о себе со страницы"
              />
            </div>
          ) : (
            !found.closed && <p className={styles.note}>Текста о себе на странице нет.</p>
          )}
          {found.sports.length > 0 ? (
            <div className={styles.field}>
              <p className={styles.label}>
                Виды спорта{found.level ? `, уровень: ${LEVEL_WORDS[found.level].label.toLowerCase()}` : ''}
              </p>
              <p className={styles.note}>
                {found.posts > 0
                  ? `Посмотрели последние записи на стене: ${found.posts}.`
                  : 'Записей на стене нет или они скрыты.'}
              </p>
              <ul className={styles.sports}>
                {found.sports.map((s) => {
                  const on = picked.includes(s.sportId);
                  return (
                    <li key={s.sportId}>
                      <button
                        type="button"
                        aria-pressed={on}
                        className={styles.sport}
                        onClick={() =>
                          setPicked((p) => (on ? p.filter((id) => id !== s.sportId) : [...p, s.sportId]))
                        }
                      >
                        {on && <CheckIcon size={16} weight="bold" aria-hidden />}
                        {s.name}
                        {s.suggested && <span className={styles.advice}>совет</span>}
                      </button>
                      <small>{s.why}</small>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            !found.closed && (
              <p className={styles.note}>Видов спорта на странице не нашли. Выберите их ниже.</p>
            )
          )}
          {found.source === 'model' && (
            <p className={styles.note}>
              <SparkleIcon size={16} weight="fill" aria-hidden /> Текст и виды спорта подобрал помощник.
              Проверьте их.
            </p>
          )}
          <div className={styles.row}>
            <Button
              variant="primary"
              onClick={() => void apply()}
              loading={mutation.isPending}
              disabled={done}
            >
              {done ? 'Перенесено' : 'Перенести в анкету'}
            </Button>
            <Button variant="quiet" onClick={() => setFound(null)}>
              Не переносить
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
