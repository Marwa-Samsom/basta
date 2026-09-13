# خارطة الوحدات وحدودها

> المرحلة 01 · منصة بسطة · ADR-002 (Modular Monolith)

## القاعدة الحاكمة

كل وحدة تملك جداولها. **لا وحدة تقرأ أو تكتب جداول وحدة أخرى مباشرة** — التواصل عبر واجهة الخدمة المعلنة فقط. الحدّ يُفرض بفحص آلي في خط CI يرفض أي استيراد عابر للحدود.

هذه ليست شكليات: الحدّ المحفوظ هو ما يجعل استخراج وحدة كخدمة مستقلة لاحقاً عملية أيام لا أشهر.

---

## بنية المجلدات

```
src/modules/
  identity/        auth, users, roles, sessions, audit
  vendors/         profiles, documents, approval, staff
  currency/        currencies, fx rates, conversion, rounding
  catalog/         categories, attributes, brands, products, variants
  inventory/       stock, movements, reservations, expiry sweep
  cart/            carts, items, pricing preview
  pricing/         tax, coupons, shipping quote, totals
  checkout/        order creation, orchestration
  orders/          sub-orders, state machine, history
  shipping/        zones, rates, shipments, tracking
  payments/        adapters, intents, webhooks, refunds
  finance/         commission engine, ledger, wallets, payouts
  aftersales/      returns, disputes, reviews
  notifications/   templates, channels, dispatch
  admin/           dashboards, reports, content, settings
  search/          indexing, query, sync
```

كل وحدة بالبنية نفسها:
```
<module>/
  <module>.module.ts     التعريف والتصدير
  api/                   المتحكّمات — لا منطق أعمال
  domain/                الكيانات والقواعد والثوابت
  application/           حالات الاستخدام والمعاملات
  infrastructure/        المستودعات والتكاملات الخارجية
  public/                ← الواجهة الوحيدة التي تراها الوحدات الأخرى
  __tests__/
```

**قاعدة الاستيراد الوحيدة:** وحدة أخرى تستورد من `<module>/public` فقط. أي مسار آخر يفشل الفحص.

---

## جدول الوحدات

| الوحدة | تملك | تعتمد على | المرحلة |
|--------|------|-----------|---------|
| `identity` | users, roles, permissions, refresh_tokens, otp, audit_logs | — | 04 |
| `vendors` | vendors, documents, bank_accounts | identity, currency | 06 |
| `currency` | currencies, exchange_rates | — | 05 |
| `catalog` | categories, attributes, brands, products, variants, images | vendors، **inventory** | 05 |
| `inventory` | inventory, movements, **stock_reservations** | — *(الطبقة الأدنى)* | 05 |
| `cart` | carts, cart_items | catalog, pricing | 07 |
| `pricing` | tax_rates, coupons, redemptions | catalog, shipping, currency | 08 |
| `checkout` | — *(منسّق بلا جداول)* | cart, pricing, inventory, payments, orders, finance | 08 |
| `orders` | orders, sub_orders, order_items, status_history | vendors, catalog | 08 |
| `shipping` | zones, regions, rates, shipments, events | vendors, orders | 09 |
| `payments` | payments, payment_events, refunds | orders | 08 |
| `finance` | commission_rules, wallets, ledger_entries, payouts | vendors, orders, currency | 10 |
| `aftersales` | returns, disputes, messages, reviews | orders, finance | 09 |
| `notifications` | templates, notifications, push_subscriptions | identity | 11 |
| `admin` | cms_pages, banners, menus, settings | الجميع (قراءة) | 11 |
| `search` | — *(فهرس Meilisearch)* | catalog, vendors | 07 |

> **عكس اتجاه في المرحلة 05.** الجدول الأصلي جعل `inventory` يعتمد على `catalog`، لكن إنشاء منتج بمخزونه واستيراد ملف يكتبان المنتج ومخزونه في معاملة واحدة، فالكتالوج هو من يستدعي المخزون — والاتجاه الأصلي كان سيصنع اعتماداً دائرياً. الآن **المخزون لا يعرف المنتجات ولا البائعين**: الكتالوج يتحقق من الملكية ثم يستدعيه، واسم المنتج في رسالة النفاد يمرّره المستدعي. المنسّق `checkout` (المرحلة 08) يستدعيه بالطريقة نفسها.

---

## الوحدتان الحرجتان

### `checkout` — المنسّق

الوحدة الوحيدة التي تعرف كل شيء، ولا تملك جدولاً واحداً. تنسّق المعاملة الأخطر في النظام:

