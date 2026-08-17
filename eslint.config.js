import config from '@rubensworks/eslint-config';

export default config([
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
    ],
  },
  {
    files: [ '**/*.ts', '**/*.tsx' ],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        project: [ './tsconfig.json' ],
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLDivElement: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    files: [ '**/*.ts', '**/*.tsx' ],
    rules: {
      // Bundler-resolved imports are written without a file extension, except for asset imports.
      'import/extensions': [ 'error', 'never', { css: 'always', svg: 'always', json: 'always' }],

      // This rule chops prose that mixes text with inline elements into one node per line, and its
      // autofix silently drops the significant whitespace between them.
      'style/jsx-one-expression-per-line': 'off',

      // The GitHub REST API speaks snake_case, so response and parameter shapes cannot be camelCase.
      'ts/naming-convention': [
        'error',
        {
          selector: 'default',
          format: [ 'camelCase' ],
          leadingUnderscore: 'forbid',
          trailingUnderscore: 'forbid',
        },
        { selector: 'import', format: null },
        { selector: [ 'objectLiteralProperty', 'typeProperty' ], format: null },
        // React components are functions, and they are PascalCase by convention. That extends to
        // components handed to a module mock as object literal members.
        { selector: [ 'function', 'objectLiteralMethod' ], format: [ 'camelCase', 'PascalCase' ]},
        // A leading underscore marks a parameter that only exists to reach the ones after it.
        { selector: 'parameter', format: [ 'camelCase' ], leadingUnderscore: 'allow' },
        {
          selector: 'variable',
          format: [ 'camelCase', 'PascalCase', 'UPPER_CASE' ],
          leadingUnderscore: 'forbid',
          trailingUnderscore: 'forbid',
        },
        { selector: 'typeLike', format: [ 'PascalCase' ]},
        { selector: [ 'typeParameter' ], format: [ 'PascalCase' ], prefix: [ 'T' ]},
        {
          selector: 'interface',
          format: [ 'PascalCase' ],
          custom: { regex: '^I[A-Z]', match: true },
        },
      ],
    },
  },
  {
    files: [ 'test/**' ],
    rules: {
      // Suites are named after the exported symbol they cover, which is often PascalCase.
      'test/prefer-lowercase-title': [ 'error', { ignore: [ 'describe' ]}],
    },
  },
], { disableJest: true });
