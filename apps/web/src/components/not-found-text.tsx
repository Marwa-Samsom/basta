'use client';

import { useT } from '@/components/locale';

/** نصوص صفحة «لم نجد هذه الصفحة» بلغة الصفحة — app/not-found.tsx متزامنة ولا تقرأ الكوكي */
export function NotFoundText({ part }: { part: 'title' | 'body' | 'shops' | 'home' }) {
  const t = useT();
  switch (part) {
    case 'title':
      return t('لم نجد هذه الصفحة', "We couldn't find this page");
    case 'body':
      return t(
        'قد يكون الرابط قديماً، أو نُقل المنتج أو أوقف البائع عرضه. ابحث عمّا تريد أو ابدأ من المتاجر.',
        'The link may be old, or the product was moved or the seller stopped listing it. Search for what you want or start from the shops.',
      );
    case 'shops':
      return t('تصفّح المتاجر', 'Browse shops');
    case 'home':
      return t('عُد إلى الرئيسية', 'Back to home');
  }
}
