import {
  Barbell,
  Basketball,
  BoxingGlove,
  PersonSimpleBike,
  PersonSimpleRun,
  PersonSimpleSwim,
  PingPong,
  Racquet,
  SoccerBall,
  TennisBall,
  Volleyball,
  type Icon,
} from '@phosphor-icons/react';
import { useEffect, useId, useRef, type CSSProperties } from 'react';

import styles from './Landing.module.css';

const MOTIFS: { icon: Icon; x: number; y: number; size: number; turn: number }[] = [
  { icon: SoccerBall, x: 32, y: 40, size: 24, turn: -16 },
  { icon: Racquet, x: 138, y: 62, size: 26, turn: 24 },
  { icon: PersonSimpleRun, x: 268, y: 24, size: 24, turn: -8 },
  { icon: Basketball, x: 404, y: 76, size: 22, turn: 18 },
  { icon: Barbell, x: 64, y: 160, size: 26, turn: -25 },
  { icon: Volleyball, x: 194, y: 132, size: 22, turn: 14 },
  { icon: PersonSimpleBike, x: 332, y: 188, size: 28, turn: -12 },
  { icon: PingPong, x: 422, y: 248, size: 24, turn: 24 },
  { icon: TennisBall, x: 30, y: 302, size: 20, turn: 12 },
  { icon: PersonSimpleSwim, x: 148, y: 256, size: 26, turn: -14 },
  { icon: BoxingGlove, x: 264, y: 326, size: 24, turn: 18 },
  { icon: SoccerBall, x: 382, y: 350, size: 20, turn: -22 },
];

/** Один лёгкий SVG-паттерн вместо сотен декоративных элементов на длинной странице. */
export function SportsPattern() {
  const patternId = `sports-pattern-${useId().replace(/:/g, '')}`;
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const media = matchMedia(
      '(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)',
    );
    const motifs = [...svg.querySelectorAll<SVGGElement>('[data-sport-motion]')];
    let frame = 0;
    let previous = 0;
    let x = 0;
    let y = 0;
    let targetX = 0;
    let targetY = 0;

    const draw = () => {
      motifs.forEach((motif, index) => {
        const depth = 0.55 + (index % 4) * 0.2;
        motif.setAttribute('transform', `translate(${(x * depth).toFixed(2)} ${(y * depth).toFixed(2)})`);
      });
    };
    const tick = (time: number) => {
      // Frame-rate-independent easing; nothing runs when the cursor is still.
      const progress = 1 - Math.exp(-Math.min(time - previous, 64) / 110);
      previous = time;
      x += (targetX - x) * progress;
      y += (targetY - y) * progress;
      if (Math.abs(targetX - x) + Math.abs(targetY - y) < 0.05) {
        x = targetX;
        y = targetY;
        frame = 0;
      } else frame = requestAnimationFrame(tick);
      draw();
    };
    const moveTo = (nextX: number, nextY: number) => {
      targetX = nextX;
      targetY = nextY;
      if (!frame) {
        previous = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const move = (event: PointerEvent) => {
      if (!media.matches || event.pointerType !== 'mouse' || document.hidden) return;
      moveTo((event.clientX / innerWidth - 0.5) * 30, (event.clientY / innerHeight - 0.5) * 24);
    };
    const reset = () => {
      svg.dataset.motionPaused = String(document.hidden);
      if (media.matches && !document.hidden) moveTo(0, 0);
      else {
        cancelAnimationFrame(frame);
        frame = 0;
        x = y = targetX = targetY = 0;
        draw();
      }
    };
    svg.dataset.motionPaused = String(document.hidden);
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    media.addEventListener('change', reset);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', reset);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
      media.removeEventListener('change', reset);
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      className={styles.sportsPattern}
      aria-hidden="true"
      focusable="false"
      data-sports-pattern=""
    >
      <defs>
        <pattern id={patternId} width="480" height="400" patternUnits="userSpaceOnUse">
          {MOTIFS.map(({ icon: Sport, x, y, size, turn }, index) => (
            <g key={index} data-sport-motion="">
              <g transform={`translate(${x} ${y}) rotate(${turn} ${size / 2} ${size / 2})`}>
                <g
                  className={styles.sportFloat}
                  data-sport-float=""
                  style={
                    {
                      '--float-duration': `${16 + (index % 5) * 3}s`,
                      '--float-delay': `${-index * 2.7}s`,
                      animationDirection: index % 2 ? 'reverse' : 'normal',
                    } as CSSProperties
                  }
                >
                  <Sport size={size} weight="regular" />
                </g>
              </g>
            </g>
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
