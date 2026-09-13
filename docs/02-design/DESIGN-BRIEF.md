# Design Brief — Basta Marketplace

> **For:** Claude Design — interactive UI design for the whole platform: Storefront, Vendor Dashboard, Admin Dashboard.
> **Version:** 13 September 2026 · Burgundy & beige identity · Interactive prototypes
> **Sources of truth:** [`tokens.css`](../../src/styles/tokens.css) (values) · [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) (rationale) · [SRS.md](../01-foundation/SRS.md) (requirements) · [ORDER-STATES.md](../01-foundation/ORDER-STATES.md) (state machines)
> **How to use:** paste §0 at the start of every Claude Design session, then the batch prompt from §13 with the screen specs it names from §8. Sections 1–7 are the fixed reference for every batch.

---

## 0 · Standing instructions — paste into every session

```
You are designing "Basta" (بسطة): a multi-vendor online marketplace. The UI is Arabic-first (RTL)
and also works in English (LTR). Produce INTERACTIVE, clickable prototypes — not static mockups.

Rules for every frame:
1.  Direction: primary design is Arabic RTL. Directional icons (back/next arrows, steppers) mirror.
    Logos never mirror. Latin runs inside Arabic text (SKU, tracking numbers, phone, order numbers)
    are isolated and keep LTR order.
2.  Sizes: every screen in two frames — desktop 1440px and mobile 400px. Storefront content max-width
    1280px; dashboards 1600px.
3.  Colors come only from the tokens in §2. Burgundy #8C2F46 is the brand. Dark teal #0E6B66 is
    RESERVED FOR MONEY ONLY: prices, discounts, totals, balances — never buttons, links or decoration.
    Beige neutrals: page #F8F3EC, cards #FFFFFF.
4.  Danger red is close to the burgundy family: destructive actions are outlined buttons with an icon
    and explicit text; a filled red button appears only inside a confirmation dialog.
5.  Fonts: Almarai 800 for headings, IBM Plex Sans Arabic for UI text, IBM Plex Mono for numbers in tables.
6.  Numbers are always Latin digits (79.00, not ٧٩٫٠٠). Amounts use their currency's decimals:
    SAR has 2, Jordanian and Kuwaiti dinars have 3.
7.  Every status is written as text next to its color — color alone never carries meaning.
8.  Only allowed actions are shown. A disallowed action is not shown disabled — it is not shown at all.
9.  Error messages say what happened, why, and what to do next. Never "Sorry, something went wrong".
10. No cartoon illustrations in empty states — real suggestions and an action button.
11. Density: Storefront is comfortable; Vendor and Admin dashboards are compact — same tokens.
12. Use the sample data in §10. No lorem ipsum.
13. Touch targets 44×44px on mobile. Focus is always visible as a burgundy ring.
14. Interactivity (§5): links navigate between the batch's screens, controls change state, forms
    validate, totals recalculate, drawers/modals/sheets open and close, loading → content transitions
    are shown. Include a small "state switcher" to preview empty / loading / error / edge states.
```

---

## 1 · The product

**Basta (بسطة)** — working name, replaced by the final identity later; design the logo as simple Arabic wordmark text that is easy to swap.

A **multi-vendor marketplace**, not a single store. Dozens of independent shops, each with its own products, stock, prices, shipping and wallet, on one platform that takes a commission from every sale. **No vendor subscriptions.**

| Surface | User | How it is used | Density |
|---------|------|----------------|---------|
| **Storefront** | A buyer who doesn't know the platform, mostly on mobile | Browse, compare, decide to buy — roomy, big images | comfortable |
| **Vendor Dashboard** | A shop owner or staff member, daily | Operate the shop — tables, repeated tasks | compact |
| **Admin Dashboard** | Trained platform staff | Monitor and resolve exceptions — dense financial data | compact |

**Market:** Gulf, Levant, Egypt. **Seven currencies:** USD · SAR · AED · JOD · KWD · EGP · EUR.
**Platform:** responsive web installable as an app (PWA) — no native store apps.

### Three facts that shape the UI
1. **One cart splits by vendor.** The buyer pays once, but the order becomes a sub-order per vendor, with its own shipping and status, possibly arriving on different days. **Show the split from the cart all the way to tracking** — hiding it creates complaints.
2. **Stock is reserved for 15 minutes when the buyer enters checkout**, not when adding to cart. A visible countdown timer.
3. **Vendors price in their own currency; buyers see their display currency.** Vendor earnings are released 14 days after delivery.

### Settled product decisions reflected in the screens
- **Product review before publishing (Q-15):** every product a vendor submits waits for admin approval before it appears in the store.
- **Edits to published products (Q-16):** editing *content* (name, description, images, category, attributes, variant options) sends a published product back to review; editing *price or stock* does not.

---

## 2 · Visual identity — values

### 2.1 · Raw palette

**Burgundy — brand**

| Token | Hex | | Token | Hex |
|-------|-----|-|-------|-----|
| `burgundy-50` | `#FBF1F3` | | `burgundy-500` | **`#8C2F46`** (base) |
| `burgundy-100` | `#F4DDE2` | | `burgundy-600` | `#74243A` |
| `burgundy-200` | `#E6B6C1` | | `burgundy-700` | `#5C1B2E` |
| `burgundy-300` | `#D08A9B` | | `burgundy-800` | `#451422` |
| `burgundy-400` | `#B05A70` | | `burgundy-900` | `#2E0D17` |

**Dark teal — money only** (complementary to burgundy, so it never reads as brand)

| `teal-50` | `teal-100` | `teal-300` | **`teal-500`** | `teal-600` | `teal-700` | `teal-900` |
|---|---|---|---|---|---|---|
| `#E3F2F0` | `#C4E5E1` | `#5CC6B8` | **`#0E6B66`** | `#0B5652` | `#08403D` | `#0F2624` |

**Beige — warm neutrals**

| Token | Hex | | Token | Hex |
|-------|-----|-|-------|-----|
| `beige-0` | `#FFFFFF` | | `beige-500` | `#7D6C5B` |
| `beige-25` | `#FDFAF6` | | `beige-600` | `#6B5C4D` |
| `beige-50` | `#F8F3EC` | | `beige-700` | `#4A3F35` |
| `beige-100` | `#F0E8DD` | | `beige-800` | `#332B24` |
| `beige-200` | `#E3D7C7` | | `beige-850` | `#28211C` |
| `beige-300` | `#CBBBA6` | | `beige-900` | `#1E1814` |
| `beige-350` | `#A89680` | | `beige-950` | `#14100D` |
| `beige-400` | `#958470` | | | |

**Semantic — fully separate from the brand**

| | subtle (100) | base (500) | text on subtle (600) | dark subtle (900) |
|---|---|---|---|---|
| Green · success | `#E3F1E6` | `#2F7A3E` | `#25622F` | `#13261A` |
| Orange · warning | `#FBEBDD` | `#9A4F0B` | `#7E4009` | `#2E1C0B` |
| Red-orange · danger | `#FBE3DD` | `#C23A1A` | `#A12E13` | `#331410` |
| Blue · info | `#E1EBF4` | `#2D5F8B` | `#244C70` | `#0F1E2C` |

### 2.2 · Roles — what the design actually uses

| Role | Light | Dark |
|------|-------|------|
| Page background | `#F8F3EC` | `#14100D` |
| Card | `#FFFFFF` | `#1E1814` |
| Raised surface (menus, dialogs) | `#FFFFFF` | `#28211C` |
| Sunken surface (inputs, zebra rows) | `#F0E8DD` | `#14100D` |
| Inverse surface (tooltips) | `#28211C` | `#F0E8DD` |
| Strong text (headings) | `#1E1814` | `#FDFAF6` |
| Body text | `#4A3F35` | `#E3D7C7` |
| Muted text | `#6B5C4D` | `#A89680` |
| Faint text (hints) | `#7D6C5B` | `#958470` |
| Border subtle / default | `#F0E8DD` / `#E3D7C7` | `#28211C` / `#332B24` |
| **Control border** (inputs, secondary buttons) | `#958470` | `#7D6C5B` |
| **Brand** (primary buttons, links, selection) | **`#8C2F46`** · hover `#74243A` · pressed `#5C1B2E` | **`#D08A9B`** · hover `#E6B6C1` · pressed `#F4DDE2` |
| Text on brand button | `#FFFFFF` | `#1E1814` |
| Brand subtle (selected chip bg) / brand text | `#FBF1F3` / `#74243A` | `#2E0D17` / `#D08A9B` |
| **Money** | **`#0E6B66`** | **`#5CC6B8`** |
| Money subtle bg / border | `#E3F2F0` / `#C4E5E1` | `#0F2624` / `#08403D` |
| Success / warning / danger / info | `#2F7A3E` / `#9A4F0B` / `#C23A1A` / `#2D5F8B` | `#6CC287` / `#E39A4B` / `#F07A66` / `#7FB2E0` |
| Status text on its subtle bg | `#25622F` / `#7E4009` / `#A12E13` / `#244C70` | same as base |
| Focus ring | `#B05A70` | `#D08A9B` |

