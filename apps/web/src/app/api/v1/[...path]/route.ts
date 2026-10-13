import type { NextRequest } from 'next/server';

/**
 * الـ API من نطاق الواجهة نفسه.
 *
 * كوكي التحديث SameSite=Strict لا يرسله المتصفّح إلا إلى «الموقع» الذي فُتحت منه
 * الصفحة. والواجهة والـ API على نطاقين مجانيين مختلفين (pages.dev و onrender.com،
 * وكلاهما في قائمة اللواحق العامة فهما موقعان لا موقع واحد) — فكان الكوكي لا يصل
 * أبداً، ويُطرد كل مستخدم حين ينتهي رمز الوصول بعد ربع ساعة. SameSite=None لا
 * ينقذه: Safari وChrome يحجبان كوكي الطرف الثالث.
 *
 * المتصفّح يطلب /api/v1/… من الواجهة، وهذا المسار يمرّره كما هو إلى الـ API
 * ويعيد ردّه كما هو — ومعه Set-Cookie فيُحفظ الكوكي على نطاق الواجهة (Path
 * /api/v1/auth يطابق هذا المسار نفسه).
 *
 * وعنوان الزائر: كل طلب يصل الـ API الآن من خادم الواجهة، فيُرسل معه عنوان الزائر
 * وسرّ مشترك (EDGE_PROXY_SECRET) — الـ API يصدّق العنوان بالسرّ وحده (app.setup).
 * بلا سرّ يُحسب الزوار كلهم عنواناً واحداً في حدّ التخمين.
 */
const UPSTREAM = (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:4000/api/v1').replace(/\/$/, '');
const EDGE_SECRET = process.env['EDGE_PROXY_SECRET'];
const PREFIX = '/api/v1';

/**
 * لا تُمرَّر إلى الـ API: ترويسات القفزة الواحدة (RFC 9110 §7.6.1)، والمضيف وطول
 * الجسم يحسبهما fetch، و accept-encoding لأن fetch يفكّ الضغط بنفسه. وترويسات
 * العنوان كلها: ما يكتبه الزائر فيها لا يصل، والعنوان يُرسل في ترويسة السرّ وحدها.
 */
const DROP_REQUEST = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-real-ip',
  'x-basta-edge-secret',
  'x-basta-client-ip',
]);

/**
 * لا تُعاد إلى المتصفّح: fetch فكّ الضغط فصار content-encoding كذباً يفكّه المتصفّح
 * ثانيةً فيفسد الجسم، والطول تغيّر معه. Set-Cookie يُنسخ وحده (قد يتكرّر).
 */
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'set-cookie']);

/**
 * عنوان الزائر كما أضافه آخر وسيط أمام خادم الواجهة: آخر عنصر في X-Forwarded-For
 * (Cloudflare و Render وغيرهما يضيفون عنوان من اتصل بهم في آخره، وما قبله كتبه
 * الزائر). CF-Connecting-IP احتياط إن غابت — لا أولاً: على مضيف غير Cloudflare
 * يكتبها الزائر كما يشاء.
 */
function clientIp(req: NextRequest): string | null {
  const last = req.headers.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean).at(-1);
  return last || req.headers.get('cf-connecting-ip') || null;
}

async function forward(req: NextRequest): Promise<Response> {
  const target = `${UPSTREAM}${req.nextUrl.pathname.slice(PREFIX.length)}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!DROP_REQUEST.has(key)) headers.set(key, value);
  });
  const ip = EDGE_SECRET ? clientIp(req) : null;
  if (EDGE_SECRET && ip) {
    headers.set('x-basta-edge-secret', EDGE_SECRET);
    headers.set('x-basta-client-ip', ip);
  }

  const method = req.method;
  // الجسم مقروءاً كاملاً لا مجرى: أكبر رفع بضعة ميغابايتات، والمجرى يحتاج duplex الذي لا يعرفه كل مشغّل
  const body = method === 'GET' || method === 'HEAD' ? null : await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, { method, headers, body, redirect: 'manual', cache: 'no-store' });
  } catch {
    // الـ API نائم أو ساقط — بشكل أخطائه نفسه فتعرض الواجهة الرسالة كما تعرض رسائله
    return Response.json({ code: 'API_UNREACHABLE', message: 'تعذّر الوصول إلى الخادم. حاول بعد لحظات.' }, { status: 502 });
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE.has(key)) out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);

  const empty = method === 'HEAD' || upstream.status === 204 || upstream.status === 304;
  return new Response(empty ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export { forward as GET, forward as HEAD, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
