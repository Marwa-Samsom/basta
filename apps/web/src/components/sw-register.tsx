'use client';

import { useEffect } from 'react';

/** يسجّل عامل الخدمة في الإنتاج وحده — في التطوير يتعارض مع التحديث الفوري */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}
