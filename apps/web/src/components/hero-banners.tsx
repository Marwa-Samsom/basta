'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';

export interface HeroSlide {
  id: string;
  title: string | null;
  /** مسار داخلي فُحص على الخادم — null بلا رابط */
  href: string | null;
  src: string;
}

/**
 * البطل بلافتات «أعلى الرئيسية» — ACFG-052، 5 نوفمبر 2026: كانت الأولى وحدها تظهر ولا تُرى البقية في أي
 * مكان. تتبدّل كل سبع ثوانٍ، ونقاط تحتها لاختيار لافتة بعينها؛ ويقف التبدّل حين يقف المؤشّر أو التركيز
 * عليها، ولا يبدأ لمن طلب جهازه حركة أقلّ. بلا لافتات: اللوحة بنصّها وحدها كما كانت.
 */
export function HeroBanners({
  slides,
  kicker,
  title,
  body,
}: {
  slides: HeroSlide[];
  kicker: string;
  /** العنوان حين لا لافتة أو لافتة بلا عنوان */
  title: string;
  body: string;
}) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (slides.length < 2 || paused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setIndex((n) => (n + 1) % slides.length), 7000);
    return () => window.clearInterval(timer);
  }, [slides.length, paused]);

  const slide = slides[index % Math.max(slides.length, 1)];
  return (
    <section
      className={slide ? 'sd-hero sd-hero--media' : 'sd-hero'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="sd-hero__panel">
        <span className="sd-hero__kicker">{kicker}</span>
        <h1 className="sd-hero__title">{slide?.title ?? title}</h1>
        <p className="sd-hero__body">{body}</p>
        {slide?.href ? (
          <Link href={slide.href} className="btn btn--on-brand btn--lg sd-hero__cta">
            {t('تسوّق الآن', 'Shop now')}
            <Icon name="next" size={17} mirror />
          </Link>
        ) : (
          <Link href="/shops" className="btn btn--on-brand btn--lg sd-hero__cta">
            {t('تصفّح المتاجر', 'Browse shops')}
            <Icon name="next" size={17} mirror />
          </Link>
        )}
        {slides.length > 1 ? (
          <div className="sd-hero__dots" role="group" aria-label={t('لافتات الرئيسية', 'Home banners')}>
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className="sd-hero__dot"
                aria-label={t(`اللافتة ${i + 1} من ${slides.length}`, `Banner ${i + 1} of ${slides.length}`)}
                aria-pressed={i === index % slides.length}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        ) : null}
      </div>
      {slide ? (
        <div className="sd-hero__media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={slide.id} src={slide.src} alt={slide.title ?? t('عرض', 'Offer')} />
        </div>
      ) : null}
    </section>
  );
}
