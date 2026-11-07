import { CheckIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { App, Switch } from 'antd';
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Button, Chip, ErrorState, SkeletonText } from '@/components';
import { DIGEST_API, useAction, useLiveGet } from '@/lib/api';
import { cityByName } from '@/lib/cities';
import { formatAgo } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import type { DigestSendResult, DigestSettings, DigestSettingsInput } from '@/types/api';

import pageStyles from '../SettingsPage.module.css';
import styles from './digest.module.css';

const HOUR_LABEL: Record<number, string> = {
  8: 'Утром, в 8:00',
  12: 'Днём, в 12:00',
  18: 'Вечером, в 18:00',
};

function Row({
  title,
  text,
  control,
}: {
  title: string;
  text: ReactNode;
  control: (ids: { title: string; text: string }) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={pageStyles.toggle}>
      <div className={pageStyles.toggleText}>
        <span id={`${id}-title`} className={pageStyles.toggleTitle}>
          {title}
        </span>
        <span id={`${id}-text`} className={pageStyles.toggleHint}>
          {text}
        </span>
      </div>
      {control({ title: `${id}-title`, text: `${id}-text` })}
    </div>
  );
}

/** Подборка дня: раз в день три подходящие встречи. Настройки хранятся в профиле, а не на устройстве. */
export function DigestSection() {
  const { message } = App.useApp();
  const { data, isLoading, isError, refetch } = useLiveGet<DigestSettings>(DIGEST_API.settings, [
    'users',
    'notifications',
  ]);
  const save = useAction<DigestSettings>();
  const groupId = useId();
  const send = useAction<DigestSendResult>();

  if (isLoading) return <SkeletonText lines={4} />;
  if (isError || !data)
    return (
      <ErrorState
        layout="inline"
        title="Не удалось открыть настройки подборки"
        onRetry={() => void refetch()}
      >
        Проверьте интернет и нажмите «Повторить».
      </ErrorState>
    );

  const update = async (patch: DigestSettingsInput) => {
    await save
      .run(DIGEST_API.settings, patch as Record<string, unknown>, { method: 'put' })
      .catch(() => null);
    void refetch();
  };

  const sendNow = async () => {
    const result = await send.run(DIGEST_API.sendNow).catch(() => null);
    if (!result) return;
    if (result.sent) message.success(result.message);
    else message.info(result.message);
    void refetch();
  };

  const cityIn = cityByName(data.cityName)?.in;

  return (
    <>
      <p className={pageStyles.sectionIntro}>
        Раз в день пришлём три встречи рядом, которые вам подходят: по интересам, району и удобному времени.
        Настройки хранятся в профиле и действуют на всех устройствах.
      </p>
      <div className={pageStyles.toggles}>
        <Row
          title="Присылать подборку встреч раз в день"
          text="Если подходящих встреч нет, подборка не придёт. Одни и те же встречи не повторяются."
          control={(ids) => (
            <Switch
              checked={data.on}
              loading={save.isPending}
              onChange={(on) => void update({ on })}
              aria-labelledby={ids.title}
              aria-describedby={ids.text}
            />
          )}
        />
      </div>

      <div
        className={[styles.group, !data.on && styles.off].filter(Boolean).join(' ')}
        role="group"
        aria-labelledby={`${groupId}-hours`}
      >
        <p id={`${groupId}-hours`} className={styles.legend}>
          Во сколько присылать
        </p>
        <p className={styles.hint}>{cityIn ? `По местному времени в ${cityIn}.` : 'По местному времени.'}</p>
        <div className={styles.chips}>
          {data.hours.map((h) => (
            <Chip
              key={h}
              selected={data.hour === h}
              disabled={!data.on}
              onClick={() => data.hour !== h && void update({ hour: h })}
            >
              {HOUR_LABEL[h] ?? `${h}:00`}
            </Chip>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <p className={styles.legend}>Куда присылать</p>
        <div className={pageStyles.toggles}>
          <Row
            title="На сайте"
            text="В разделе «Уведомления». Так подборка приходит всегда."
            control={() => (
              <span className={styles.always}>
                <CheckIcon size={18} weight="bold" aria-hidden />
                Всегда
              </span>
            )}
          />
          <Row
            title="На почту"
            text={
              data.emailAllowed
                ? `Копия придёт на ${data.emailAddress}. В каждом письме есть ссылка «Отписаться».`
                : data.emailReason
            }
            control={(ids) => (
              <Switch
                checked={data.email}
                disabled={!data.on || !data.emailAllowed}
                loading={save.isPending}
                onChange={(email) => void update({ email })}
                aria-labelledby={ids.title}
                aria-describedby={ids.text}
              />
            )}
          />
        </div>
      </div>

      <div className={styles.now}>
        <Button
          variant="secondary"
          icon={<PaperPlaneTiltIcon size={18} aria-hidden />}
          loading={send.isPending}
          loadingText="Собираем подборку…"
          onClick={() => void sendNow()}
        >
          Прислать подборку сейчас
        </Button>
        {data.last ? (
          <p className={styles.last}>
            Последняя подборка: {formatAgo(data.last.createdAt)}, {count(data.last.count, WORDS.meeting)}.{' '}
            <Link to={`/digest/${data.last.id}`}>Открыть</Link>
          </p>
        ) : (
          <p className={styles.last}>
            Подборок пока не было. Нажмите кнопку, чтобы посмотреть, как это выглядит.
          </p>
        )}
      </div>
    </>
  );
}
