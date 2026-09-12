import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';

export default [
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/*.config.*'] },
  {
    files: ['apps/api/src/**/*.ts'],
    languageOptions: { parser: tsparser, parserOptions: { sourceType: 'module' } },
    plugins: { '@typescript-eslint': tseslint, boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'module-public',   pattern: 'apps/api/src/modules/*/public/**' },
        { type: 'module-internal', pattern: 'apps/api/src/modules/*/!(public)/**' },
        { type: 'common',          pattern: 'apps/api/src/common/**' },
      ],
    },
    rules: {
      /**
       * ADR-002 — حدود الوحدات.
       * وحدة تستورد من وحدة أخرى عبر public/ فقط. هذه القاعدة هي ما يجعل
       * استخراج أي وحدة كخدمة مستقلة لاحقاً عملية أيام لا أشهر.
       */
      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          { from: 'module-internal', allow: ['module-public', 'common', 'module-internal'] },
          { from: 'module-public',   allow: ['module-internal', 'common'] },
          { from: 'common',          allow: ['common'] },
        ],
      }],

      /** ADR-001 — لا حساب على المال خارج نواة money. */
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/modules/*/domain/**', '**/modules/*/application/**', '**/modules/*/infrastructure/**'],
          message: 'استورد من public/ الخاصة بالوحدة، لا من داخلها (ADR-002).',
        }],
      }],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
];
