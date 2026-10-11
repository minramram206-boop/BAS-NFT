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

export const InfoIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v4M8 11v1" />
  </Icon>
);

/** Filled shield crest of the district. */
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
