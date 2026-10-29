import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Note: `@typescript-eslint/consistent-type-imports` is off on purpose.
      // It would require typed linting, and it would be redundant anyway:
      // tsconfig.base.json enables `verbatimModuleSyntax`, so it is the
      // compiler that refuses (TS1484) a type imported without `import type`.
      // One check, in the right place.

      // See docs/adr/0002: applesauce-factory would duplicate applesauce-core.
      // scripts/guard-deps.mjs checks the manifests; this rule catches the
      // direct import even if the package came in as a transitive dependency.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'applesauce-factory',
              message:
                'applesauce-factory is stuck at 4.x and duplicates applesauce-core. ' +
                "Use 'applesauce-core/factories'.",
            },
          ],
        },
      ],
    },
  },

  // SFCs with `lang="ts"` need vue-eslint-parser to forward the scripts'
  // content to the TypeScript parser.
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2023,
        sourceType: 'module',
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/html-self-closing': 'off',

      // typescript-eslint turns `no-undef` off on .ts files, because the
      // compiler does that check, and better. Its override does not cover
      // .vue files, though, where the rule trips over Nuxt's auto-imports
      // (useHead, useRoute, definePageMeta...). Same reason, same treatment:
      // `nuxt typecheck` remains the authoritative check.
      'no-undef': 'off',
    },
  },

  // The core package has to stay isomorphic: no direct access to the browser's
  // APIs, otherwise it breaks in SSR and in the Node tests.
  {
    files: ['packages/nostr-core/src/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'nostr-core has to stay isomorphic: pass the dependency in from outside.',
        },
        {
          name: 'document',
          message: 'nostr-core has to stay isomorphic: pass the dependency in from outside.',
        },
        {
          name: 'localStorage',
          message: 'nostr-core has to stay isomorphic: use an injected adapter.',
        },
      ],
    },
  },

  {
    files: ['scripts/**/*.mjs', '**/*.config.{js,ts,mjs}'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  prettier,
)
