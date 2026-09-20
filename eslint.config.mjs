import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';
import nextWebVitals from 'eslint-config-next/core-web-vitals';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// المسارات تُحسب من موقع هذا الملف لا من مجلد التشغيل — انظر import/resolver
const ROOT = dirname(fileURLToPath(import.meta.url));

export default [
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/*.config.*'] },
  {
    files: ['apps/api/src/**/*.ts'],
    languageOptions: { parser: tsparser, parserOptions: { sourceType: 'module' } },
    plugins: { '@typescript-eslint': tseslint, boundaries },
    settings: {
      /**
       * بلا محلّل، لم يُحلَّ أي استيراد .ts أصلاً: كل هدف كان «نوعاً مجهولاً»
       * فتجاهلته boundaries، ومرّ استيراد common من داخل وحدة بلا اعتراض.
       * الحارس كان صامتاً منذ المرحلة 03 — مجموعة اختبار الحارس في
       * scripts/verify-local.sh تحاول الخرق الآن لتثبت أنه يعترض.
       */
      /**
       * أنماط العناصر أدناه نسبية لجذر المستودع. بلا هذا تُقاس من مجلد التشغيل:
       * من apps/api يصير المسار src/modules/… فلا يطابق apps/api/src/modules/…،
       * فكل ملف «نوع مجهول» ولا قاعدة تسري — والـ CI يشغّل lint من هناك بالضبط.
       * إصلاح مسار المحلّل وحده لم يكفِ؛ كشفه مسبار verify المزدوج.
       */
      'boundaries/root-path': ROOT,
      'import/resolver': {
        // مطلق من موقع الملف: يصحّ أيّاً كان مجلد التشغيل (الجذر في verify، و apps/api في CI)
        typescript: { project: join(ROOT, 'apps/api/tsconfig.json') },
      },
      'boundaries/elements': [
        // capture يلتقط اسم الوحدة، فتصير «الوحدة نفسها» شرطاً قابلاً للفحص لا افتراضاً
        { type: 'module-public',   pattern: 'apps/api/src/modules/*/public/**',     capture: ['module'] },
        { type: 'module-internal', pattern: 'apps/api/src/modules/*/!(public)/**', capture: ['module'] },
        { type: 'common',          pattern: 'apps/api/src/common/**' },
      ],
    },
    rules: {
      /**
       * ADR-002 — حدود الوحدات.
       * وحدة تستورد من وحدة أخرى عبر public/ فقط. هذه القاعدة هي ما يجعل
       * استخراج أي وحدة كخدمة مستقلة لاحقاً عملية أيام لا أشهر.
       */
      // v7: القاعدة صارت boundaries/dependencies، و rules صارت policies، والمُحدِّد كيان
      // { element: { … } }، والقوالب {{from.element.captured.module}}. الصيغ القديمة تُقبل بتحذير فقط — فتصير الحارسة عمياء بلا خطأ.
      'boundaries/dependencies': ['error', {
        default: 'disallow',
        /**
         * كان module-internal يسمح بـ module-internal أيّاً كانت وحدته، فمرّ
         * `../../identity/domain/password` من داخل catalog بلا اعتراض — ونمط
         * no-restricted-imports لا يرى المسار النسبي لأنه لا يحوي "modules/".
         * الدرس 3 مرة ثالثة: القاعدة كانت تعدّ ما يُسمح بصيغة أوسع مما قُصد.
         * الآن الداخل مسموح داخل الوحدة نفسها فقط، والعبور عبر public/.
         */
        policies: [
          {
            from: { element: { type: 'module-internal' } },
            allow: [
              { to: { element: { type: 'module-public' } } },
              { to: { element: { type: 'common' } } },
              { to: { element: { type: 'module-internal', captured: { module: '{{from.element.captured.module}}' } } } },
            ],
          },
          {
            from: { element: { type: 'module-public' } },
            allow: [
              { to: { element: { type: 'common' } } },
              { to: { element: { type: 'module-internal', captured: { module: '{{from.element.captured.module}}' } } } },
              { to: { element: { type: 'module-public', captured: { module: '{{from.element.captured.module}}' } } } },
            ],
          },
          { from: { element: { type: 'common' } }, allow: [{ to: { element: { type: 'common' } } }] },
        ],
      }],

      /** ADR-001 — لا حساب على المال خارج نواة money. */
      'no-restricted-imports': ['error', {
        patterns: [{
          // api/** كان ناقصاً، فمرّ استيراد من داخل وحدة بلا اعتراض.
          // القائمة تعدّ ما يُمنع لا ما يُسمح — فنسيان مجلد يفتح ثغرة صامتة.
          group: [
            '**/modules/*/domain/**',
            '**/modules/*/application/**',
            '**/modules/*/infrastructure/**',
            '**/modules/*/api/**',
          ],
          message: 'استورد من public/ الخاصة بالوحدة، لا من داخلها (ADR-002).',
        }],
      }],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  /**
   * قواعد Next للواجهة. كانت eslint-config-next مثبَّتة وغير موصولة بشيء منذ
   * المرحلة 02 — `next lint` كان يشغّلها بنفسه، ثم حُذف الأمر في Next 16.
   * وصلُها هنا يجعل قواعد react-hooks و next تسري فعلاً، وهي تلزم شاشات 06.
   */
  ...nextWebVitals.map((c) => ({ ...c, files: ['apps/web/src/**/*.{ts,tsx}'] })),
  {
    /**
     * الواجهة. القواعد هنا أقلّ عدداً لا أقلّ صرامة: حرّاس الرموز والاتجاه
     * والوصولية تعيش في سكربت التحقق لأنها أنماط نصّية لا قواعد نوعية،
     * وتشغيلها هناك يجعلها تسري على CSS كما تسري على TSX.
     */
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // App Router وحده: القاعدة تبحث عن مجلد pages/ فتصرخ في كل تشغيل بلا فائدة
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
];
