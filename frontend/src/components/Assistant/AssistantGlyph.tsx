/** Дорожки из знака платформы внутри диалога: общий знак спортивного помощника. */
export function AssistantGlyph({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <path
        d="M15 8h10c6.5 0 10.5 4 10.5 10S31.5 28 25 28h-6l-7 5v-5.6C7.4 26.3 4.5 22.8 4.5 18 4.5 12 8.5 8 15 8Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M27 14h-9c-3 0-4.8 1.4-4.8 4s1.8 4 4.8 4h9M18 18h7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
