import { ArrowSquareOutIcon, CaretDownIcon, MapPinIcon, NavigationArrowIcon } from '@phosphor-icons/react';
import { useDataProvider } from '@refinedev/core';
import { useQuery } from '@tanstack/react-query';
import { App, Modal, Segmented, Select } from 'antd';
import { useState } from 'react';

import { Button, Chip, ErrorState, SkeletonBlock } from '@/components';
import { API, useAction } from '@/lib/api';
import { ACCESS_FEATURES, VENUE_FEATURE } from '@/lib/venues';
import type {
  BestPlaceInput,
  BestPlaceNeeds,
  BestPlaceOption,
  BestPlaceResult,
  EventDetails,
} from '@/types/api';
import type { VenueFeature } from '@/types/domain';

import { FeatureTags } from '../../../venues/parts/features';
import { FEATURE_ICON } from '../../../venues/parts/icons';
import styles from './bestplace.module.css';

type Mode =
  { kind: 'move'; event: EventDetails } | { kind: 'pick'; onPick: (option: BestPlaceOption) => void };

interface BestPlaceDialogProps {
  open: boolean;
  onClose: () => void;
  /** Кого и на какое время считаем: событие или объявление «Ищу компанию». */
  input: Omit<BestPlaceInput, 'needs'>;
  mode: Mode;
}

const PRICE_OPTIONS = [
  { value: 0, label: 'Любая аренда' },
  { value: 1000, label: 'До 1 000 ₽ в час' },
  { value: 2000, label: 'До 2 000 ₽ в час' },
  { value: 3000, label: 'До 3 000 ₽ в час' },
];

