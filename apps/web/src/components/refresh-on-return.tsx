'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useReturnTick } from '@/lib/fresh';

/**
 * صفحات المتجر تُرسم على الخادم: الرجوع إليها يعيد رسمها بصمت (`router.refresh`) — الأسعار والمخزون
 * والتقييمات كما هي الآن بلا F5، وما في الصفحة من حالة (كمية مختارة، نصّ بحث) يبقى. قراءات المتجر
 * محفوظة على الخادم دقيقة واحدة (revalidate)، فالجديد يظهر خلالها لا أبطأ.
 */
export function RefreshOnReturn(): null {
  const router = useRouter();
  const returned = useReturnTick();
  useEffect(() => {
    if (returned) router.refresh();
  }, [returned, router]);
  return null;
}
