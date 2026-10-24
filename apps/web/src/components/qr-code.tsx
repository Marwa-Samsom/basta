'use client';

import { useMemo } from 'react';
import QRCode from 'qrcode';

/** هامش الصمت حول الرمز بالوحدات — أربع كما توصي المواصفة، وإلا تعثّرت بعض الماسحات */
const QUIET = 4;

/**
 * رمز QR يُرسم هنا من النصّ نفسه، مساراً واحداً في SVG — لا يغادر النصّ (سرّ التحقق
 * مثلاً) المتصفّح إلى خدمة رسم خارجية، ولا HTML يُحقن.
 */
export function QrCode({ value, label, size = 200 }: { value: string; label: string; size?: number }) {
  const { side, path } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
    let d = '';
    for (let y = 0; y < modules.size; y++) {
      for (let x = 0; x < modules.size; x++) {
        // get(صف، عمود) — الصف y والعمود x؛ بالعكس يُرسم الرمز معكوساً على قطره فلا يُقرأ
        if (modules.get(y, x)) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
      }
    }
    return { side: modules.size + QUIET * 2, path: d };
  }, [value]);

  return (
    <svg className="ac-qr" role="img" aria-label={label} viewBox={`0 0 ${side} ${side}`} width={size} height={size} shapeRendering="crispEdges">
      <rect className="ac-qr__paper" width={side} height={side} />
      <path className="ac-qr__ink" d={path} />
    </svg>
  );
}