const km = (value: number) => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}\u00A0км`;
const people = (n: number) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} человек`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} человека`;
  return `${n} человек`;
};

/**
 * В5: «Подобрать место для всех». Считаем по районам участников (центр района), отбираем площадки
 * по обязательным условиям и показываем три варианта с объяснением. Решает организатор.
 */
export function BestPlaceDialog({ open, onClose, input, mode }: BestPlaceDialogProps) {
  const getDataProvider = useDataProvider();
  const { modal, message } = App.useApp();
  const { run, isPending } = useAction();
  const hasTime = Boolean(input.startsAt || input.eventId);
  const [features, setFeatures] = useState<VenueFeature[]>([]);
  const [indoor, setIndoor] = useState<'any' | 'in' | 'out'>('any');
  const [priceMax, setPriceMax] = useState(0);
  const [freeAtTime, setFreeAtTime] = useState(hasTime);

  const needs: BestPlaceNeeds = {
    features,
    indoor: indoor === 'any' ? null : indoor === 'in',
    priceMax: priceMax || null,
    freeAtTime: hasTime && freeAtTime,
  };
  const query = useQuery({
    queryKey: ['venues', 'best-place', JSON.stringify(input), JSON.stringify(needs)],
    queryFn: async () => {
      const { custom } = getDataProvider();
      if (!custom) throw new Error('Подбор места сейчас недоступен');
      const res = await custom<BestPlaceResult>({
        url: API.bestPlace,
        method: 'post',
        payload: { ...input, needs },
      });
      return res.data;
    },
    enabled: open,
  });
  const result = query.data;

  const toggleFeature = (f: VenueFeature) =>
    setFeatures((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const move = (option: BestPlaceOption) => {
    if (mode.kind !== 'move') return;
    const e = mode.event;
    modal.confirm({
      title: `Перенести встречу в «${option.venue.name}»?`,
      content: (
        <div className={styles.confirm}>
          <p>
            Было: {e.place.address}
            <br />
            Станет: {option.venue.address}
          </p>
          <p>
            Участники получат уведомление, что было и что стало, и подтвердят, что в курсе. Время и цена
            участия не меняются: если аренда другая, поправьте цену в «Изменить».
          </p>
        </div>
      ),
      okText: 'Перенести встречу',
      cancelText: 'Не переносить',
      onOk: async () => {
        try {
          await run(API.moveToVenue(e.id), { venueId: option.venue.id }, { silent: true });
          message.success('Встреча перенесена. Участники получат уведомление');
          onClose();
        } catch (error) {
          message.error((error as Error)?.message || 'Не получилось перенести. Попробуйте ещё раз');
          throw error;
        }
      },
    });
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={820}
      title="Подобрать место для всех"
      destroyOnHidden
      className={styles.modal}
    >
      <div className={styles.body}>
        <section className={styles.who} aria-label="Кого учитываем">
          <p>
            Расстояние указано по прямой от центра района, выбранного в профиле каждого участника. Время в
            пути не рассчитывается. Точные домашние адреса не используются.
          </p>
          {result && result.groups.length > 0 && (
            <p className={styles.groups}>
              <MapPinIcon size={18} aria-hidden />
              <span>
                Учли {people(result.counted)}:{' '}
                {result.groups.map((g) => `${g.districtName} — ${g.people}`).join(', ')}.
                {result.withoutDistrict > 0 && (
                  <span className={styles.muted}>
                    {' '}
                    Без района в профиле: {result.withoutDistrict}, их не учли.
                  </span>
                )}
              </span>
            </p>
          )}
        </section>

        <section className={styles.needs} aria-label="Обязательные условия">
          <p className={styles.label}>Что обязательно</p>
          <div className={styles.chips} role="group" aria-label="Доступная среда">
            {ACCESS_FEATURES.map((f) => {
              const I = FEATURE_ICON[f];
              return (
                <Chip
                  key={f}
                  selected={features.includes(f)}
                  icon={<I size={18} aria-hidden />}
                  onClick={() => toggleFeature(f)}
                >
                  {VENUE_FEATURE[f].label}
                </Chip>
              );
            })}
          </div>
          <div className={styles.row}>
            <Segmented<'any' | 'in' | 'out'>
              aria-label="Крытая или открытая"
              value={indoor}
              onChange={setIndoor}
              options={[
                { value: 'any', label: 'Не важно' },
                { value: 'in', label: 'Крытая' },
                { value: 'out', label: 'Открытая' },
              ]}
            />
            <Select
              value={priceMax}
              onChange={setPriceMax}
              options={PRICE_OPTIONS}
              aria-label="Аренда за час"
              className={styles.select}
            />
            {hasTime && (
              <Chip selected={freeAtTime} onClick={() => setFreeAtTime((v) => !v)}>
                Свободно в это время
              </Chip>
            )}
          </div>
        </section>

        <section aria-live="polite" aria-busy={query.isFetching} className={styles.results}>
          {query.isLoading ? (
            <div className={styles.skeletons} role="status">
              <span className="sr-only">Подбираем места…</span>
              <SkeletonBlock height={132} />
              <SkeletonBlock height={132} />
              <SkeletonBlock height={132} />
            </div>
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()}>
              {(query.error as Error)?.message || 'Не удалось подобрать место. Попробуйте ещё раз.'}
            </ErrorState>
          ) : !result || result.options.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Подходящих площадок нет</p>
              <p>{result?.relax ?? 'Уберите одно из условий, и варианты появятся.'}</p>
            </div>
          ) : (
            <ol className={styles.options}>
              {result.options.map((o, i) => (
                <li key={o.venue.id} className={styles.option}>
                  <div className={styles.optionHead}>
                    <div className={styles.optionTitle}>
                      <a
                        href={`/venues/${o.venue.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.name}
                      >
                        {o.venue.name}
                        <ArrowSquareOutIcon size={16} aria-hidden />
                        <span className="sr-only">(в новой вкладке)</span>
                      </a>
                      <span className={styles.muted}>
                        {o.venue.address}
                        {o.venue.districtName && `, район ${o.venue.districtName}`}
                      </span>
                    </div>
                  </div>
                  {o.badges.length > 0 && (
                    <ul className={styles.badges}>
                      {o.badges.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                  <p className={styles.summary}>{capitalizeFirst(o.summary)}.</p>
                  <FeatureTags features={o.venue.features} onlyAccess max={4} />
                  <details className={styles.details}>
                    <summary>
                      <CaretDownIcon size={16} aria-hidden />
                      Расстояние для каждого района
                    </summary>
                    <ul>
                      {o.distances.map((d) => (
                        <li key={d.districtId}>
                          <NavigationArrowIcon size={14} aria-hidden />
                          {d.districtName} ({people(d.people)}): {km(d.km)}
                        </li>
                      ))}
                    </ul>
                  </details>
                  <div className={styles.actions}>
                    {mode.kind === 'move' ? (
                      o.isCurrent ? (
                        <p className={styles.current}>Встреча уже здесь</p>
                      ) : (
                        <Button
                          variant={i === 0 ? 'primary' : 'secondary'}
                          loading={isPending}
                          onClick={() => move(o)}
                        >
                          Перенести встречу сюда
                        </Button>
                      )
                    ) : (
                      <Button
                        variant={i === 0 ? 'primary' : 'secondary'}
                        onClick={() => {
                          mode.onPick(o);
                          onClose();
                        }}
                      >
                        Выбрать
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {result && result.options.length > 0 && result.matched > result.options.length && (
            <p className={styles.muted}>
              Других вариантов: {result.matched - result.options.length}. Выше показаны три с наименьшим
              средним расстоянием от участников.
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}

function capitalizeFirst(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
