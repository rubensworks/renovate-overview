import type { UpdateType } from '../lib/types';

const SHORT: Record<UpdateType, string> = {
  major: 'major',
  minor: 'minor',
  patch: 'patch',
  digest: 'digest',
  pin: 'pin',
  rollback: 'rollback',
  replacement: 'replace',
  lockFileMaintenance: 'lockfile',
  unknown: '?',
};

export interface IUpdatePillProps {
  updateType: UpdateType;
}

/**
 * The update-type badge. Major is deliberately the loud one — it is the only type that routinely
 * needs a human to read the release notes before merging.
 */
export function UpdatePill({ updateType }: IUpdatePillProps) {
  if (updateType === 'unknown') {
    return null;
  }
  return <span className={`pill pill--${updateType}`}>{SHORT[updateType]}</span>;
}
