import { formatMoney } from '@/lib/money';

/**
 * صفحة تحقّق مؤقتة — تثبت أن الرموز موصولة وأن دالة المال
 * تعرض الدينار بثلاث خانات والدولار باثنتين. تُستبدل في المرحلة 07.
 */
export default function Home() {
  const samples = [
    { minorUnits: 24_900n, currency: 'SAR' },
    { minorUnits: 70_900n, currency: 'JOD' },
    { minorUnits: 50_000n, currency: 'USD' },
  ] as const;

  return (
    <main
      style={{
        maxWidth: 'var(--width-form)',
        margin: '0 auto',
        paddingInline: 'var(--space-5)',
        paddingBlock: 'var(--space-16)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
      }}
    >
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>بسطة</h1>
      <p style={{ color: 'var(--text-muted)', margin: 0 }}>
        الهيكل قائم. الرموز موصولة، والسمتان تتبعان إعداد نظامك.
      </p>

      <section
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        <h2 style={{ fontSize: 'var(--text-md)' }}>فحص الخانات العشرية</h2>
        {samples.map((s) => (
          <div
            key={s.currency}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
          >
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              {String(s.minorUnits)} بأصغر وحدة {s.currency}
            </span>
            <span className="price">{formatMoney(s.minorUnits, s.currency)}</span>
          </div>
        ))}
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', margin: 0 }}>
          الدينار ثلاث خانات لا اثنتان — الرقم نفسه يعني قيمتين مختلفتين بعشرة أضعاف.
        </p>
      </section>
    </main>
  );
}
