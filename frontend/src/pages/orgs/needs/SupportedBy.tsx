import { HandshakeIcon } from '@phosphor-icons/react';
import { useList, type CrudFilter } from '@refinedev/core';
import { Fragment } from 'react';
import { Link } from 'react-router';

import { useInventoryLive } from '@/lib/api';
import type { OrgType } from '@/types/domain';
import type { OwnerView, SupportNeedView } from '@/types/inventory';
import { quoted } from '@/pages/inventory/labels';

import styles from './needs.module.css';

/** Плашка «При поддержке …» на странице клуба и «Помогли клубам: …» на странице партнёра. */
export function SupportedBy({ orgId, orgType }: { orgId: string; orgType: OrgType }) {
  const sponsor = orgType === 'sponsor';
  const filters: CrudFilter[] = [
    { field: 'status', operator: 'eq', value: 'closed' },
    { field: sponsor ? 'sponsorId' : 'orgId', operator: 'eq', value: orgId },
  ];
  const { result, query } = useList<SupportNeedView>({
    resource: 'support-needs',
    filters,
    pagination: { mode: 'off' },
    errorNotification: false,
  });
  useInventoryLive(() => void query.refetch());
  const orgs = new Map<string, OwnerView>();
  for (const n of result.data ?? []) {
    const other = sponsor ? n.org : n.closedBy;
    if (other) orgs.set(other.id, other);
  }
  if (orgs.size === 0) return null;
  return <SupportPlaque prefix={sponsor ? 'Помогли клубам:' : 'При поддержке'} orgs={[...orgs.values()]} />;
}

export function SupportPlaque({ prefix = 'При поддержке', orgs }: { prefix?: string; orgs: OwnerView[] }) {
  if (orgs.length === 0) return null;
  return (
    <p className={styles.plaque}>
      <HandshakeIcon size={20} aria-hidden />
      <span>
        {prefix}{' '}
        {orgs.map((o, i) => (
          <Fragment key={o.id}>
            {i > 0 && ', '}
            <Link to={o.link}>{quoted(o.name)}</Link>
          </Fragment>
        ))}
      </span>
    </p>
  );
}
