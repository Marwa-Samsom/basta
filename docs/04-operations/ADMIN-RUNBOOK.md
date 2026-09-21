# دليل التشغيل اليومي — لوحة الإدارة

> بوابة المرحلة 11 البند الأول: **لا عملية تشغيلية يومية واحدة تتطلّب فتح قاعدة البيانات.**
> كل سطر أدناه عملية حقيقية، والشاشة التي تُنجز منها، والصلاحية التي تحتاجها، والاختبار الذي يثبت أنها تعمل.

## الاستثناء الوحيد — المدير الأول

قبل وجود أي مدير لا توجد لوحة يُمنح منها أحد. مرة واحدة في عمر المنصة:

```bash
npm run admin:grant -- someone@example.com
```

الشخص ينشئ حسابه من `/register` بنفسه أولاً — فلا تمرّ كلمة مرور بيد أحد — ثم يمنحه الأمر كل الصلاحيات. عند أول دخول يُحوَّل إلى `/account/2fa` ولا يفتح شيئاً قبل تفعيل التحقق الثنائي. بعدها يمنح المديرون غيرهم من AD-23.

## العمليات

| العملية | الشاشة | الصلاحية | الإثبات |
|---|---|---|---|
| مراجعة بائع، قبول/رفض وثائقه، اعتماده أو رفضه بسبب | `/admin/vendors` ← الملف | `vendors.review` | `vendors.integration.spec.ts` |
| تعليق متجر وإعادته | `/admin/vendors/[id]` | `vendors.review` | `vendors.integration.spec.ts` |
| اعتماد منتج أو رفضه بسبب، وإيقاف منشور | `/admin/products` | `catalog.manage` | `catalog.integration.spec.ts` |
| الفئات: إضافة، تسمية، نقل فرع، إخفاء | `/admin/categories` | `catalog.manage` | `catalog.integration.spec.ts` |
| السمات: إنشاء، قيم جديدة، ربط بفئة | `/admin/categories` ← السمات | `catalog.manage` | `catalog.integration.spec.ts` |
| البحث عن طلب بالرقم أو العميل أو المتجر | `/admin/orders` | `orders.manage` | `admin.integration.spec.ts` |
| إلغاء متجر من طلب قبل الشحن مع ردّ المبلغ | `/admin/orders` ← التفاصيل | `orders.cancel` | `orders.integration.spec.ts` |
| استلام مرتجع بدل متجر متعثّر | `/admin/returns` | `orders.manage` | `admin.integration.spec.ts` |
| متابعة الاستردادات والرصيد السالب الناتج | `/admin/returns` | `orders.manage` | `admin.integration.spec.ts` |
| نزاع مصعَّد: مراسلة الطرفين وحسمه بقرار مكتوب | `/admin/disputes` | `disputes.resolve` | `orders.integration.spec.ts` |
| طلبات السحب: موافقة، تسجيل تحويل بمرجع، رفض بسبب | `/admin/payouts` | `payouts.approve` | `finance.integration.spec.ts` |
| تغيير نسبة عمولة (بائع/فئة/عامة) من الآن | `/admin/commissions` | `commissions.edit` | `finance.integration.spec.ts` |
| إضافة سعر صرف | `/admin/currencies` | `settings.edit` | `admin.integration.spec.ts` |
| الإعدادات (التعليق، الإرجاع، الهامش…) والضرائب لكل بلد | `/admin/settings` | `settings.edit` | `admin.integration.spec.ts` |
| كوبون: إنشاء، إيقاف | `/admin/coupons` | `coupons.manage` | `admin.integration.spec.ts` |
| بانر: رفع صورة، جدولة، إخفاء | `/admin/storefront` | `content.manage` | `admin.integration.spec.ts` |
| المنتجات المميّزة في الرئيسية وترتيبها | `/admin/storefront` | `content.manage` | `admin.integration.spec.ts` |
| صفحات المحتوى (من نحن، الشروط…) | `/admin/pages` | `content.manage` | `admin.integration.spec.ts` |
| إخفاء مراجعة مسيئة وإعادتها | `/admin/reviews` | `content.manage` | `admin.integration.spec.ts` |
| تحرير قالب إشعار، معاينته، إرسال تجربة، توقيع مراجعته اللغوية | `/admin/notifications` | `content.manage` | `admin.integration.spec.ts` |
| عميل: بحث، ملفه، تعليقه (يُنهي جلساته) وإعادته | `/admin/customers` | `customers.manage` | `admin.integration.spec.ts` |
| منح الإدارة، تعديل الصلاحيات، سحبها | `/admin/users` | `users.manage` | `admin.integration.spec.ts` |
| من فعل ماذا ومتى — بقيمته قبل وبعد | `/admin/audit` | `audit.view` | `admin.integration.spec.ts` |
| المؤشرات والتقرير المالي وتصديره Excel/CSV | `/admin`، `/admin/reports` | `reports.view` | `admin.integration.spec.ts` |
| رصد انحراف في الدفتر أو المخزون | تنبيه أحمر في `/admin` | `reports.view` | `admin.integration.spec.ts` |

## ما يجري وحده — بلا تدخّل

| المهمة | المتى | الأثر |
|---|---|---|
| مصالحة الدفعات المعلّقة | كل دقيقة | «لا نعرف» يُحسم مدفوعاً أو فاشلاً |
| انتهاء الحجوزات | كل دقيقة | المخزون المحجوز يعود |
| إلغاء ما لم يقبله البائع | كل 5 دقائق | بعد `vendor_accept_timeout_hours` مع ردّ المبلغ |
| إكمال المسلَّم | كل 5 دقائق | بعد `hold_period_days` بلا نزاع |
| إعادة الاسترداد المعلّق | كل 5 دقائق | سقوط بين الالتزام والبوابة لا يضيّع مالاً |
| تحرير أرصدة البائعين | كل ساعة | المعلّق ← المتاح بلا نزاع ولا إرجاع قائم |
| إرسال الإشعارات | كل 5 ثوانٍ | الصندوق الصادر ← القنوات |
| تقدّم الشحنات (الشركة الوهمية) | كل 10 دقائق | أحداث التتبّع حتى التسليم |

## الإشعارات محلياً

كل قناة تُسلِّم إلى صندوق محلي في `apps/api/outbox/<القناة>/`: البريد ملف `.eml` يُفتح بأي برنامج بريد، والنصية وواتساب والمتصفّح ملفات JSON بما كان سيُرسل للمزوّد حرفياً. «داخل الموقع» تظهر في جرس الإشعارات. استبدال المحوّل بمزوّد حقيقي لا يمسّ القوالب ولا الصندوق الصادر — قرار صاحب المشروع عند الإطلاق.