**Measured WCAG contrast — all pass AA:** strong text 15.9:1 · body 10.2:1 · muted 6.4:1 · faint 5.0:1 · white on brand 8.1:1 · money on card 6.3:1 · danger 5.4:1 · control border 3.6:1 · focus ring 4.2:1 (light). Dark theme: 18.2 · 12.4 · 6.1 · 4.9 · 6.5 · 8.6 · 6.4 · 3.5 · 7.0.

> Never use base burgundy `#8C2F46` as text on a dark background — use `#D08A9B` there.

### 2.3 · Typography

| Token | Size | Use |
|-------|------|-----|
| `text-3xl` | 38 | Home hero |
| `text-2xl` | 30 | Main heading |
| `text-xl` | 24 | Page title |
| `text-lg` | 20 | Section title |
| `text-md` | 17 | Emphasis, product-page price |
| `text-base` | 15 | **Storefront base** |
| `text-sm` | 13 | **Dashboard base** |
| `text-xs` | 12 | Secondary data |
| `text-2xs` | 11 | Badges, micro labels |

- Headings **Almarai** 800 (or 700), line-height 1.25
- UI **IBM Plex Sans Arabic** 400/500/600, line-height 1.45; long prose 1.7, max 68 characters wide
- Tabular numbers **IBM Plex Mono**; every amount and table number uses tabular figures
- Prices: money teal, weight 600

### 2.4 · Spacing, shape, elevation, motion
- **4px scale only:** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80.
- **Radii — three steps:** 4 (buttons, inputs, badges) · 8 (cards, panels) · 14 (dialogs, bottom sheets) · full (avatars).
- **Control heights:** 32 (compact) · 40 (default) · 48 (large storefront CTAs). Touch minimum 44.
- **Shadows** soft with a warm brown tint: small for cards, medium for dropdowns, large for drawers, overlay for dialogs.
- **Density:** comfortable — text 15, row 48, card padding 20. Compact — text 13, row 32, card padding 16.
- **Motion:** 120ms and 200ms with a soft ease-out; honor reduced-motion.

### 2.5 · Icons and imagery
- Outline icons, 1.5px stroke, rounded caps, at 16 / 20 / 24.
- Product photos on light neutral backgrounds: 1:1 in cards, 4:5 in the product gallery.
- No cartoons and no staged stock people. Empty states suggest a real next step.

---

## 3 · Binding UI rules

### 3.1 · Money
| Rule | Example |
|------|---------|
| Latin digits always | `79.00` not `٧٩٫٠٠` |
| Currency's own decimals | SAR `249.00 ر.س.` · JOD `70.900 د.أ.` · USD `US$ 500.00` · AED `320.00 د.إ.` · EGP `450.00 ج.م.` · KWD `12.750 د.ك.` |
| Teal for the amount, not its label | "الإجمالي / Total" in strong text; `1,248.50 ر.س.` in teal |
| Compare-at price | Struck through in muted text next to the price, with a "−20%" badge on money-subtle background |
| Negative amount | Explicit minus sign in danger color in statements: `−50.00 ر.س.` |

### 3.2 · Direction
- Layout uses logical properties: "start" and "end", never "left" and "right".
- **Mirror:** back/next arrows, stepper, timeline (progresses from the right in Arabic).
- **Don't mirror:** logo, cart/search/heart icons, numeric charts, brand marks.
- **Isolate LTR inside Arabic:** `SKU: TS01-RED-M` · tracking `SA1029384756` · phone `+966 50 123 4567` · order `BST-26-004821`. This is the most common RTL bug — get it right in every table.

### 3.3 · Accessibility
- Text contrast AA on both themes; input borders 3:1.
- Every field has a visible label above it; the error is text below it, in danger color with an icon.
- Visible focus on every interactive element.

### 3.4 · The seven states of every interactive element
Default · Hover · Focus · Pressed · Disabled · Loading · Error — defined once in the component sheet.

### 3.5 · Real system copy — use as written
The UI is Arabic; English is provided for understanding and for the LTR variants.

| Situation | Arabic (UI) | English |
|-----------|-------------|---------|
| Out of stock at checkout | نفد «قميص قطني مصري». يمكنك إتمام باقي الطلب، أو إزالته ومتابعة الشراء. | "Egyptian Cotton Shirt" is sold out. You can complete the rest of the order, or remove it and continue. |
| Less stock than requested | بقي 2 فقط من «سماعات لاسلكية». قلّل الكمية أو أزل الصنف لمتابعة الشراء. | Only 2 "Wireless Headphones" left. Reduce the quantity or remove the item to continue. |
| Reservation expired | انتهت مهلة حجز سلّتك. نعيد المحاولة الآن — إن توفّر المخزون يكتمل الطلب. | Your cart reservation expired. Retrying now — if stock is available, the order completes. |
| Payment failed | فشل الدفع: رفض البنك العملية. جرّب بطاقة أخرى أو الدفع عند الاستلام. | Payment failed: the bank declined it. Try another card or cash on delivery. |
| Payout below minimum | الحد الأدنى للسحب 187.50 ر.س. رصيدك يتراكم حتى يتجاوزه، ولا يضيع منه شيء. | Minimum payout is 187.50 SAR. Your balance accumulates until it passes it — nothing is lost. |
| Stock below reserved | لا يمكن جعل المخزون 2 لأن 3 قطع محجوزة الآن لمشترين في صفحة الدفع. اختر 3 أو أكثر، أو انتظر حتى تنتهي مهلة الحجز. | Can't set stock to 2 because 3 units are reserved by buyers in checkout. Choose 3 or more, or wait for the reservation to expire. |
| Wrong login | البريد أو كلمة المرور غير صحيحة. | Email or password is incorrect. |
| Unexpected failure | حدث خلل غير متوقّع ولم يكتمل طلبك. أعد المحاولة، وإن تكرّر أبلغنا بالرقم `req-8f3a2c`. | An unexpected failure stopped your request. Try again; if it repeats, report reference `req-8f3a2c`. |
| Submit blockers (shown together) | لا يمكن إرسال المنتج بعد: المتجر لم يُعتمد بعد؛ سمات إلزامية للفئة لم تُملأ: الخامة. | Can't submit the product yet: the shop isn't approved; required category attributes missing: Material. |
| Published product edited | عدّلت محتوى منتج منشور — عاد إلى المراجعة ويظهر في المتجر بعد اعتماده. | You edited a published product's content — it's back in review and returns to the store once approved. |

### 3.6 · Glossary — Arabic UI terms

| English | Arabic | | English | Arabic |
|---------|--------|-|---------|--------|
| Add to cart | أضف إلى السلة | | Submit for review | أرسل للمراجعة |
| Checkout | إتمام الشراء | | In review | قيد المراجعة |
| Pay | ادفع | | Published | منشور |
| My orders | طلباتي | | Rejected | مرفوض |
| Wishlist | المفضلة | | Draft | مسودة |
| Categories | الأقسام | | Inventory | المخزون |
| Search | ابحث | | Wallet | المحفظة |
| Shipping | الشحن | | Payout request | طلب سحب |
| Return request | طلب إرجاع | | Available / Pending / Withdrawn | متاح / معلّق / مسحوب |
| Open a dispute | افتح نزاعاً | | Approve / Reject | اعتمد / ارفض |
| Sold out | نفد | | Reason (required) | السبب (إلزامي) |
| Only N left | بقي N فقط | | Export | تصدير |
| Sell on Basta | كن بائعاً | | Audit log | سجل التدقيق |

---

## 4 · Components

Design a **component sheet** before the screens (Batch 0), with every state, in both themes.

### 4.1 · The 47 approved components
- **Basics (12):** Button in five kinds (primary, secondary, ghost, danger, link) · Text input · Select · Checkbox · Radio · Switch · Textarea · File uploader · Date picker · Quantity stepper · Search bar · Badge
- **Layout (8):** Card · Panel · Divider · Grid · Top bar · Sidebar · Tabs · Breadcrumbs
- **Data (10):** Table with sort and pagination · Table row · Empty state · Skeleton loading · Error state · Pagination · Stat card · Sparkline · Progress bar · Status indicator
- **Commerce (9):** Product card · Thumbnail · Variant picker · Price display · Discount badge · Availability indicator · Rating stars · Vendor card · Vendor cart group
- **Feedback (8):** Inline alert · Toast · Modal · Bottom sheet · Tooltip · Confirmation · Stepper · Countdown timer

