'use client';

import { use } from 'react';
import { ProductEditor } from '@/components/product-editor';

/** VD-08 — تحرير منتج قائم. */
export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProductEditor productId={id} />;
}
