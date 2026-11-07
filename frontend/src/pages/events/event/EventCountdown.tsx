import { useEffect, useState } from 'react';
import type { EventView } from '@/types/api';
import { countdownText } from '@/lib/eventCountdown';

export function EventCountdown({ event, className }: { event: EventView; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const text = countdownText(event.startsAt, event.state, now, event.durationMin);
  return text ? (
    <span className={className} role="timer" aria-live="off">
      {text}
    </span>
  ) : null;
}
