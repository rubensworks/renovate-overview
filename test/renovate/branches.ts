import type { UpdateType } from '../../src/lib/types';

export interface IBranchCase {
  branch: string;
  depName?: string;
  groupKey?: string;
  newVersion?: string;
  updateType?: UpdateType;
  isGroup?: boolean;
  manager?: string;
}

/**
 * Branch names are less expressive than titles but far more stable: `semanticCommits` and
 * `commitMessagePrefix` do not touch them, so they are the cross-check when a title is odd.
 */
export const BRANCH_CASES: IBranchCase[] = [
  { branch: 'renovate/lodash-4.x', depName: 'lodash', groupKey: 'lodash', newVersion: '4.x' },
  // The whole reason grouping keys are normalised: this is `@types/node` under another spelling.
  { branch: 'renovate/types-node-20.x', depName: 'types-node', groupKey: 'types-node', newVersion: '20.x' },
  { branch: 'renovate/typescript-5.4.0', depName: 'typescript', newVersion: '5.4.0' },
  { branch: 'renovate/major-jest-monorepo', updateType: 'major', isGroup: true, groupKey: 'jest-monorepo' },
  { branch: 'renovate/minor-babel-monorepo', updateType: 'minor', isGroup: true },
  { branch: 'renovate/patch-eslint-8.x', updateType: 'patch', depName: 'eslint', newVersion: '8.x' },
  { branch: 'renovate/all-minor-patch', isGroup: true },
  { branch: 'renovate/all-non-major', isGroup: true },
  {
    branch: 'renovate/actions-checkout-4.x',
    depName: 'actions-checkout',
    groupKey: 'actions-checkout',
    newVersion: '4.x',
  },
  { branch: 'renovate/pin-dependencies', updateType: 'pin', isGroup: true },
  { branch: 'renovate/lock-file-maintenance', updateType: 'lockFileMaintenance' },
  { branch: 'renovate/digest-docker-build-push-action', updateType: 'digest', depName: 'docker-build-push-action' },
  { branch: 'renovate/github.com-spf13-cobra-1.x', depName: 'github.com-spf13-cobra', newVersion: '1.x' },
  // A configured branchPrefix other than the default.
  { branch: 'deps/renovate/lodash-4.x', depName: 'lodash' },
  // Dependabot lays its branches out differently, and names its manager in them.
  {
    branch: 'dependabot/npm_and_yarn/lodash-4.17.21',
    depName: 'lodash',
    newVersion: '4.17.21',
    manager: 'npm',
  },
  {
    branch: 'dependabot/github_actions/actions/checkout-4',
    depName: 'actions/checkout',
    groupKey: 'actions-checkout',
    newVersion: '4',
    manager: 'github-actions',
  },
  { branch: 'dependabot/docker/node-22', depName: 'node', newVersion: '22', manager: 'docker' },
  // Nothing to go on.
  { branch: 'feature/rewrite-everything' },
  { branch: '' },
  { branch: 'renovate/' },
  // A prefix with nothing behind it: the update type is readable, the dependency is not.
  { branch: 'renovate/major-' },
];
