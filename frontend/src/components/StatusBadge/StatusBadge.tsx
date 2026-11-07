import {
  EVENT_STATE,
  MESSAGE_HIDDEN,
  ORG_STATUS,
  PARTICIPATION_STATUS,
  PARTICIPATION_STATUS_FOR_ORGANIZER,
  type StatusMeta,
} from '@/lib/labels';
import type { EventState, OrgStatus, ParticipationStatus } from '@/types/domain';

import { STATUS_ICONS } from '../icons';
import styles from './StatusBadge.module.css';

type Props =
  | {
      kind: 'participation';
      status: ParticipationStatus;
      audience?: 'self' | 'organizer';
      waitlistPosition?: number | null;
    }
  | { kind: 'event'; status: EventState }
  | { kind: 'org'; status: OrgStatus }
  | { kind: 'message-hidden' }
  | { kind: 'custom'; meta: StatusMeta };

interface StatusBadgeProps {
  size?: 'md' | 'lg';
  /** Короткая вспышка фона при смене статуса — чтобы заметить живое обновление. */
  flash?: boolean;
}

/** Статус всегда словами, с иконкой; цвет только подкрепляет. */
export function StatusBadge(props: Props & StatusBadgeProps) {
  const meta = resolve(props);
  const Icon = STATUS_ICONS[meta.icon];
  const label =
    props.kind === 'participation' && props.status === 'waitlist' && props.waitlistPosition
      ? `${meta.label}, ${props.waitlistPosition}-й`
      : meta.label;
  return (
    <span
      key={label}
      className={[
        styles.badge,
        styles[meta.tone],
        props.size === 'lg' && styles.lg,
        props.flash && 'status-flash',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon size={props.size === 'lg' ? 22 : 18} weight="bold" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

function resolve(props: Props): StatusMeta {
  switch (props.kind) {
    case 'participation':
      return (props.audience === 'organizer' ? PARTICIPATION_STATUS_FOR_ORGANIZER : PARTICIPATION_STATUS)[
        props.status
      ];
    case 'event':
      return EVENT_STATE[props.status];
    case 'org':
      return ORG_STATUS[props.status];
    case 'message-hidden':
      return MESSAGE_HIDDEN;
    case 'custom':
      return props.meta;
  }
}
