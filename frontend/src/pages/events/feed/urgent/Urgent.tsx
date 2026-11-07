import { LightningIcon, MedalMilitaryIcon } from '@phosphor-icons/react';
import { useList } from '@refinedev/core';

import { cityLocationFilters } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { EventView } from '@/types/api';

import styles from '../Feed.module.css';
import { FeedCard, Tag } from '../FeedCard';
import { isOpenForFeed } from '../filters';
import { FeedBlock } from '../Sections';
import own from './urgent.module.css';

/** С3: метка «Срочно: нужно N» на карточке события. */
export function UrgentTag({ event }: { event: EventView }) {
  if (!event.urgent) return null;
  return (
    <Tag tone="danger" icon={<LightningIcon size={14} weight="fill" aria-hidden />}>
      Срочно: нужно {event.urgent.need}
    </Tag>
  );
}

/** Н2: метка программы на карточке события. */
export function ProgramTag({ event }: { event: EventView }) {
  if (!event.program) return null;
  return (
    <Tag tone="plain" icon={<MedalMilitaryIcon size={16} aria-hidden />}>
      {event.program.label}
    </Tag>
  );
}

/** С3: вверху ленты — встречи ближайших двух суток, которым срочно нужны игроки. */
export function UrgentBlock() {
  const city = useSelectedCity();
  const { result, query } = useList<EventView>({
    resource: 'events',
    filters: [{ field: 'urgent', operator: 'nnull', value: true }, ...cityLocationFilters(city)],
    pagination: { currentPage: 1, pageSize: 6, mode: 'server' },
  });
  const events = (result.data ?? []).filter((e) => isOpenForFeed(e) && e.urgent && !e.isOrganizer);
  if (query.isLoading || query.isError || !events.length) return null;
  return (
    <FeedBlock
      id="urgent"
      title="Срочно нужны игроки"
      count={result.total ?? events.length}
      lead={
        <p className={own.lead}>
          <LightningIcon size={18} weight="fill" aria-hidden className={own.icon} />
          Встреча скоро, а людей не хватает. Метка пропадёт, когда состав наберётся.
        </p>
      }
    >
      <ul className={styles.grid}>
        {events.slice(0, 3).map((e) => (
          <li key={e.id} className={styles.cell}>
            <FeedCard event={e} />
          </li>
        ))}
      </ul>
    </FeedBlock>
  );
}