```
checkout.beginCheckout(cartId)          ← دخول صفحة الدفع
  ├─ inventory.reserve(ttl: 15m)        قفل الأسطر والتحقق وإنشاء الحجوزات
  ├─ currency.snapshotRates()           لقطة صرف لكل بائع بعملة مختلفة
  └─ pricing.quote()                    الشحن والضريبة والخصم
     فشل الحجز → لا دخول للصفحة، ورسالة تسمّي المنتج الناقص

checkout.placeOrder(cartId, address, paymentMethod, idempotencyKey)
  ├─ payments.authorize()               تفويض بلا خصم
  ├─ ── معاملة قاعدة بيانات واحدة ──
  │    inventory.assertReserved()       الحجوزات ما زالت active — وإلا إعادة حجز أو void
  │    orders.create()                  الطلب الأب والفرعيات واللقطات وأسعار الصرف
  │    pricing.redeemCoupon()
  ├─ ── commit ──
  ├─ payments.capture()
  └─ عند حدث النجاح:
       inventory.commit()               الحجوزات → committed، خصم on_hand
       finance.recordSale()             قيود الدفتر بعملة كل بائع
       orders.activate()                كل الفرعيات → awaiting_vendor
       notifications.dispatch()
```
> التقسيم إلى `beginCheckout` و `placeOrder` هو أثر ADR-006 مراجعة 2: الحجز صار حدثاً مستقلاً يسبق الدفع، لا خطوة داخله.

**سبب عزلها:** منطق التعويض عند الفشل معقّد ويجب أن يعيش في مكان واحد. توزيعه على وحدات متعددة هو مصدر الطلبات اليتيمة والمخزون المعلّق في كل منصة أسواق فاشلة.

### `finance` — المحاسِب

الوحدة **الوحيدة** المصرّح لها بالكتابة في `ledger_entries` و`wallets`. تصدّر:

```
recordSale(subOrder)                    قيود البيع والعمولة والشحن بعملة البائع
reverseSale(subOrder, amount)           عكس نسبي عند الاسترداد
releaseHold(subOrder)                   pending → available بقيدين
requestPayout(vendor, currency, amount) مع قفل الرصيد وفحص الحد الأدنى
getStatement(vendor, currency, range)   كشف حساب لعملة واحدة
```
> كل دالة تأخذ **عملة صريحة**. لا توجد دالة تُرجع «رصيد البائع» بلا عملة (ADR-013).
> `chargeSubscription` **محذوفة** بإلغاء ADR-009.

**قواعد داخلية غير قابلة للتجاوز:**
- كل دالة تكتب قيداً — لا تعدّل رصيداً مباشرة
- كل معاملة تقفل صف المحفظة `SELECT ... FOR UPDATE`
- كل تصحيح قيد معاكس بـ `reverses_entry_id`، لا `UPDATE`
- صلاحيات قاعدة البيانات تمنح `INSERT`/`SELECT` فقط على الدفتر، ومشغّل يرفض `UPDATE`/`DELETE`
- **لا استعلام تجميعي بلا `GROUP BY currency`** — يُفحص في مراجعة الكود وفي التدقيق الليلي (INV-12)

---

## الأحداث الداخلية

الوحدات المتباعدة تتواصل بأحداث عبر BullMQ، لا باستدعاء متبادل — لتفادي الاعتماد الدائري:

| الحدث | يصدر من | يستهلكه |
|-------|---------|---------|
| `order.paid` | checkout | finance، notifications، search |
| `suborder.status_changed` | orders | notifications، finance، aftersales |
| `suborder.delivered` | orders | finance (يضبط `hold_release_at`) |
| `hold.released` | finance | notifications |
| `product.published` | catalog | search |
| `vendor.approved` | vendors | search، notifications |
| `dispute.opened` | aftersales | finance (يجمّد التحرير) |
| `reservation.expired` | inventory | notifications (تنبيه المشتري في صفحة الدفع) |

**قاعدة:** الحدث يحمل معرّفات لا كيانات كاملة. المستهلك يقرأ ما يحتاج عبر الواجهة العامة للوحدة المالكة.

---

## المهام المجدولة

| المهمة | التكرار | الوحدة | حرجة؟ |
|--------|---------|--------|-------|
| **تحرير الحجوزات المنتهية** | **كل دقيقة** | **inventory** | **✔** |
| تحرير الأرصدة المستحقة | يومياً | finance | ✔ |
| تسوية المدفوعات المعلّقة | كل 10 دقائق | payments | ✔ |
| إلغاء الطلبات غير المقبولة خلال 48 ساعة | كل ساعة | orders | ✔ |
| جلب أسعار الصرف | كل 6 ساعات | currency | ✔ |
| تدقيق الثوابت المالية | ليلياً | finance | ✔ |
| مزامنة فهرس البحث | كل 5 دقائق | search | |
| تنظيف السلات المنتهية | يومياً | cart | |
| تنبيهات نفاد المخزون | كل ساعة | inventory | |
| النسخ الاحتياطي | يومياً | infra | ✔ |

**كل مهمة حرجة يجب أن تكون عديمة الأثر عند التكرار** (idempotent): تشغيلها مرتين في اليوم نفسه لا ينتج قيداً مزدوجاً ولا فاتورة مكررة. هذا بند اختبار في بوابة خروج المرحلة 10.
