/** أول دورة لمهمة طويلة بعد الإقلاع — بعد أن يُفتح المنفذ وتنتهي اتصالات الإقلاع */
export const FIRST_RUN_AFTER_MS = 15_000;

/**
 * مهمة دورية طويلة (5 دقائق فأكثر): دورة أولى بعد الإقلاع بـ 15 ثانية، ثم كل `everyMs`.
 * يعيد ما يوقف المؤقّتين معاً.
 *
 * كان كلٌّ منها setInterval وحده، فأول دورة بعد فترة كاملة من الإقلاع — ساعة لتحرير
 * الأرصدة — وإعادة التشغيل قبلها تعيد العدّ. على استضافة تنام عند الخمول أو بنشر متكرّر
 * قد لا يتحرّر مال أبداً (SYS-024، 2 نوفمبر 2026). مهام الدقيقة تبقى على setInterval:
 * دقيقة لا تؤخّر شيئاً.
 */
export function everyAfterBoot(run: () => void, everyMs: number): () => void {
  const first = setTimeout(run, FIRST_RUN_AFTER_MS);
  const timer = setInterval(run, everyMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
