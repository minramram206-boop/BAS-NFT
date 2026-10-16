import React from 'react';

/**
 * Small stroke icons drawn on a 16-unit grid. Decorative by default; pass
 * `label` when the icon is the only content of a control.
 */
interface IconProps {
  size?: number;
  className?: string;
  label?: string;
}

function Icon({ size = 16, className, label, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </svg>
  );
}

export const LockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="7" width="10" height="7" />
    <path d="M5 7V5a3 3 0 0 1 6 0v2" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 8l4 4 8-8" strokeWidth={3} />
  </Icon>
);

export const BackIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 3 5 8l5 5" strokeWidth={2.5} />
  </Icon>
);

export const ClockIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4v4l3 2" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3v10M3 8h10" strokeWidth={2.5} />
  </Icon>
);

export const MinusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 8h10" strokeWidth={2.5} />
  </Icon>
);

export const ChevronIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 6l5 5 5-5" strokeWidth={2.5} />
  </Icon>
);

export const TargetIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="4" />
    <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
  </Icon>
);

export const PlazaIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 14h12M4 14V7M12 14V7M2 7l6-5 6 5" />
  </Icon>
);

export const BoardIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="2" width="10" height="12" />
    <path d="M6 6h4M6 9h4" />
  </Icon>
);

export const TrophyIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 2h8v4a4 4 0 0 1-8 0zM8 10v4M5 14h6" />
  </Icon>
);

export const PersonIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="5" r="3" />
    <path d="M2 15c1-3 3.5-4 6-4s5 1 6 4" />
  </Icon>
);

export const UpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 13V3M3 8l5-5 5 5" strokeWidth={2.5} />
  </Icon>
);

export const MarketIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 8.5V2h6.5L14 7.5 8.5 13z" />
    <circle cx="5.2" cy="5.2" r="1" fill="currentColor" stroke="none" />
  </Icon>
);

export const InfoIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v4M8 11v1" />
  </Icon>
);

/** Filled shield crest of the district. */
export const PlayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 2v12l9-6z" fill="currentColor" strokeLinejoin="round" />
  </Icon>
);

export const PauseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 2h3v12H4zM9 2h3v12H9z" fill="currentColor" strokeWidth={0} />
  </Icon>
);

export const SkipIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 3v10l7-5z" fill="currentColor" strokeLinejoin="round" />
    <path d="M12 3v10" strokeWidth={2.5} />
  </Icon>
);

export const ShuffleIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M1 4h3l7 8h4M1 12h3l2-2.3M9 6.3 11 4h4" />
    <path d="M12.5 1.5 15 4l-2.5 2.5M12.5 9.5 15 12l-2.5 2.5" />
  </Icon>
);

export const RepeatIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 8V5h11M14 8v3H3" />
    <path d="m10.5 2.5 2.5 2.5-2.5 2.5M5.5 8.5 3 11l2.5 2.5" />
  </Icon>
);

export const SpeakerIcon = ({ muted, ...props }: IconProps & { muted?: boolean }) => (
  <Icon {...props}>
    <path d="M1 6h3l4-3.5v11L4 10H1z" fill="currentColor" strokeLinejoin="round" />
    {muted ? <path d="m10.5 5.5 5 5M15.5 5.5l-5 5" /> : <path d="M11 5a4 4 0 0 1 0 6M13 3a7 7 0 0 1 0 10" />}
  </Icon>
);

export const ExpandIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M1.5 6V1.5H6M10 1.5h4.5V6M14.5 10v4.5H10M6 14.5H1.5V10" />
  </Icon>
);

export const NoteIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="5" cy="12" r="2.4" fill="currentColor" />
    <path d="M7.2 12V2.5l6 2v3l-6-2" strokeLinejoin="round" />
  </Icon>
);

export const CrestIcon = ({ size = 28, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden>
    <path d="M8 1 2 3v5c0 3.5 2.6 6 6 7 3.4-1 6-3.5 6-7V3z" fill="#3b74a6" stroke="#1a2734" strokeWidth={1.5} />
    <path d="M5 8h6M8 5v6" stroke="#f2f6fa" strokeWidth={1.5} />
  </svg>
);

/** Filled token coin. */
export const CoinIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
    <circle cx="8" cy="8" r="6" fill="#f7d23d" stroke="#8a6a12" strokeWidth={1.5} />
    <path d="M6 8h4" stroke="#8a6a12" strokeWidth={1.5} />
  </svg>
);

/** Filled star for earned achievements. */
export const StarIcon = ({ size = 22, color = '#f7d23d' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
    <path
      d="M8 1l2 4.5 4.8.4-3.7 3.1 1.2 4.8L8 11.2 3.7 13.8l1.2-4.8L1.2 5.9 6 5.5z"
      fill={color}
      stroke="#1a2734"
      strokeWidth={1.5}
    />
  </svg>
);
