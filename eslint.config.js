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

      // Nota: `@typescript-eslint/consistent-type-imports` non e' attiva di
      // proposito. Richiederebbe il typed linting, e sarebbe comunque
      // ridondante: tsconfig.base.json abilita `verbatimModuleSyntax`, quindi
      // e' il compilatore a rifiutare (TS1484) un tipo importato senza
      // `import type`. Un controllo solo, nel posto giusto.

      // Vedi docs/adr/0002: applesauce-factory duplicherebbe applesauce-core.
      // scripts/guard-deps.mjs controlla i manifest; questa regola intercetta
      // l'import diretto anche se il pacchetto entrasse come transitiva.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'applesauce-factory',
              message:
                "applesauce-factory e' fermo alla 4.x e duplica applesauce-core. " +
                "Usare 'applesauce-core/factories'.",
            },
          ],
        },
      ],
    },
  },

  // Gli SFC con `lang="ts"` hanno bisogno che vue-eslint-parser inoltri il
  // contenuto degli script al parser TypeScript.
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

      // typescript-eslint disattiva `no-undef` sui file .ts, perche' e' il
      // compilatore a fare quel controllo, e meglio. Il suo override non
      // copre pero' i .vue, dove la regola inciampa sugli auto-import di
      // Nuxt (useHead, useRoute, definePageMeta...). Stessa ragione, stesso
      // trattamento: `nuxt typecheck` resta il controllo autorevole.
      'no-undef': 'off',
    },
  },

  // Il package core deve restare isomorfico: nessun accesso diretto alle API
  // del browser, altrimenti si rompe in SSR e nei test Node.
  {
    files: ['packages/nostr-core/src/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: "nostr-core deve restare isomorfico: passare la dipendenza dall'esterno.",
        },
        {
          name: 'document',
          message: "nostr-core deve restare isomorfico: passare la dipendenza dall'esterno.",
        },
        {
          name: 'localStorage',
          message: 'nostr-core deve restare isomorfico: usare un adapter iniettato.',
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
