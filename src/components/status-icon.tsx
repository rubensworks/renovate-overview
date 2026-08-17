import type { CheckState } from '../lib/types';
import { CHECK_STATE_LABELS } from '../lib/types';

const GLYPHS: Record<CheckState, string> = {
  success: 'M4.6 8.2 L6.9 10.6 L11.4 5.6',
  failure: 'M5.6 5.6 L10.4 10.4 M10.4 5.6 L5.6 10.4',
  pending: 'M8 4.6 V8 L10.4 9.6',
  error: 'M8 4.6 V8.8 M8 10.6 V11.2',
  none: 'M4.8 8 H11.2',
};

export interface IStatusIconProps {
  state: CheckState;
  size?: number;
}

/**
 * A small circular check badge, coloured per state.
 *
 * The colour is the point: it repeats down the left margin of the list, so a backlog can be read
 * without reading a single word of it.
 */
export function StatusIcon({ state, size = 14 }: IStatusIconProps) {
  return (
    <svg
      className={`status-icon status-icon--${state}`}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      role="img"
      aria-label={CHECK_STATE_LABELS[state]}
    >
      <title>{CHECK_STATE_LABELS[state]}</title>
      <circle className="status-icon__ring" cx="8" cy="8" r="7" />
      <path className="status-icon__glyph" d={GLYPHS[state]} />
    </svg>
  );
}