### 4.2 · Components the screens need beyond the original list
| Component | Used in |
|-----------|---------|
| Status badge per state machine (§9) | All orders, products, vendors, payouts |
| Status timeline | Order tracking, payout request |
| Variant matrix editor | Product editor |
| Multi-image uploader with drag-to-reorder | Product editor, return request |
| Draggable tree | Category tree |
| Message thread with attachments | Messages, disputes |
| Map location picker | Addresses, checkout |
| Display-currency & language switcher | Storefront header |
| 6-digit code input | OTP, two-factor |
| QR code with text secret | Two-factor setup |
| Three-balance card | Wallet |
| Blocker list | Submit for review |
| Simple rich-text editor with variable chips | Content pages, notification templates |
| Date-range picker | Reports, statements, audit log |
| Side detail drawer | Stock movements, audit diffs |
| Filter bottom sheet | Category list on mobile |
| Sticky add-to-cart bar | Product page on mobile |
| State switcher (prototype-only) | Every batch — preview empty/loading/error/edge |

### 4.3 · Product card — anatomy
1:1 image · wishlist heart in the corner · discount badge if any · product name, max two lines · shop name in muted text · stars and review count · price in teal with struck compare-at price · "بقي 3 فقط" in warning color under the threshold · "نفد" state with dimmed image and explicit text.
**Interactions:** hover lifts the card (shadow-md) and shows a second image; heart toggles with a toast; tapping opens the product page.

### 4.4 · Variant picker
Color as round swatches in the real color with the name on hover · size as text chips · **unavailable combinations shown disabled with a diagonal strike, not hidden** · choosing a variant updates price, images and availability in place.

---

## 5 · Interactivity — what "interactive" means for this project

Every batch is delivered as a **clickable prototype**. Minimum behavior:

### 5.1 · Global
- **Navigation:** header, sidebar, breadcrumbs, cards and buttons link to the batch's screens. Back works.
- **Theme & direction toggles** in a prototype toolbar: Light/Dark and Arabic RTL / English LTR, switching live.
- **State switcher** per screen: Default · Loading (skeleton) · Empty · Error · the screen's edge states listed in §8.
- **Transitions:** 200ms fades and slides for drawers, sheets and dialogs; skeletons resolve to content; toasts auto-dismiss after 4 seconds.
- **Micro-interactions:** hover, focus ring, pressed and loading states on buttons; inline validation on blur; optimistic toggles with toast confirmation.

### 5.2 · Flows that must work end-to-end in the prototype
| Flow | Steps to click through |
|------|------------------------|
| **Buy** | Home → category → filter → product → choose color & size (price/stock update) → add to cart (mini-cart drawer) → cart (change qty, totals recalc, apply coupon) → checkout (countdown ticks, choose address, per-vendor shipping, pay) → success with split sub-orders |
| **Checkout failure** | Pay → 3-D Secure dialog → declined → payment failed page → retry keeps cart |
| **Track & return** | My orders → order detail (sub-order timelines) → request return (select items, upload photo) → submitted state |
| **Vendor onboarding** | Register → documents upload (progress) → in-review → approved → pick settlement currency (confirm dialog) → store profile |
| **Create & submit product** | Products → new → pick category (attributes appear) → build variant matrix (rows generate) → upload images → submit → blocker list → fix → in review |
| **Fulfil an order** | Orders (accept countdown) → detail → accept → prepare → ship (tracking required) → delivered |
| **Import** | Download template → upload file (progress) → report 488/500 with 12 rejected lines → filter by column |
| **Admin product review** | Queue → open product → reject with reason (vendor sees it) / approve → next in queue |
| **Payout** | Vendor: wallet → request payout (min-amount validation) · Admin: queue → approve → record transfer reference |

### 5.3 · Live calculations to simulate
Cart and checkout totals (items + shipping + tax − discount) · currency switch re-renders all amounts with correct decimals · checkout countdown from 15:00 turning warning under 2:00 · vendor 48-hour accept countdown · variant matrix row generation from chosen options · import progress bar · wallet balances after a payout request.

---

## 6 · Shells and navigation

### 6.1 · Storefront
**Desktop header:** logo · "Categories" button with a three-level mega menu · central search bar with suggestions · display-currency switcher (`SAR ▾`) and language (`EN`) · account · wishlist with count · cart with count and total in teal.
**Mobile header:** logo · search icon opening full-screen search · cart.
**Mobile bottom tab bar:** Home · Categories · Search · Cart · Account.
**Footer:** About · FAQ · Return policy · Terms · Privacy · Contact · **Sell on Basta** · payment methods · "Install the app" · copyright.

### 6.2 · Vendor Dashboard
**Sidebar:** Home · Products · Inventory · Orders (count awaiting acceptance) · Returns & disputes · Messages · Shipping · Wallet · Reports · Store profile · Settings.
**Top bar:** shop name with status badge (approved / in review / suspended) · quick search · notifications · account.
**Mobile:** sidebar becomes a drawer; tables become stacked cards showing the two most important columns.

### 6.3 · Admin Dashboard
**Grouped sidebar:**
- **Overview:** Dashboard
- **Operations:** Vendors · Product review · Orders · Returns · Disputes · Customers · Product reviews
- **Catalog:** Category tree · Attributes
- **Money:** Commission rules · Payout requests · Currencies & FX · Reports
- **Marketing:** Coupons · Campaigns & featured · Home, banners & menus · Content pages
- **System:** Notification templates · Admin users · Audit log · Platform settings

**Permissions drive visibility.** Items and buttons tied to a permission the admin lacks are not shown: `vendors.approve` · `payouts.approve` · `commissions.edit` · `disputes.resolve` · `catalog.manage` · `orders.cancel`.

---

## 7 · Screen inventory overview — 86 screens

| Surface | Count | Codes |
|---------|-------|-------|
| Storefront | 31 | ST-01 … ST-31 |
| Shared (auth & system) | 8 | SH-01 … SH-08 |
| Vendor Dashboard | 21 | VD-01 … VD-21 |
| Admin Dashboard | 26 | AD-01 … AD-26 |

**(added)** marks a screen that was not in the original 47-screen inventory but is required by the requirements or the technical proposal. §12 maps the original 47.

---

## 8 · Screen specifications

Each screen: **Goal · Content (in order) · States · Interactions · Mobile notes.**

### 8.1 · Storefront — 31 screens

#### ST-01 · Home — `/`
**Goal:** discovery entry point, and trust in a marketplace the buyer doesn't know yet.
**Content:**
1. Hero carousel (1–5 admin-managed slides) with headline and button
2. Top categories strip with icons: Electronics · Fashion · Beauty · Home & Kitchen · Grocery · Handmade
3. Admin-managed campaign or "Featured products" block
4. "Today's deals" — product cards with discounted prices
5. "Selected shops" — vendor cards with logo and rating
6. "Recently viewed" — only if there is history
7. "New arrivals" per main category
8. Trust strip: verified vendors · 14-day returns · secure payment or cash on delivery
**States:** skeleton loading · brand-new platform with few products (sections suggest browsing, never blank)
**Interactions:** carousel autoplays and swipes; category strip scrolls; product-card hover and wishlist toggle; "New arrivals" tabs switch categories.
**Mobile:** full-width hero; sections scroll horizontally.

