import { consent, publicConsent } from './docs/consents';
import { cookies } from './docs/cookies';
import { privacy } from './docs/privacy';
import { terms } from './docs/terms';
import type { LegalDoc } from './types';

/** Порядок — как в списке на /legal. */
export const LEGAL_DOCS: LegalDoc[] = [terms, privacy, consent, publicConsent, cookies];

export function legalDoc(slug: string | undefined): LegalDoc | undefined {
  return LEGAL_DOCS.find((d) => d.slug === slug);
}

export const legalPath = (slug: string) => `/legal/${slug}`;
