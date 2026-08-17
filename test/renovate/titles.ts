import type { UpdateType } from '../../src/lib/types';

/**
 * What a title is expected to yield. Anything left out is not asserted, so a fixture only pins
 * down what it is actually about.
 */
export interface ITitleCase {
  title: string;
  /**
   * The dependency names, in order. An empty list means the title names a group whose members
   * cannot be known without the body.
   */
  deps?: string[];
  newVersion?: string;
  updateType?: UpdateType;
  isGroup?: boolean;
  groupName?: string;
  manager?: string;
  /**
   * The grouping key of the first dependency, where the normalisation is the point.
   */
  groupKey?: string;
}

/**
 * Real Renovate pull request titles, covering the template variations that `semanticCommits`,
 * `commitMessagePrefix`, `separateMajorMinor` and the group presets produce.
 */
export const TITLE_CASES: ITitleCase[] = [
  // --- the plain template ---
  { title: 'Update dependency lodash to v4.17.21', deps: [ 'lodash' ], newVersion: '4.17.21' },
  {
    title: 'Update dependency @types/node to v20.11.5',
    deps: [ '@types/node' ],
    newVersion: '20.11.5',
    groupKey: 'types-node',
  },
  { title: 'Update dependency typescript to ~5.4.0', deps: [ 'typescript' ], newVersion: '~5.4.0' },
  { title: 'Update dependency eslint to v9', deps: [ 'eslint' ], newVersion: '9' },

  // --- semantic commit prefixes ---
  { title: 'chore(deps): update dependency eslint to v9', deps: [ 'eslint' ], newVersion: '9' },
  { title: 'fix(deps): update dependency @sentry/cli to v1.54.0', deps: [ '@sentry/cli' ], newVersion: '1.54.0' },
  { title: 'feat(deps): update dependency vite to v6', deps: [ 'vite' ], newVersion: '6' },
  { title: 'build(deps-dev): update dependency vitest to v4', deps: [ 'vitest' ], newVersion: '4' },
  { title: 'chore(deps)!: update dependency next to v15', deps: [ 'next' ], newVersion: '15' },

  // --- a base branch suffix, which is not an update type ---
  {
    title: 'chore(deps): update dependency jest to v29.7.0 (master)',
    deps: [ 'jest' ],
    newVersion: '29.7.0',
  },
  { title: 'Update dependency react to v18 (main)', deps: [ 'react' ], newVersion: '18' },
  { title: 'Update dependency foo to v2 (release/1.x)', deps: [ 'foo' ], newVersion: '2' },

  // --- an update type suffix, which is not a base branch ---
  { title: 'Update dependency foo to v2 (major)', deps: [ 'foo' ], newVersion: '2', updateType: 'major' },
  { title: 'Update dependency foo to v1.3.0 (minor)', deps: [ 'foo' ], updateType: 'minor' },
  { title: 'Update dependency foo to v1.2.4 (patch)', deps: [ 'foo' ], updateType: 'patch' },

  // --- groups ---
  { title: 'Update jest monorepo to v29', deps: [], isGroup: true, groupName: 'jest monorepo', newVersion: '29' },
  { title: 'Update babel monorepo', deps: [], isGroup: true, groupName: 'babel monorepo' },
  { title: 'Update all non-major dependencies', deps: [], isGroup: true, groupName: 'all non-major dependencies' },
  { title: 'chore(deps): update all patch dependencies', deps: [], isGroup: true },
  { title: 'Update all minor dependencies (master)', deps: [], isGroup: true },
  { title: 'Update React (major)', deps: [], isGroup: true, groupName: 'React', updateType: 'major' },
  { title: 'Update linters', deps: [], isGroup: true, groupName: 'linters' },

  // --- GitHub Actions ---
  {
    title: 'Update actions/checkout action to v4',
    deps: [ 'actions/checkout' ],
    newVersion: '4',
    manager: 'github-actions',
    groupKey: 'actions-checkout',
  },
  {
    title: 'chore(deps): update actions/setup-node action to v4.0.2',
    deps: [ 'actions/setup-node' ],
    newVersion: '4.0.2',
    manager: 'github-actions',
  },

  // --- digests ---
  {
    title: 'chore(deps): update docker/build-push-action digest to a1b2c3d',
    deps: [ 'docker/build-push-action' ],
    newVersion: 'a1b2c3d',
    updateType: 'digest',
  },
  { title: 'Update node.js Docker tag to v22', deps: [ 'node.js' ], newVersion: '22', manager: 'docker' },

  // --- pins and lock files ---
  { title: 'chore(deps): pin dependencies', deps: [], isGroup: true, updateType: 'pin' },
  { title: 'Pin dependency lodash to 4.17.21', deps: [ 'lodash' ], newVersion: '4.17.21', updateType: 'pin' },
  { title: 'Lock file maintenance', updateType: 'lockFileMaintenance', groupKey: 'lock-file-maintenance' },
  { title: 'chore(deps): lock file maintenance', updateType: 'lockFileMaintenance' },

  // --- other ecosystems ---
  { title: 'Update node.js to v22', deps: [ 'node.js' ], newVersion: '22' },
  { title: 'Update Yarn to v4', deps: [ 'Yarn' ], newVersion: '4' },
  { title: 'Update Rust crate serde to 1.0.197', deps: [ 'serde' ], newVersion: '1.0.197', manager: 'cargo' },
  {
    title: 'Update module github.com/spf13/cobra to v1.8.0',
    deps: [ 'github.com/spf13/cobra' ],
    newVersion: '1.8.0',
    manager: 'gomod',
  },
  { title: 'Update helm release cert-manager to v1.14.0', deps: [ 'cert-manager' ], manager: 'helm' },
  { title: 'Update dependency com.google.guava:guava to v33', deps: [ 'com.google.guava:guava' ], newVersion: '33' },
  { title: 'Update dependency org.slf4j:slf4j-api to v2.0.12', deps: [ 'org.slf4j:slf4j-api' ]},

  // --- decorations Renovate and its users add ---
  { title: 'Update dependency lodash to v4.17.21 [SECURITY]', deps: [ 'lodash' ], newVersion: '4.17.21' },
  { title: 'Update dependency axios to v1.6.7 - autoclosed', deps: [ 'axios' ], newVersion: '1.6.7' },
  {
    title: 'chore(deps): update dependency @typescript-eslint/parser to v7 [skip ci]',
    deps: [ '@typescript-eslint/parser' ],
  },

  // --- and the ones no parser should pretend to understand ---
  { title: 'Bump the npm group with 5 updates', deps: []},
  { title: '', deps: []},
  { title: 'Merge branch master into develop', deps: []},
];
