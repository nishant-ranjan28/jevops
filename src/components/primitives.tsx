import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted',
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  accent: 'text-accent',
};

export const TONE_BORDER: Record<Tone, string> = {
  neutral: 'border-line',
  good: 'border-good/40',
  warn: 'border-warn/40',
  bad: 'border-bad/45',
  accent: 'border-accent/40',
};

export const TONE_BG: Record<Tone, string> = {
  neutral: 'bg-white/[0.03]',
  good: 'bg-good/10',
  warn: 'bg-warn/10',
  bad: 'bg-bad/10',
  accent: 'bg-accent/10',
};

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function PanelHeader({
  title,
  meta,
  right,
}: {
  title: string;
  meta?: string;
  right?: ReactNode;
}) {
  return (
    <header className="hairline flex items-center justify-between gap-3 border-b px-4 py-3">
      <div className="min-w-0">
        <h2 className="mono text-[11px] font-medium tracking-[0.18em] text-muted uppercase">
          {title}
        </h2>
        {meta ? <p className="mono mt-0.5 truncate text-[11px] text-dim">{meta}</p> : null}
      </div>
      {right}
    </header>
  );
}

export function Pill({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] text-[10px] font-medium tracking-[0.08em] uppercase ${TONE_BORDER[tone]} ${TONE_BG[tone]} ${TONE_TEXT[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral', pulse = false }: { tone?: Tone; pulse?: boolean }) {
  const bg: Record<Tone, string> = {
    neutral: 'bg-dim',
    good: 'bg-good',
    warn: 'bg-warn',
    bad: 'bg-bad',
    accent: 'bg-accent',
  };
  return (
    <span
      aria-hidden
      className={`inline-block size-1.5 shrink-0 rounded-full ${bg[tone]} ${pulse ? 'animate-[var(--animate-blink)]' : ''}`}
    />
  );
}

export function ScoreRing({
  value,
  label,
  tone,
  size = 132,
}: {
  value: number;
  label: string;
  tone: Tone;
  size?: number;
}) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - clamped / 100);
  const strokeColor: Record<Tone, string> = {
    neutral: 'var(--color-accent)',
    good: 'var(--color-good)',
    warn: 'var(--color-warn)',
    bad: 'var(--color-bad)',
    accent: 'var(--color-accent)',
  };

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${label}: ${clamped} out of 100`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`mono tabular text-3xl font-semibold ${TONE_TEXT[tone === 'neutral' ? 'accent' : tone]}`}>
          {clamped}
        </span>
        <span className="mono mt-0.5 text-[9px] tracking-[0.14em] text-dim uppercase">{label}</span>
      </div>
    </div>
  );
}

export function Meter({ value, tone = 'accent' }: { value: number; tone?: Tone }) {
  const bar: Record<Tone, string> = {
    neutral: 'bg-dim',
    good: 'bg-good',
    warn: 'bg-warn',
    bad: 'bg-bad',
    accent: 'bg-accent',
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className={`h-full rounded-full ${bar[tone]} transition-[width] duration-700 ease-out`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-dim">{children}</p>;
}
