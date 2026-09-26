'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';

/** حدث beforeinstallprompt — ليس في أنواع DOM القياسية بعد */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'basta.install.dismissedAt';
/** «لاحقاً» تُخفي الدعوة أسبوعاً — كما في التصميم «نسألك بعد أسبوع» */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // التخزين محظور: تُخفى الدعوة لهذه الجلسة فقط
  }
}

const standalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * SH-08 — دعوة تثبيت التطبيق.
 *
 * لا تظهر إلا حين يعرض المتصفّح نفسه إمكانية التثبيت (`beforeinstallprompt`):
 * متصفّح لا يدعمه، أو تطبيق مثبّت أصلاً، أو دعوة أُجّلت — لا شيء يُرسم.
 * الزرّ يستدعي نافذة التثبيت الأصلية للمتصفّح؛ لا وعد بشيء لا يحدث.
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (standalone() || snoozed()) return;
    const onPrompt = (e: Event): void => {
      e.preventDefault(); // نعرض دعوتنا بدل شريط المتصفّح
      setEvent(e as InstallPromptEvent);
    };
    const onInstalled = (): void => setEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!event) return null;

  async function install(): Promise<void> {
    if (!event) return;
    const e = event;
    setEvent(null); // الحدث يُستعمل مرة واحدة
    try {
      await e.prompt();
      const choice = await e.userChoice;
      if (choice.outcome === 'dismissed') snooze();
    } catch {
      // المتصفّح رفض عرض النافذة — لا شيء نفعله
    }
  }

  function later(): void {
    snooze();
    setEvent(null);
  }

  return (
    <aside className="sx-install" aria-labelledby="sx-install-title">
      <span className="sx-install__grip" aria-hidden />
      <div className="sx-install__head">
        <span className="sx-install__icon" aria-hidden>
          ب
        </span>
        <span className="sx-install__text">
          <span id="sx-install-title" className="sx-install__title">
            ثبّت بسطة على شاشتك
          </span>
          <span className="sx-install__sub">كتطبيق على هاتفك، دون متجر تطبيقات</span>
        </span>
        <button type="button" className="icon-btn icon-btn--sm sx-install__close" aria-label="إغلاق" onClick={later}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <ul className="sx-install__points">
        <li>
          <Icon name="check" size={14} />
          يفتح من شاشتك الرئيسية بنقرة
        </li>
        <li>
          <Icon name="check" size={14} />
          الصفحات التي زرتها تبقى متاحة عند انقطاع الاتصال
        </li>
      </ul>
      <div className="sx-install__actions">
        <button type="button" className="btn btn--primary btn--block" onClick={() => void install()}>
          <Icon name="download" size={17} />
          ثبّت الآن
        </button>
        <button type="button" className="btn btn--secondary btn--block" onClick={later}>
          لاحقاً
        </button>
      </div>
    </aside>
  );
}