#### ST-02 · All categories — `/categories` · (added)
**Goal:** browse the full tree — essential on mobile.
**Content:** main categories with icons; each expands to its children up to four levels (e.g. Fashion → Men's clothing).
**Interactions:** expand/collapse with animation; mobile drills down with a back path.

#### ST-03 · Category listing — `/c/[slug]`
**Goal:** reach the right product fast by filtering.
**Content:**
1. Breadcrumbs · category title · result count
2. Subcategory chips
3. **Filters:** price range · brand · rating · shop · category attributes (color swatches, size chips) — **each option shows its result count**
4. Sort: relevance · newest · price low–high · price high–low · top rated
5. Applied-filter chips with "Clear all"
6. Product grid (4 columns desktop, 2 mobile) · pagination or "Load more"
**States:** loading · filters return nothing (suggest removing the last filter) · empty category · shared link with filters pre-applied
**Interactions:** toggling a filter updates the grid, counts and URL chips live; price slider; sort dropdown; "Load more" appends with skeleton cards.
**Mobile:** sticky "Filter" and "Sort" buttons; filters in a bottom sheet with "Show 128 results".

#### ST-04 · Search results — `/search?q=`
**Content:** "Results for «موبايل»" · correction if any: "Showing «موبايل» instead of «موبيل»" · tabs: Products · Shops · filters and sort as in ST-03 · results grid.
**Interactions:** tab switch; correction link re-runs the search.

#### ST-05 · No search results — state
**Content:** "No results for «سماعه بلوتوث زرقا»" · "Did you mean: سماعة بلوتوث زرقاء?" as a link · suggested alternatives (nearby products) · most-browsed categories. **Never a blank page or cartoon.**

#### ST-06 · Search suggestions — overlay on the search bar · (added)
**Appears after 3 characters.** Groups: products (thumbnail, name, price) · categories · shops · recent searches (before typing) · matched part of the text highlighted.
**Interactions:** typing filters suggestions live; arrow keys move highlight; Enter opens results; Esc closes. **Mobile:** full screen.

#### ST-07 · Product page — `/p/[slug]`
**Goal:** everything needed to decide, on one page.
**Content:**
1. Breadcrumbs
2. **Gallery** (4:5) with thumbnails and zoom
3. Name · shop link with "Verified" badge and rating · stars and review count
4. **Price in teal** · struck compare-at price · discount badge
5. **Variant picker:** color, then size (unavailable combinations disabled)
6. **Availability:** "In stock" · "Only 3 left" under the threshold · "Sold out"
7. Quantity stepper · **Add to cart** (large primary) · wishlist · compare
8. **Shipping to your area:** "Shipping to Riyadh 15.00 SAR · delivered in 2–4 days" with change-location · shop's return policy summary
9. Tabs or sections: Description · Specifications (attribute table: material, warranty…) · Reviews (verified purchase, star distribution, sort) · Questions to the shop
10. "More from this shop" · "Similar products" · "Recently viewed"
**States:** loading · variant sold out (ST-08) · unavailable combination · shop doesn't ship to the buyer's area (button still adds, with a warning) · no reviews yet
**Interactions:** variant selection swaps images, price and stock live; quantity capped by stock with a hint; add to cart opens the mini-cart drawer; gallery zoom; location change recalculates shipping; tabs.
**Mobile:** full-width swipe gallery with dots; **sticky bottom bar** with price + Add to cart.
**LTR:** design an English version of this screen.

#### ST-08 · Product sold out — state
"Sold out" badge · add button disabled with "Sold out" text · "Notify me when available" · other in-stock variants if any · similar alternatives.
**Interactions:** "Notify me" toggles to a confirmed state with a toast.

#### ST-09 · Ask the shop — modal · (added)
Question field · product and variant attached automatically · "The shop usually replies in your messages" · guests prompted to sign in first.
**Interactions:** character counter; send → success toast; modal closes.

#### ST-10 · Compare — `/compare` · (added)
Up to 4 products from the same category · rows: image, price, rating, shop, shipping, then category attributes · highlight differences toggle · remove a product · floating compare bar appears in listings when two or more are chosen.
**Interactions:** "Highlight differences" switch; remove animates column out. **Mobile:** two products side by side with horizontal scroll.

#### ST-11 · Shop page — `/s/[slug]`
**Content:** cover · logo (never mirrored) · name and "Verified" badge · rating and count · "On Basta since 2026" · description · shipping policy · return policy · "Message the shop" · shop products with filters and sort · reviews.

#### ST-12 · Suspended shop — state
Cover and name remain · **neutral, non-shaming** message: "هذا المتجر لا يستقبل طلبات حالياً" (This shop isn't taking orders right now) · no products · similar shops.

#### ST-13 · Cart — `/cart` + mini-cart drawer
**Goal:** one cart across several shops, no price surprises.
**Content:**
1. **Groups by shop** — each: shop name · items (image, name, variant, unit price, quantity stepper, remove, move to wishlist) · subtotal · **this shop's shipping** · delivery time
2. **Price-changed alert** on an item: "Price changed from 99.00 to 79.00 SAR since you added it"
3. **Uncovered area:** only that shop's group is flagged "Doesn't ship to your area — remove its items to continue with the rest"; the rest proceeds
4. Coupon field
5. **Summary:** items · shipping (all shops) · tax · discount · **total in teal** · switchable display currency
6. "Checkout" button · "Price is locked and stock reserved at checkout"
**States:** loading · guest cart merged after sign-in ("We added 2 items from your previous cart") · an item became sold out inside the cart
**Interactions:** quantity changes recalculate group subtotal, shipping and total with a brief highlight; remove with undo toast; coupon apply → success or specific error; currency switch re-renders amounts.
**Mini-cart:** side drawer after adding: added item · item count · total · "View cart" and "Checkout".
**Mobile:** summary as a sticky bottom sheet with total and button.

#### ST-14 · Empty cart — state
"Your cart is empty" · real categories to browse · "Recently viewed" · "Browse products" button. No cartoon.

#### ST-15 · Checkout — `/checkout`
**Goal:** one-step completion, every cost visible before paying.
**Content — one page with sequential sections:**
- **Sticky countdown at the top:** "We reserved your items · 14:32" — turns warning color in the last two minutes
1. **Contact:** email and phone for guests · account details with "Change" for members
2. **Address:** saved addresses as selectable cards · "New address" with fields: country, region, city, district, street, building, floor, landmark, recipient name, phone · **pin on a map**
3. **Shipping per shop:** a card per shop with its items, shipping method, cost and delivery time
4. **Payment:** card (gateway fields) · cash on delivery if the shop allows · digital wallet
5. **Review:** "Your order arrives in 3 shipments from 3 shops" with a card per sub-order
6. **Sticky summary:** items · shipping · tax · discount · **total in teal** · "Charged in Saudi riyals" · button "ادفع 1,248.50 ر.س."
**States — design all:**
- **Out of stock on entry:** page doesn't open; instead "«قميص قطني مصري» sold out" with "Remove and continue" and "Back to cart"
- **Reservation expired:** banner "Reservation expired — reserving again…" then success or sold-out message
- **Uncovered area for one shop:** its card flagged, the rest continues
- **3-D Secure:** gateway dialog over the page
- **Processing payment:** button loading, page locked
- **Field error:** directly under the field
**Interactions:** countdown ticks live; completed sections collapse to a summary with "Edit"; address card selection updates shipping; new-address form validates on blur and map pin moves; payment method switch reveals fields; pay → processing → success or failure.
**Mobile:** sections stack with collapsed headers after completion; countdown, total and button sticky.
**LTR:** design an English version.

#### ST-16 · Payment failed — `/checkout/failed`
**Specific reason, not generic:** "Payment failed: the bank declined it." · what to do: "Try another card or cash on delivery" · "Your cart is saved in full" · "Try again" · "Change payment method" · **nothing was charged**.

#### ST-17 · Order placed — `/orders/[number]/confirmed`
"We received your order" · order number `BST-26-004821` with copy · **a separate card per sub-order from the first moment:** shop · items · status "Waiting for the shop to accept" · expected delivery · amount paid and currency · what's next (shop accepts within 48 hours, notifications will follow) · for guests: "Create a password to track your orders" · "Continue shopping".
**Interactions:** copy order number → toast; guest password field inline.

#### ST-18 · My orders — `/account/orders`
List of parent orders: number · date · total · **derived status** · small chips for each sub-order status · filter: all · in progress · completed · canceled · search by number.
**States:** no orders yet (suggest browsing) · loading.

#### ST-19 · Order detail & tracking — `/account/orders/[number]`
**Content:**
1. Order header: number · date · parent order status · shipping address · payment method
2. **A card per sub-order:** shop · sub-order number `BST-26-004821-B` · **status timeline** with dates · carrier and **tracking number isolated LTR** with copy · shipment events · items · subtotal
3. **Actions appear by status only:**
   - "Cancel" only in "Waiting for shop" and "Accepted"
   - "Request a return" after "Delivered" and within the window: "9 days left to return"
   - "Open a dispute" · "Review product" per item after delivery
   - "Message the shop"
4. Money summary: items · shipping · tax · discount · total · refunded if any
**States:** one sub-order canceled while siblings continue · delivery failed · returned and refunded
**Interactions:** timeline steps expand event details; cancel → confirmation dialog with reason → status updates; copy tracking.

#### ST-20 · Return request — `/account/orders/[number]/return`
Select items and quantity · reason list (wrong size, damaged, not as described, other) · description · **photos** · refund preview · "9 days left" · submit · then request status: submitted · approved · received · rejected with reason.
**Interactions:** selecting items updates the refund preview; photo upload with thumbnails and remove; submit → status timeline.

#### ST-21 · Dispute — open & thread · (added)
Open: sub-order · against the shop · reason · description · attachments.
Thread: messages between buyer, shop and admin with distinct role styling · status · "Admin joined" · admin decision and its money outcome.
**Interactions:** composer with attachment chips; new message appends; status banner changes when admin resolves.

#### ST-22 · Write a review — modal or page · (added)
Delivered items only: stars · title · text · "Verified purchase" · state "Awaiting publication".
**Interactions:** hover/tap star rating; required validation; submit → pending state.

#### ST-23 · Wishlist — `/account/wishlist`
Product cards · price-changed or sold-out alerts · move to cart · remove.
**Empty state:** suggest categories.

#### ST-24 · Recently viewed — `/account/recent` · (added)
Grid of recently viewed products · clear history (with confirmation).

#### ST-25 · Account — profile, security, sessions — `/account`
**Profile:** name · email with "Verified" / "Not verified" and "Send verification code" · phone with code verification.
**Security:** change password · two-factor (optional for buyers).
**Active sessions:** devices and browsers with last activity · "Sign out of all sessions".
**Preferences:** language · default display currency · notification channels (email, SMS, WhatsApp, browser notifications).
**Interactions:** inline edit with save/cancel; sign-out-all confirmation; channel switches toggle with toast.
**Mobile:** a list of sections, each opening its own page.

#### ST-26 · Addresses — `/account/addresses`
Address cards with a label (Home, Work) · "Default" · add and edit with address fields and map · delete.
**Interactions:** set default instantly; edit in a drawer; delete with undo.

#### ST-27 · Notification center — `/account/notifications` · (added)
Chronological list: order status change · tracking number · shop reply · dispute decision · unread highlighted · "Mark all as read".
Same pattern reused in the Vendor and Admin dashboards with compact density.
**Interactions:** click marks read and navigates; filter unread.

#### ST-28 · My messages — `/account/messages` · (added)
Conversations with shops (linked product or order) · message thread · attachments. **Not live chat** — asynchronous messages.

#### ST-29 · Sell on Basta — `/sell` · (added)
Marketing page for vendors: "Sell to customers across the Gulf, Levant and Egypt" · **commission per sale only, no subscription** · "Price and get paid in your own currency" · "Earnings released 14 days after delivery" · four steps (register, upload documents, we review, start selling) · FAQ · "Register your shop".
**Interactions:** FAQ accordion; CTA to VD-01.

#### ST-30 · Content page — `/pages/[slug]` · (added)
**One template** for: About · FAQ · Return policy · Terms & conditions · Privacy policy · Contact.
Title · last updated · table of contents for long pages · prose at 68 characters wide · FAQ as accordion.

#### ST-31 · Guest order tracking — `/track` · (added)
For buyers without an account: order number + email or phone · then ST-19 without account actions.

---

### 8.2 · Shared — 8 screens · (all added)

#### SH-01 · Sign in — `/login`
Email · password (show/hide) · "Forgot password?" · "No account? Create one" · generic error "Email or password is incorrect" · **temporary lockout state** after many attempts: "Too many attempts from this device. Wait 15 minutes, then try again."

#### SH-02 · Create account — `/register`
Name · email · password (min 8, strength meter) · optional phone in international format with country picker · accept terms · then SH-03.
**Interactions:** strength meter updates live; inline validation.

#### SH-03 · Verification code — `/verify`
"We sent a 6-digit code to `+966 50 •••• 567`" · 6-box input · "Expires in 09:41" · "Resend" after a cooldown · after 5 wrong attempts: "The code is no longer valid. Request a new one."
**Interactions:** auto-advance between boxes; paste fills all; countdown ticks; resend cooldown.

#### SH-04 · Forgot / reset password — `/forgot`, `/reset`
Email entry · "If this email is registered, you'll receive a message" (never reveals whether the account exists) · new-password page.

#### SH-05 · Page not found — 404
"We couldn't find this page" · search bar · main categories · back home.

#### SH-06 · Unexpected failure — 500
Copy from §3.5 **with the request reference and a copy button** · "Try again" · "Contact us".

#### SH-07 · Offline — PWA
"No internet connection" · what works offline: recently viewed and the cart (view only) · "Try again".

#### SH-08 · Install prompt — component
Mobile bottom sheet: app icon · "Install Basta on your home screen — order notifications without a store app" · "Install" · "Later".

---

### 8.3 · Vendor Dashboard — 21 screens

> Onboarding (VD-01 to VD-05) uses full-page steps with a stepper, not the dashboard shell.
> **Onboarding path:** register → documents → in review → (approved) → settlement currency → store profile → shipping → first product → submit for review.

#### VD-01 · Vendor registration — `/vendor/register`
Stepper: Account · Shop · Documents · Review.
**Account:** name · email · password · phone.
**Shop:** shop name in Arabic and English · URL `basta.com/s/dar-alqutn` (live preview) · country · business type · main category.
**Interactions:** URL slug auto-generates from the English name and checks availability; step navigation with validation.

#### VD-02 · Upload documents — `/vendor/onboarding/documents`
Four upload cards: commercial registration · national ID · tax certificate · bank account proof · each: accepted formats and limit (PDF or image) · preview · replace · per-document status (uploaded, accepted, rejected with reason).
**Bank account:** holder name · IBAN (LTR isolated) · bank · SWIFT.
**Interactions:** drag-and-drop with upload progress; IBAN formats as you type.

#### VD-03 · In review / rejected — `/vendor/onboarding/status`
**In review:** "We're reviewing your shop documents" · what to do now: "Create your products as drafts — you can submit them once your shop is approved" · button to set up products.
**Rejected:** the reason exactly as written by the admin · the rejected document flagged · "Upload again".

#### VD-04 · Settlement currency — `/vendor/onboarding/currency` · (added)
**Irreversible decision — design it seriously:** "The currency you price your products in and get paid in" · cards for the seven currencies with name and symbol · **explicit warning in warning color:** "The currency can't be changed after your first sale." · example: "A 79.00 SAR price shows to a buyer in Jordan in dinars; your earnings stay in riyals" · "I understand" checkbox.
**Interactions:** selecting a card updates the example live; continue enabled only after the checkbox; confirmation dialog.

#### VD-05 · Store profile — `/vendor/store` · (added)
Logo (square) · cover (wide) with a live preview of how it looks on ST-11 · description in Arabic and English · shipping policy · return policy · "Preview my shop page".
**Interactions:** image crop dialog; preview updates as you type.

#### VD-06 · Dashboard home — `/vendor`
**Stat cards:** this week's sales (teal, with sparkline) · orders awaiting acceptance **with the nearest deadline** "Nearest expires in 5 hours" · products at low stock · products in review and rejected · pending and available balance.
**Short tables:** latest orders · stock alerts · rejected products with reasons.
**Shop status banner** if in review or suspended.
**No-data state:** example rows **explicitly labeled "Example"**, not an empty skeleton, with "Add your first product".
**Interactions:** stat cards link to filtered lists; date-range switch (7 / 30 days) updates numbers and sparkline.

#### VD-07 · Products — `/vendor/products`
**Table:** image · name · SKU (or "3 variants") · price (range if several) · available · **status** · last edited · actions.
**Status badges:** Draft · **In review** · Published · **Rejected (reason on hover)** · Archived.
**Above the table:** tabs with a count per status · search by name or SKU · "Add product" · "Import".
**Bulk selection:** submit for review · unpublish · delete.
**States:** no products yet (choose: add manually or import a file) · loading.
**Interactions:** tabs filter; search filters as you type; row checkboxes reveal the bulk bar; row click opens VD-08.

#### VD-08 · Create / edit product — `/vendor/products/new`, `/[id]`
**Goal:** the vendor's most important screen — must be quick to understand.
**Header:** name · **status badge** · for rejected: banner with the rejection reason · for published: note "Editing content sends it back to review; price and stock don't" · buttons: "Save draft" · **"Submit for review"** · "Preview".
**Sections:**
1. **Basics:** name in Arabic (required) and English · category via tree picker (**choosing it defines the attributes below**) · brand
2. **Description:** Arabic and English with a simple editor
3. **Images:** multi-upload with drag and reorder · "The first image is the main one" · link an image to a variant · rules shown: JPEG, PNG or WebP, up to 10 MB, shortest side 300px · per-image rejection with its reason · max 10 images
4. **Category attributes:** each with its field type (list, number with unit, text, yes/no) · **required ones marked with an asterisk** · inherited ones labeled "from Fashion"
5. **Variants — matrix editor:**
   - choose distinguishing attributes (color, size) — up to 3
   - choosing their values generates combinations: Red/M · Red/L · Blue/M…
   - table: combination · SKU · **price in settlement currency** · compare-at price · quantity · alert threshold · barcode · weight · active
   - **a duplicate combination is flagged as an error in its row**, and so is a SKU used by another product
   - product without options: a single row
6. **Shipping:** weight and dimensions
**Submit blockers:** on "Submit for review" **all blockers show together**: "Shop not approved yet" · "Required attributes missing: Material" · "No active variant".
**After submitting:** banner "In review — the admin reviews your product before it appears in the store" · "Withdraw submission".
**Interactions:** category change swaps the attribute panel; toggling option values adds/removes matrix rows live; bulk-fill a column (e.g. same price for all); image drag-reorder; unsaved-changes guard; submit → blocker list or in-review banner.
**Mobile:** sections as accordions; the variant table becomes a card per combination.

#### VD-09 · Bulk import — `/vendor/products/import`
Steps: **download the template** (Arabic CSV with its columns) · fill it · upload CSV or Excel (up to 5 MB and 5,000 rows) · progress bar.
Column guide: product code groups variants · an existing SKU updates its price and quantity · category by slug or name · options by Arabic names.
**Whole-file rejection state:** "Unknown columns: السعر_الجديد. Download the template and use its headers as they are." — nothing was written.
**Interactions:** drag-and-drop; animated progress; rejection state replaces the dropzone.

#### VD-10 · Import report — `/vendor/products/import/[id]`
**Summary:** "Imported 488 of 500 rows · 12 rejected" · 250 new products as drafts · 0 updated.
**Rejected rows table:** row number · SKU · column · reason — e.g. "Row 5 · Price · «مجاناً» is not a valid amount." · "Row 302 · SKU · duplicated in the file — first seen on row 300."
**Actions:** "Download rejected rows to fix" · "Go to imported products" · "Submit them for review".
**Interactions:** filter rejected rows by column; row expands full reason.

#### VD-11 · Inventory — `/vendor/inventory`
**Table:** product · variant · SKU · **on hand** · **reserved** (buyers in checkout) · **available** · alert threshold · "Low" badge · last movement.
**Filters:** low only · sold out · search.
**Adjust-stock dialog:** two modes — "Stock count: quantity on hand now" or "Event: + or −" · reason: manual adjustment · damage · return · note · **reserved warning** using the copy in §3.5.
**Movements drawer:** date · change (+5, −2) · reason · reference (order, import) · actor.
**Interactions:** mode switch changes the input; entering a value below reserved shows the warning inline and disables save; drawer slides in.

#### VD-12 · Orders — `/vendor/orders`
**Tabs with counts:** awaiting acceptance · preparing · ready to ship · shipped · delivered · returned · canceled.
**Table:** sub-order number (LTR) · date · customer · items · amount · status · **acceptance countdown** "31 h left", turning warning under 24h and danger under 2h.
**Empty state:** "No orders yet" with a link to the store profile.
**Interactions:** countdowns tick; tab switch; row opens VD-13.

#### VD-13 · Order detail — `/vendor/orders/[id]`
**Content:** number and status · acceptance countdown if applicable · shipping details (name, phone LTR, address) · items · **money breakdown:** items − discount − **commission (10%)** + shipping = **your net earnings** · timeline with the actor of each transition.
**Actions by status only:**
| Status | Buttons |
|--------|---------|
| Awaiting acceptance | Accept · Reject (reason required) |
| Accepted | Start preparing |
| Preparing | Ready to ship |
| Ready to ship | Ship (**carrier and tracking number required**) |
| Shipped | Delivered · Delivery failed |
| Delivery failed | Retry · Return to shop |
| Return requested | Accept return · Reject (reason required) |
**Note:** "After preparing starts, the customer can no longer cancel."
**Interactions:** each button advances the status in the prototype and appends to the timeline; ship opens a form that validates the tracking number; reject opens a reason dialog.

#### VD-14 · Returns & disputes — `/vendor/returns` · (added)
Two tabs. **Returns:** order · items · reason · customer photos · status · accept or reject with reason · confirm receipt. **Disputes:** the thread (as ST-21) · "An open dispute freezes this order's balance release".

#### VD-15 · Messages — `/vendor/messages` · (added)
Inbox: customer · product or order · last message · unread · thread · quick replies.
**Interactions:** selecting a conversation opens the thread; quick reply chips insert text.

#### VD-16 · Shipping zones — `/vendor/shipping`
**Zones list:** name ("Greater Riyadh") · coverage · number of rates · active toggle.
**Edit zone:** coverage by countries, regions and cities (multi-select) · **rates:** method — flat · by weight (price per kg) · free over an amount · price in settlement currency · delivery time from–to days.
**Preview:** "A customer in Jeddah pays 20.00 SAR and receives in 3–5 days".
**Warning:** "Customers in areas you don't cover can't buy from you."
**Interactions:** method switch changes the fields; preview recalculates for a chosen city.

#### VD-17 · Wallet & statement — `/vendor/wallet`
**Three balance cards in teal:** **Pending** ("released 14 days after delivery") · **Available** ("Request payout" button) · **Withdrawn**.
**Negative balance — designed state:** danger banner: "Your balance is −50.00 SAR because of a refund after release (order BST-26-004821-B). It is deducted automatically from upcoming earnings, and payouts are paused until settled."
**Statement:** date · type (sale, commission, shipping, release, refund, payout, adjustment) · reference · bucket (pending, available) · amount (credit/debit) · running balance · date range · **export**.
**Upcoming releases:** delivered orders and each release date, and what a dispute froze.
**Interactions:** date range filters the statement; export shows a toast; "Request payout" opens VD-18.

#### VD-18 · Payout request — `/vendor/wallet/payout`
Available now · amount field with "Withdraw all" · **minimum in your currency** "187.50 SAR" · receiving bank account (masked IBAN) · confirm.
**Payout history** with a timeline: requested · approved · transferring · paid (with transfer reference) · or rejected with reason ("The amount returned to your available balance").
**Interactions:** amount validates against available and minimum live; confirm dialog; new request appears at the top of the history.

#### VD-19 · Reports — `/vendor/reports` · (added)
Date range · sales and orders chart · top-selling products · commissions paid · return rate · **export Excel or CSV** · all amounts in settlement currency.
**Interactions:** range switch updates chart and tables; chart tooltips.

#### VD-20 · Settings — `/vendor/settings` · (added)
Account & security (password, two-factor, sessions) · bank accounts (add, default, verification status) · notification preferences · **settlement currency shown read-only** with "Can't change after first sale".

#### VD-21 · Notifications — `/vendor/notifications`
ST-27 pattern in compact density: new order · accept deadline approaching · product approved or rejected · published product sent back to review · low stock · dispute · balance released · payout status.

---

### 8.4 · Admin Dashboard — 26 screens

#### AD-01 · Admin sign in — `/admin/login` · (added)
Email and password, then a **mandatory two-factor code step** (6 digits) · "A valid two-factor code is required" on error.

#### AD-02 · Mandatory two-factor setup — `/admin/2fa/setup` · (added)
For a new admin **before anything else:** "Turn on two-factor first — it is mandatory for admin accounts" · QR code and text secret · confirmation field · **no skip button**.

#### AD-03 · Dashboard — `/admin`
**Metrics grouped by currency** (never add two currencies together): sales · platform commission · FX spread revenue · average order value · conversion rate · active vendors.
**Queues needing action:** vendors awaiting review · **products awaiting review** · payout requests · open disputes · sub-orders past the acceptance deadline.
**System alerts:** nightly audit drift (if any) in danger color.
**Interactions:** currency tabs switch the metric set; queue cards link to their screens.

#### AD-04 · Vendor review queue — `/admin/vendors/pending`
**Queue**, oldest first: shop · country · registration date · documents (4 indicators) · waiting time · "Review".

#### AD-05 · Vendor profile — `/admin/vendors/[id]`
**Header:** logo · name · **status** · settlement currency · country.
**Tabs:**
- **Documents:** preview each · accept or reject each with reason
- **Decision:** approve · reject (reason required) · **suspend** (reason required, with "Existing orders are completed and earnings are paid") · ban
- **Products · Orders · Wallet** (balances per currency) · **Commission** (vendor-specific rule) · **Audit log** for this vendor
**Interactions:** document viewer with zoom; decision buttons open reason dialogs; status badge updates.

#### AD-06 · All vendors — `/admin/vendors` · (added)
Table: shop · status · currency · products · sales · rating · approval date · filters and search.

#### AD-07 · Product review — `/admin/products/review`, `/[id]` · (added — Q-15)
**Settled decision:** every product a vendor submits waits for admin approval before it appears in the store — including published products sent back after a content edit (Q-16).
**Queue**, oldest first: image · name · shop · category · variant count · price from · waiting time · badge "New" or "Edited after publishing".
**Review screen — the product as the buyer will see it:** gallery · name and description · attributes · variants table with prices · shop details and status. For edited products: **what changed since approval** highlighted.
**Actions:** **Approve** (publishes immediately) · **Reject** with a required reason sent to the vendor verbatim · "Next in queue".
**"All products" tab:** every status; rejecting a published product with a reason.
**Interactions:** approve → toast and auto-advance to the next product; reject → reason dialog with preset reasons plus free text; keyboard shortcuts A / R / N shown.
**Mobile 400:** required — reviewers work from phones.

#### AD-08 · Category tree — `/admin/categories`
Tree up to 4 levels with **drag to move** (moves the whole branch) · add child · edit: name Arabic and English, slug, icon, sort, active · side panel with the category's **own and inherited** attributes and whether required.
**Designed prevention:** moving a category under one of its own children · exceeding 4 levels.
**Interactions:** drag with drop indicators; invalid drop shows a reason tooltip; inline rename.

#### AD-09 · Attributes — `/admin/attributes`
Table: name · code · type (list, multi-list, number, text, yes/no) · unit · filterable · **variant axis** · linked categories.
Edit: values in Arabic and English with a color per value · link to categories with "required".

#### AD-10 · Commission rules — `/admin/commissions`
Three sections with visible priority **vendor → category → global** · each rule: scope · rate (10%) · minimum and maximum fee · effective from – to.
**Rules are never deleted** — "End validity" instead of delete · **warning:** "Changing a rate doesn't affect any past order" · change history · requires `commissions.edit`.

#### AD-11 · Currencies & FX rates — `/admin/currencies`
**Currencies:** code · name · display symbol · **decimal places** (dinar 3) · minimum payout · active · accounting currency (USD).
**FX rates:** current rate per pair and an **append-only history** · "Add rate" — no edit, no delete · source · effective time · **FX spread 2%** shown.
**Warning:** "Updating a rate doesn't change earnings of any past order."

#### AD-12 · Orders — `/admin/orders` · (added)
Search by number, customer or shop · parent order with derived status and its sub-orders · detail: timeline per sub-order · payment and its events · reservations · **admin cancellation before shipping** with reason (`orders.cancel`).

#### AD-13 · Payout requests — `/admin/payouts`
Queue: shop · amount and currency · available balance · **ledger reconciliation** ("Balance matches entries" or a warning) · bank details · request date.
**Actions — only with `payouts.approve`:** approve · record transfer (reference required) · reject (reason required, "Amount returned immediately").

#### AD-14 · Disputes — `/admin/disputes`
List: sub-order · parties · reason · age · "Balance frozen".
**Dispute screen:** full thread · order and shipment details · **decision** (`disputes.resolve`): fully or partially for the customer with an amount · **impact preview:** "50.00 SAR refunded and 5.00 SAR commission reversed" · reject · close with a written decision.
**Interactions:** partial amount input updates the impact preview live.

#### AD-15 · Returns & refunds — `/admin/returns`
Returns by status · step in when a shop stalls · refunds: amount · reason · status · gateway reference · **vendor negative balance** if one resulted.

#### AD-16 · Coupons — `/admin/coupons`
Table: code · scope (platform or shop) · type (percent, fixed amount, free shipping) · value · usage (37 of 500) · validity · status.
**Edit:** value · maximum discount · minimum order · currency for fixed amounts · total and per-user limits · dates · conditions (category, product, shop, first order) · **who funds the discount** (platform by default; charging a shop shows "Awaiting shop consent").
**Interactions:** type switch changes value fields; live example "On a 200.00 SAR order the customer saves 20.00 SAR".

#### AD-17 · Campaigns & featured products — `/admin/campaigns` · (added)
Campaign: name · period · included products or categories · linked coupon · placement · featured products with manual drag ordering.

#### AD-18 · Content pages — `/admin/pages`
Pages list (About, Terms…) · editor: title · slug · rich content · published · preview.

#### AD-19 · Home, banners & menus — `/admin/storefront` · (added)
**Banners:** placement (home hero, home middle, category top) · image with required sizes · title · link · schedule · drag ordering · active.
**Home sections:** order and enable. **Menus:** header and footer links.
**Interactions:** drag reorder; live home preview beside the editor.

#### AD-20 · Notification templates — `/admin/notifications/templates` · (added)
Matrix: event × channel (email, SMS, WhatsApp, browser push, in-app) × language · editor: subject · body · **variable chips** `{{order_number}}` · **preview with sample data** · send test.
**Interactions:** clicking a chip inserts the variable; preview renders as you type.

#### AD-21 · Customers — `/admin/customers` · (added)
Table: name · email and phone · orders · signup date · status · profile: orders · disputes · sessions · suspend account with reason.

#### AD-22 · Product reviews — `/admin/reviews` · (added)
Reviews awaiting publication: stars · text · product · "Verified purchase" · publish · reject with reason.

#### AD-23 · Admin users & permissions — `/admin/users`
Table: name · email · **two-factor status** · permissions · last sign-in.
**Invite admin:** email · permissions as checkboxes with an explanation of each · "Must enable two-factor at first sign-in".

#### AD-24 · Audit log — `/admin/audit`
Search and filters: actor · action · entity type · date range.
Row: time · actor and role · action · entity · IP address.
**Detail drawer:** before/after values with colored diffs.
**Read-only** — no edit or delete button anywhere.

#### AD-25 · Reports — `/admin/reports`
Date range · sales · commissions · FX spread revenue · active vendors · average order value · conversion rate.
**Grouped by currency**, plus a unified USD view that **shows the FX rate used next to every converted number**.
**Export Excel and CSV.**

#### AD-26 · Platform settings & taxes — `/admin/settings` · (added)
**Settings:** balance hold period (14 days) · return window (14) · stock reservation time (15 minutes) · vendor accept deadline (48 hours) · default commission (10%) · cart expiry (168 hours) · FX spread (2%) · accounting currency (USD) · default coupon funder (platform).
**A warning per financial setting** explaining its effect · change history.
**Taxes per country:** Saudi Arabia 15% added · UAE 5% added · Jordan 16% included · Egypt 14% included · Kuwait 0%.
**Interactions:** editing a financial setting requires a confirmation dialog that restates the effect.

---

## 9 · Statuses — labels and colors

> Colors are semantic, never brand colors. Text always accompanies color.

### 9.1 · Sub-order — buyer and vendor
| Status | Arabic label | English | Color |
|--------|--------------|---------|-------|
| `awaiting_vendor` | بانتظار قبول المتجر | Waiting for shop | warning |
| `accepted` | مقبول | Accepted | info |
| `preparing` | قيد التجهيز | Preparing | info |
| `ready_to_ship` | جاهز للشحن | Ready to ship | info |
| `shipped` | تم الشحن | Shipped | info |
| `delivery_failed` | تعذّر التوصيل | Delivery failed | danger |
| `delivered` | تم التسليم | Delivered | success |
| `return_requested` | طلب إرجاع | Return requested | warning |
| `returned` | مُرتجَع | Returned | neutral |
| `refunded` | مُسترَد | Refunded | neutral |
| `completed` | مكتمل | Completed | success |
| `rejected_by_vendor` | رفضه المتجر | Rejected by shop | danger |
| `canceled_by_customer` | ألغاه العميل | Canceled by customer | neutral |
| `canceled_by_admin` | ألغته الإدارة | Canceled by admin | neutral |

### 9.2 · Parent order — derived
بانتظار الدفع Pending payment (warning) · فشل الدفع Payment failed (danger) · قيد التنفيذ Processing (info) · مكتمل جزئياً Partially completed (info) · مكتمل Completed (success) · ملغى Canceled (neutral) · مُسترَد Refunded (neutral)

### 9.3 · Product
مسودة Draft (neutral) · **قيد المراجعة In review (warning)** · منشور Published (success) · **مرفوض Rejected (danger, with reason)** · مؤرشف Archived (neutral)

### 9.4 · Vendor
قيد المراجعة In review (warning) · معتمد Approved (success) · معلَّق Suspended (danger) · محظور Banned (danger)

### 9.5 · Payout request
مطلوب Requested (warning) · معتمد Approved (info) · قيد التحويل Transferring (info) · مدفوع Paid (success) · مرفوض Rejected (danger)

### 9.6 · Payment
Pending · Requires action · Authorized · Captured · Partially refunded · Refunded · Failed · Voided

---

## 10 · Sample data — use across all screens

### 10.1 · Shops
| Shop | Category | Currency | City | Rating |
|------|----------|----------|------|--------|
| **دار القطن** (Dar Al-Qutn) | Fashion | SAR | Riyadh | 4.7 (312) |
| **تقنية الشام** (Taqniyat Al-Sham) | Electronics | JOD | Amman | 4.5 (128) |
| **بيت العود** (Bayt Al-Oud) | Beauty | AED | Dubai | 4.8 (540) |
| **سوق الحِرفة** (Souq Al-Hirfa) | Handmade | EGP | Cairo | 4.6 (87) |

### 10.2 · Products
| Product | Shop | Price | Compare-at | Variants |
|---------|------|-------|------------|----------|
| قميص قطني مصري · Egyptian Cotton Shirt | دار القطن | 79.00 ر.س. | 99.00 ر.س. | Red, Blue, Black × S to XXL |
| بنطال كتان واسع · Wide Linen Trousers | دار القطن | 149.00 ر.س. | — | Beige, Grey × M, L, XL |
| سماعات لاسلكية بعزل الضوضاء · Noise-cancelling Wireless Headphones | تقنية الشام | 45.500 د.أ. | 52.000 د.أ. | Black, White |
| هاتف ذكي 256 GB · Smartphone 256 GB | تقنية الشام | 389.000 د.أ. | — | 128 GB, 256 GB × Black, Blue |
| عطر عود ملكي 100 مل · Royal Oud Perfume 100 ml | بيت العود | 320.00 د.إ. | — | — |
| سلة خوص يدوية · Handwoven Wicker Basket | سوق الحِرفة | 450.00 ج.م. | 520.00 ج.م. | Small, Large |

### 10.3 · Numbers and text
- Order number: `BST-26-004821` · sub-orders: `BST-26-004821-A` · `-B` · `-C`
- SKU: `TS01-RED-M` · tracking: `SA1029384756` · phone: `+966 50 123 4567`
- IBAN: `SA03 8000 0000 6080 1016 7519`
- Dates are Gregorian with Arabic month names and Latin digits: `13 سبتمبر 2026` · `15:42`
- Customer: نور الحاج (Noor Al-Hajj) · address: Riyadh, Al-Malqa district, Anas Ibn Malik St., building 12
- Sample 3-shop cart: items 1,160.00 · shipping 45.00 · tax 58.00 · discount −14.50 · **total 1,248.50 SAR**
- Categories: Electronics → Smartphones · Fashion → Men's clothing, Women's clothing · Beauty · Home & Kitchen · Grocery · Handmade
- Attributes: Color · Size · Storage · Material (required for clothing) · Warranty (months)

---

## 11 · Out of scope — don't design

Native mobile apps · real-time live chat · loyalty points and referrals · AI recommendation engine · auctions or haggling · recurring product subscriptions · international shipping with customs · prepaid buyer wallet · multiple warehouses per vendor · **vendor subscriptions**.

**Open items — design the current behavior, don't decide them:**
- A "shop staff" invitation screen: the role exists, the screen isn't decided
- Content pages are Arabic-only for now
- Map provider and payment gateway aren't chosen — keep them neutral, no provider logos

---

## 12 · Mapping of the original 47 screens

| Original (Arabic) | Code | | Original | Code | | Original | Code |
|---|---|---|---|---|---|---|---|
| الرئيسية · Home | ST-01 | | تسجيل البائع · Vendor registration | VD-01 | | لوحة المؤشرات · Dashboard | AD-03 |
| قائمة الفئة · Category listing | ST-03 | | رفع الوثائق · Documents | VD-02 | | مراجعة البائعين · Vendor review | AD-04 |
| نتائج البحث · Search results | ST-04 | | حالة قيد المراجعة · In review | VD-03 | | ملف بائع · Vendor profile | AD-05 |
| بحث بلا نتائج · No results | ST-05 | | لوحة المؤشرات · Dashboard | VD-06 | | شجرة الفئات · Category tree | AD-08 |
| صفحة المنتج · Product page | ST-07 | | قائمة المنتجات · Products | VD-07 | | السمات · Attributes | AD-09 |
| منتج نفد · Sold out | ST-08 | | تحرير منتج · Product editor | VD-08 | | قواعد العمولة · Commission rules | AD-10 |
| صفحة البائع · Shop page | ST-11 | | الاستيراد الجماعي · Bulk import | VD-09 | | العملات وأسعار الصرف · Currencies & FX | AD-11 |
| بائع معلَّق · Suspended shop | ST-12 | | تقرير أخطاء الاستيراد · Import report | VD-10 | | طلبات السحب · Payouts | AD-13 |
| السلة · Cart | ST-13 | | المخزون · Inventory | VD-11 | | النزاعات · Disputes | AD-14 |
| سلة فارغة · Empty cart | ST-14 | | قائمة الطلبات · Orders | VD-12 | | المرتجعات · Returns | AD-15 |
| إتمام الشراء · Checkout | ST-15 | | تفاصيل الطلب · Order detail | VD-13 | | الكوبونات · Coupons | AD-16 |
| فشل الدفع · Payment failed | ST-16 | | مناطق الشحن · Shipping zones | VD-16 | | صفحات المحتوى · Content pages | AD-18 |
| نجاح الطلب · Order placed | ST-17 | | المحفظة وكشف الحساب · Wallet | VD-17 | | مستخدمو الإدارة · Admin users | AD-23 |
| طلباتي · My orders | ST-18 | | طلب سحب · Payout request | VD-18 | | سجل التدقيق · Audit log | AD-24 |
| تفاصيل الطلب · Order detail | ST-19 | | | | | التقارير · Reports | AD-25 |
| طلب إرجاع · Return request | ST-20 | | | | | | |
| المفضلة · Wishlist | ST-23 | | | | | | |
| الحساب والعناوين · Account & addresses | ST-25 + ST-26 | | | | | | |

**Added — 39:** ST-02 · 06 · 09 · 10 · 21 · 22 · 24 · 27 · 28 · 29 · 30 · 31 · SH-01 to 08 · VD-04 · 05 · 14 · 15 · 19 · 20 · 21 · AD-01 · 02 · 06 · 07 · 12 · 17 · 19 · 20 · 21 · 22 · 26.
> Many are small states, dialogs or templates, but they **expand Phase 02's scope**, which was priced on 47 screens. To be confirmed as a change request before starting them.

---

## 13 · Design batches with ready prompts

**The order is deliberate:** components first, then the Vendor Dashboard (Phase 06 is next in development), then the Storefront, then Admin.
In each batch: paste §0, then the prompt below, then the named screen specs from §8.

### Batch 0 — Foundations
```
Design Basta's interactive component sheet: every component in §4 with its seven states, in light and
dark themes, in comfortable and compact density, RTL. Make states demonstrable: hover, focus, pressed,
loading and error are triggerable in the prototype. Add the color and type sheets from §2 and the
status badges from §9. Include the prototype toolbar: Light/Dark and RTL/LTR toggles.
```

### Batch 1 — Vendor onboarding
```
Design vendor onboarding VD-01 to VD-05 as a clickable flow with a stepper, desktop 1440 and mobile 400.
Steps validate before continuing; uploads show progress; VD-04 is irreversible — make its warning clear
without being alarming, with the confirmation dialog.
```

### Batch 2 — Vendor: products & inventory
```
Design VD-06 to VD-11 in compact density inside the vendor shell (§6.2), fully interactive.
Give VD-08 (product editor) the most care: category change swaps attributes, the variant matrix
generates rows live, images reorder by drag, and "Submit for review" shows the blocker list or the
in-review banner. VD-10 uses the 488-of-500 example with 12 rejected rows.
```

### Batch 3 — Vendor: orders & money
```
Design VD-12 to VD-21, interactive. In VD-13 the buttons follow the status table and clicking them
advances the order. Countdowns tick. In VD-17 design both the normal and the negative-balance state;
VD-18 validates the amount against the minimum live.
```

### Batch 4 — Storefront: discovery
```
Design ST-01 to ST-12, ST-29 and SH-05 in comfortable density, desktop 1440 and mobile 400, as a
clickable flow from Home to a product. Filters update results and counts live; variant selection updates
price, images and stock. ST-07 also gets an English LTR version.
```

### Batch 5 — Storefront: cart, checkout & after purchase
```
Design ST-13 to ST-22 and ST-31 as one working purchase flow. A cart from 3 shops in different
currencies shown in one display currency; quantities and coupons recalculate totals. In ST-15 design
every listed state, the countdown ticks from 15:00, and an English LTR version. Sub-orders stay
separate from confirmation to tracking.
```

### Batch 6 — Storefront: account & shared
```
Design ST-23 to ST-28, ST-30, SH-01 to SH-04 and SH-06 to SH-08, interactive: OTP boxes auto-advance,
password strength updates live, sessions can be signed out with confirmation.
```

### Batch 7 — Admin: operations
```
Design AD-01 to AD-07, AD-12 to AD-15, AD-21 and AD-22 in compact density inside the admin shell (§6.3).
Permission-bound buttons appear only for holders. AD-07 product review is built for speed: approve
auto-advances, reject asks for a reason, keyboard shortcuts shown. Mobile 400 for the review queue and
payouts only; the rest desktop.
```

### Batch 8 — Admin: catalog, money, marketing & system
```
Design AD-08 to AD-11, AD-16 to AD-20 and AD-23 to AD-26, interactive: the category tree drags with
valid/invalid drop feedback, coupon examples recalculate, template variables insert and preview live.
Money is always grouped by currency. Audit log and FX rates are append-only: no edit or delete buttons.
```

### Batch 9 — Full review
```
Review all screens: dark-theme versions of ST-01, ST-07, ST-15, VD-06 and AD-03, and every critical
state: empty, loading, error, sold out, reservation expired, uncovered area, negative balance,
suspended shop, published product sent back to review. Check every interaction in §5.2 end to end.
```

---

## 14 · Acceptance checklist per screen

- [ ] Desktop 1440 and mobile 400 — no horizontal scroll on mobile
- [ ] Correct RTL: arrows mirrored, logo not, Latin runs isolated
- [ ] Teal on amounts only; burgundy never used for money
- [ ] Amounts with their currency's decimals and Latin digits
- [ ] Every status has text next to its color
- [ ] Loading, empty and error states designed and switchable
- [ ] Buttons = allowed actions only
- [ ] Destructive actions outlined with icon and text; filled red only in confirmation dialogs
- [ ] Error copy: what happened, why, what next
- [ ] §10 sample data, no placeholder text
- [ ] 44px touch targets, visible focus ring
- [ ] Values from §2 tokens only — no color or spacing outside them
- [ ] Interactive: navigation works, controls change state, calculations update, flows in §5.2 click through
