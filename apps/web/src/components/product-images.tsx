'use client';

import { useRef, useState, type DragEvent } from 'react';
import { api, mediaUrl } from '@/lib/api';
import { Alert } from '@/components/ui';
import { Icon } from '@/components/icons';
import { num, type ProductImage } from '@/lib/catalog';

/** حدود الخادم نفسها (catalog/infrastructure/product-images) — تُفحص هنا قبل الرفع لا بدلاً منه */
export const MAX_IMAGES = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/**
 * VD-08 · 3 — صور المنتج.
 *
 * - **الأولى هي الرئيسية**: صورة البطاقة في المتجر ونتائج البحث. الترتيب بالسحب،
 *   وبزرّ «اجعلها الرئيسية» لمن لا يسحب (لوحة المفاتيح، شاشات اللمس).
 * - كل عملية تكتب في الخادم فوراً ثم يُقرأ المنتج من جديد (`onChanged`): الصور
 *   محتوى، وإضافتها أو حذفها أو تغيير الرئيسية يعيد المنشور للمراجعة — فالحالة
 *   في رأس المحرّر تُقرأ ولا تُخمَّن.
 * - الصور تُرفع إلى منتج محفوظ؛ المنتج الجديد يُحفظ أولاً.
 */
export function ProductImages({
  productId,
  images,
  onChanged,
}: {
  productId: string | null;
  images: ProductImage[];
  onChanged: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [working, setWorking] = useState(false);
  /** الترتيب المرسَل قبل أن يردّ الخادم — يُعرض فوراً ويُسقط عند الردّ */
  const [optimistic, setOptimistic] = useState<ProductImage[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [fileOver, setFileOver] = useState(false);

  const list = optimistic ?? images;
  const busy = working || uploading !== null;
  const full = list.length >= MAX_IMAGES;
  const disabled = !productId || busy;

  async function upload(files: File[]): Promise<void> {
    if (!productId || files.length === 0) return;
    const room = MAX_IMAGES - list.length;
    const found: string[] = [];
    if (files.length > room) {
      found.push(
        room <= 0
          ? 'وصلت الحد: عشر صور للمنتج. احذف صورة قبل إضافة أخرى.'
          : `الحد عشر صور للمنتج — رُفعت أول ${num(room)} وتُركت ${num(files.length - room)}.`,
      );
    }
    const chosen = files.slice(0, Math.max(room, 0));
    setProblems([]);
    setUploading({ done: 0, total: chosen.length });
    for (const [i, file] of chosen.entries()) {
      // نوع فارغ (بعض صيغ الهواتف على ويندوز) يُترك للخادم: يقرأ المحتوى لا الامتداد
      if (file.type && !ACCEPTED.includes(file.type)) {
        found.push(`${file.name}: الصيغ المقبولة JPEG و PNG و WebP و AVIF.`);
      } else if (file.size > MAX_BYTES) {
        found.push(`${file.name}: الحجم ${(file.size / (1024 * 1024)).toFixed(1)} م.ب والحد 10 م.ب.`);
      } else {
        try {
          await api(`/vendor/products/${productId}/images`, { method: 'POST', file });
        } catch (err) {
          found.push(`${file.name}: ${err instanceof Error ? err.message : 'تعذّر رفع الصورة.'}`);
        }
      }
      setUploading({ done: i + 1, total: chosen.length });
    }
    await onChanged().catch(() => undefined);
    setUploading(null);
    setProblems(found);
  }

  async function remove(image: ProductImage): Promise<void> {
    if (!productId) return;
    setWorking(true);
    setProblems([]);
    try {
      await api(`/vendor/products/${productId}/images/${image.id}`, { method: 'DELETE' });
      await onChanged();
    } catch (err) {
      setProblems([err instanceof Error ? err.message : 'تعذّر حذف الصورة.']);
    } finally {
      setWorking(false);
    }
  }

  async function reorder(next: ProductImage[]): Promise<void> {
    if (!productId || next.every((img, i) => img.id === list[i]?.id)) return;
    setWorking(true);
    setProblems([]);
    setOptimistic(next);
    try {
      await api(`/vendor/products/${productId}/images/order`, {
        method: 'PUT',
        body: { imageIds: next.map((img) => img.id) },
      });
      await onChanged();
    } catch (err) {
      setProblems([err instanceof Error ? err.message : 'تعذّر حفظ الترتيب.']);
      // 409: تغيّرت الصور منذ فُتحت الصفحة — تُقرأ من جديد بدل ترتيب نصفه قديم
      await onChanged().catch(() => undefined);
    } finally {
      setOptimistic(null);
      setWorking(false);
    }
  }

  function move(from: string, to: string): ProductImage[] {
    const next = [...list];
    const a = next.findIndex((img) => img.id === from);
    const b = next.findIndex((img) => img.id === to);
    if (a < 0 || b < 0) return next;
    next.splice(b, 0, ...next.splice(a, 1));
    return next;
  }

  function endDrag(): void {
    setDragId(null);
    setOverId(null);
  }

  /** ملفات تُسحب من الجهاز إلى مربّع الإضافة — لا بطاقة تُسحب داخل الشبكة */
  const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  return (
    <>
      {productId ? (
        <p className="vp-images__hint">
          <Icon name="grip" size={14} />
          الصورة الأولى هي الرئيسية — اسحب البطاقات لإعادة الترتيب.
        </p>
      ) : (
        <Alert tone="info">احفظ المنتج أولاً — الصور تُرفع إلى منتج محفوظ، والمسودة تكفي.</Alert>
      )}

      <ul className="vp-images" aria-label="صور المنتج">
        {list.map((image, i) => {
          const src = mediaUrl(image.urls['thumb.webp'] ?? image.urls['medium.webp']);
          const main = i === 0;
          return (
            <li
              key={image.id}
              className="vp-image"
              data-main={main}
              data-dragging={dragId === image.id}
              data-over={overId === image.id && dragId !== null && dragId !== image.id}
              draggable={!disabled}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', image.id);
                setDragId(image.id);
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                if (overId !== image.id) setOverId(image.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragId;
                endDrag();
                if (from && from !== image.id) void reorder(move(from, image.id));
              }}
              onDragEnd={endDrag}
            >
              <div className="vp-image__frame">
                {src ? (
                  // مصغّرة من خادم الرفع مباشرةً؛ next/image يحتاج إعداد مضيف بعيد
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={image.altAr ?? `صورة المنتج ${num(i + 1)}`} draggable={false} />
                ) : (
                  <Icon name="image" size={24} />
                )}
                <span className="vp-image__badge num">{main ? 'الرئيسية' : String(i + 1).padStart(2, '0')}</span>
              </div>
              <div className="vp-image__foot">
                {main ? (
                  <span className="vp-image__dims num" dir="ltr">
                    {image.width && image.height ? `${image.width}×${image.height}` : ''}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="vp-image__btn"
                    disabled={disabled}
                    onClick={() => void reorder(move(image.id, list[0]!.id))}
                  >
                    <Icon name="star" size={12} />
                    اجعلها الرئيسية
                  </button>
                )}
                <button
                  type="button"
                  className="vp-image__remove"
                  aria-label={`احذف الصورة ${num(i + 1)}`}
                  disabled={disabled}
                  onClick={() => void remove(image)}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            </li>
          );
        })}

        {uploading
          ? Array.from({ length: uploading.total - uploading.done }, (_, i) => (
              <li key={`up-${i}`} className="vp-image vp-image--pending" aria-hidden>
                <div className="vp-image__frame">
                  <span className="spinner" />
                </div>
              </li>
            ))
          : null}

        {!full ? (
          <li>
            <button
              type="button"
              className="vp-images__add"
              data-over={fileOver}
              disabled={disabled}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                if (disabled || !carriesFiles(e)) return;
                e.preventDefault();
                setFileOver(true);
              }}
              onDragLeave={() => setFileOver(false)}
              onDrop={(e) => {
                if (disabled || !carriesFiles(e)) return;
                e.preventDefault();
                setFileOver(false);
                void upload(Array.from(e.dataTransfer.files));
              }}
            >
              <Icon name="upload" size={20} />
              <span>أضف صورة</span>
            </button>
          </li>
        ) : null}
      </ul>

      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(',')}
        multiple
        hidden
        aria-label="اختر صور المنتج"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // يُفرَّغ كي يعمل اختيار الملف نفسه ثانيةً بعد حذفه
          e.target.value = '';
          void upload(files);
        }}
      />

      <p className="visually-hidden" aria-live="polite">
        {uploading ? `جارٍ رفع الصور: ${num(uploading.done)} من ${num(uploading.total)}` : ''}
      </p>

      {problems.length === 1 ? <Alert tone="danger">{problems[0]}</Alert> : null}
      {problems.length > 1 ? (
        <Alert tone="danger" title="بعض الصور لم تُرفع">
          <ul className="vp-images__problems">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </>
  );
}
