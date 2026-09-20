'use client';

import { ProductEditor } from '@/components/product-editor';

/** VD-08 — إنشاء منتج. المحرّر نفسه يخدم الإنشاء والتحرير: شاشة واحدة لا شاشتان. */
export default function NewProductPage() {
  return <ProductEditor />;
}
