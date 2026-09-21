import Link from 'next/link';

/** SH-05 — الصفحة غير موجودة. تقول ماذا تفعل الآن، لا «404» وحدها. */
export default function NotFound() {
  return (
    <main className="shell">
      <h1>هذه الصفحة غير موجودة</h1>
      <p className="muted">ربما نُقل المنتج أو أوقف البائع عرضه، أو الرابط مكتوب خطأ.</p>
      <div className="row">
        <Link className="btn btn--primary" href="/">
          الرئيسية
        </Link>
        <Link className="btn btn--secondary" href="/categories">
          تصفّح الفئات
        </Link>
      </div>
    </main>
  );
}
