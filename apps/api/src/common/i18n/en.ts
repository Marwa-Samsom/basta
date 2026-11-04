/**
 * قاموس رسائل الخادم بالإنجليزية — انظر ./translate.ts.
 *
 * EN_MESSAGES: الرسالة العربية حرفياً ← الإنجليزية.
 * EN_TEMPLATES: القالب العربي بـ {0} و {1}… مكان متغيّراته ← الإنجليزية بالأرقام نفسها.
 * كل رسالة تصل المستخدم من الخادم يجب أن تكون هنا — en-coverage.spec.ts يفحص.
 *
 * القوالب تُجرَّب بترتيبها هنا وأوّل مطابق يفوز: الأخصّ قبل الأعمّ (القوالب التي تبدأ
 * بمتغيّر آخر الملف). ومتغيّر قيمته عربية معروفة (حالة، اسم وثيقة) يُترجم من EN_MESSAGES.
 */
export const EN_MESSAGES: Readonly<Record<string, string>> = {
  // ---- #174 (موجة «يُؤتمت»): رسائل قد تسبق دمجها هنا
  'المسار من 2 إلى 60 حرفاً: أحرف لاتينية صغيرة وأرقام وشرطات.': 'The path must be 2 to 60 characters: lowercase Latin letters, digits and hyphens.',
  // ---- معالج الأخطاء العام
  'تعذّرت قراءة الطلب: صيغته غير صحيحة أو فيه حقول ممنوعة. راجعه وأعد المحاولة.':
    "We couldn't read the request: its format is invalid or it contains forbidden fields. Check it and try again.",
  'الطلب أكبر من الحدّ المسموح. صغّر ما ترسله وأعد المحاولة.':
    'The request is larger than allowed. Send less and try again.',
  'صيغة الطلب غير مدعومة. أرسله بصيغة JSON.': 'Unsupported request format. Send it as JSON.',
  'القيمة مستعملة من قبل. غيّرها وأعد المحاولة.':
    'This value is already in use. Change it and try again.',
  'قيمة غير صالحة في الطلب. راجع المدخلات وأعد المحاولة.':
    'The request has an invalid value. Check your input and try again.',

  // ---- عام
  'انتهت مهلة حجز سلّتك. نعيد المحاولة الآن — إن توفّر المخزون يكتمل الطلب.':
    "Your cart reservation expired. We're retrying now — if the stock is still available, your order will go through.",
  'غير متاح': 'Unavailable',
  'مقام صفري في الاحتساب النسبي': 'Zero denominator in a pro-rata calculation',
  'الترتيب newest (الأحدث أولاً) أو oldest (الأقدم أولاً).':
    'Sort must be newest (newest first) or oldest (oldest first).',
  'نطاق البائع مطلوب للوصول الإداري إلى بيانات متجر.':
    "A seller scope is required for admin access to a shop's data.",
  'هذا المورد يخصّ متجراً، والحساب الحالي ليس بائعاً.':
    "This resource belongs to a shop, and the current account isn't a seller.",
  'لا وصول إلى بيانات متجر آخر.': "You can't access another shop's data.",
  'مطلوب تسجيل الدخول.': 'You need to sign in.',

  // ---- الهوية والحساب
  'الجلسة غير موجودة.': 'Session not found.',
  'انتهت جلستك. سجّل الدخول من جديد.': 'Your session has ended. Sign in again.',
  'الاسم من حرفين إلى 120 حرفاً.': 'The name must be 2 to 120 characters.',
  'الهاتف بصيغة دولية تبدأ بـ + ورمز الدولة.':
    'The phone number must be in international format, starting with + and the country code.',
  'الرمز ستة أرقام.': 'The code is six digits.',
  'صيغة البريد غير صحيحة.': 'Invalid email format.',
  'رمز التحقق ستة أرقام، أو رمز استعادة من عشرة محارف.':
    'The verification code is six digits, or a ten-character recovery code.',
  'رمز التحقق ستة أرقام.': 'The verification code is six digits.',
  'فعّل التحقق الثنائي أولاً — إلزامي على الحسابات الإدارية قبل أي إجراء.':
    "Turn on two-step verification first — it's required on admin accounts before any action.",
  'هذا المسار لا يخصّ حسابك.': "This route isn't available to your account.",
  'تعذّر حفظ هذا الرقم لأنه مرتبط بحساب آخر. إن كان رقمك فتواصل معنا.':
    "We couldn't save this number because it's linked to another account. If it's your number, contact us.",
  'كلمة المرور الحالية غير صحيحة.': 'The current password is incorrect.',
  'اختر كلمة مرور مختلفة عن الحالية.': 'Choose a password different from your current one.',
  'الجلسة غير موجودة أو انتهت من قبل.': "The session doesn't exist or has already ended.",
  'تعذّر تمييز جلستك الحالية. حدّث الصفحة بعد دقائق أو ادخل من جديد، ثم أعد المحاولة.':
    "We couldn't identify your current session. Refresh the page in a few minutes or sign in again, then try again.",
  'الحساب غير متاح.': 'The account is unavailable.',
  'تعذّر إنشاء الحساب بهذه البيانات. إن كان لديك حساب، استعد كلمة المرور.':
    "We couldn't create an account with these details. If you already have an account, reset your password.",
  'البريد أو كلمة المرور غير صحيحة.': 'Incorrect email or password.',
  'رمز التحقق الثنائي مطلوب وصحيح.': 'A valid two-step verification code is required.',
  'رمز الاستعادة غير صحيح أو استُعمل من قبل.':
    'The recovery code is incorrect or has already been used.',
  'رمز التحقق الثنائي استُعمل. انتظر الرمز التالي.':
    'This two-step verification code has already been used. Wait for the next code.',
  'التحقق بخطوتين مفعَّل على حسابك. لتغيير الجهاز أدخل كلمة المرور ورمزاً من الجهاز الحالي.':
    'Two-step verification is on for your account. To change the device, enter your password and a code from the current device.',
  'لا تهيئة قيد الانتظار. ابدأ التهيئة أولاً.': 'No setup is pending. Start the setup first.',
  'الرمز غير صحيح. تأكد من وقت جهازك وأعد المحاولة.':
    "The code is incorrect. Check your device's time and try again.",
  'تغيّرت التهيئة أثناء التأكيد. ابدأ من جديد.':
    'The setup changed during confirmation. Start again.',
  'فعّل التحقق بخطوتين أولاً.': 'Turn on two-step verification first.',
  'كلمة المرور غير صحيحة.': 'Incorrect password.',
  'التحقق الثنائي إلزامي على الحسابات الإدارية ولا يمكن تعطيله. لإيقافه أزل الدور الإداري أولاً.':
    "Two-step verification is required on admin accounts and can't be turned off. To turn it off, remove the admin role first.",
  'التحقق بخطوتين غير مفعَّل.': "Two-step verification isn't turned on.",
  'لا بريد في حسابك لنرسل إليه الرمز.': 'Your account has no email to send the code to.',
  'بريدك مؤكَّد من قبل، ولا حاجة لرمز جديد.':
    'Your email is already confirmed; no new code is needed.',
  'إرسال رموز التأكيد موقوف مؤقتاً. حاول لاحقاً.':
    'Sending confirmation codes is temporarily paused. Try again later.',
  'اكتُشف استعمال مكرّر لرمز الجلسة، فأُنهيت كل جلساتك احتياطاً. سجّل الدخول من جديد.':
    'A session token was reused, so all your sessions were ended as a precaution. Sign in again.',
  'انتهت صلاحية جلستك. حدّثها أو سجّل الدخول من جديد.':
    'Your session has expired. Refresh it or sign in again.',
  'كلمة المرور أطول من الحد المسموح (1024 بايت).':
    'The password is longer than allowed (1024 bytes).',

  // ---- العناوين
  'العنوان غير موجود.': 'Address not found.',
  'رقم الهاتف غير صالح — أرقام فقط، ويجوز أن يبدأ بـ +.':
    'Invalid phone number — digits only, optionally starting with +.',
  'البلد برمز من حرفين.': 'The country must be a two-letter code.',
  'انقضت مهلة التراجع عن حذف هذا العنوان. أضفه من جديد إن احتجته.':
    'The time to undo deleting this address has passed. Add it again if you need it.',

  // ---- الكتالوج
  'الطلب ليس multipart/form-data صالحاً. أرفق الملف في الحقل file.':
    "The request isn't valid multipart/form-data. Attach the file in the file field.",
  'أرفق ملفاً في الحقل file.': 'Attach a file in the file field.',
  'أرسل setTo (الكمية الموجودة فعلاً) أو delta (تغيير بحدث) — واحداً منهما فقط.':
    'Send setTo (the quantity actually on hand) or delta (a change from an event) — only one of them.',
  'اكتب اسم الفئة.': 'Enter the category name.',
  'اسم الفئة من حرف إلى 80 حرفاً.': 'The category name must be 1 to 80 characters.',
  'الاسم الإنجليزي للفئة نصّ.': "The category's English name must be text.",
  'الاسم الإنجليزي للفئة 80 حرفاً على الأكثر.':
    "The category's English name can be at most 80 characters.",
  'أرسل معرّفات الفئات بترتيبها.': 'Send the category IDs in their order.',
  'معرّف فئة غير صالح.': 'Invalid category ID.',
  'اللون بصيغة #RRGGBB.': 'The color must be in #RRGGBB format.',
  'رمز السمة حروف لاتينية صغيرة وأرقام و _ ويبدأ بحرف.':
    'The attribute code must use lowercase Latin letters, digits and _, and start with a letter.',
  'نوع السمة غير معروف.': 'Unknown attribute type.',
  'معرّف السمة غير صالح.': 'Invalid attribute ID.',
  'معرّف القيمة غير صالح.': 'Invalid value ID.',
  'معرّف المتغيّر غير صالح.': 'Invalid variant ID.',
  'SKU من محرف إلى 64 محرفاً.': 'The SKU must be 1 to 64 characters.',
  'السعر يُرسل نصّاً مثل "79.00" لا رقماً — الأرقام العشرية تفقد الدقة.':
    'Send the price as text like "79.00", not as a number — decimal numbers lose precision.',
  'السعر قبل الخصم يُرسل نصّاً.': 'Send the pre-discount price as text.',
  'الوزن عدد صحيح بالغرام.': 'The weight must be a whole number of grams.',
  'الكمية عدد صحيح.': 'The quantity must be a whole number.',
  'الكمية لا تكون سالبة.': "The quantity can't be negative.",
  'اختر فئة للمنتج — أو أضف فئة جديدة لمتجرك.':
    'Choose a category for the product — or add a new category to your shop.',
  'معرّف الفئة غير صالح.': 'Invalid category ID.',
  'الاسم العربي من حرفين إلى 200 حرف.': 'The Arabic name must be 2 to 200 characters.',
  'المنتج يحتاج متغيّراً واحداً على الأقل.': 'The product needs at least one variant.',
  'اختر فئة للمنتج — لا يبقى منتج بلا فئة.':
    "Choose a category for the product — a product can't be left without a category.",
  'التغيير عدد صحيح.': 'The change must be a whole number.',
  'السبب: manual_adjust أو damage أو return.':
    'The reason must be manual_adjust, damage or return.',
  'الفئة معرّف أو none.': 'The category must be an ID or none.',
  'قيمة الخيار غير صالحة.': 'Invalid option value.',
  'المتغيّر غير صالح.': 'Invalid variant.',
  'أرسل معرّفات الصور بترتيبها.': 'Send the image IDs in their order.',
  'للمنتج عشر صور على الأكثر.': 'A product can have at most ten images.',
  'معرّف صورة غير صالح.': 'Invalid image ID.',
  'سبب الإيقاف من 5 أحرف إلى 500 — البائع يصلح بناءً عليه.':
    'The takedown reason must be 5 to 500 characters — the seller fixes the product based on it.',
  'رمز العملة ثلاثة أحرف.': 'The currency code must be three letters.',
  'الفئة غير صالحة.': 'Invalid category.',
  'قيم التصفية معرّفات مفصولة بفاصلة.': 'Filter values must be comma-separated IDs.',
  'سمة المتغيّرات (مثل المقاس) تكون من نوع «اختيار من قائمة» — لكل متغيّر قيمة واحدة معرّفة.':
    'A variant attribute (like size) must be of the "Select from a list" type — each variant has one defined value.',
  'السمة غير موجودة.': 'Attribute not found.',
  'اسم الخصيصة حرفان على الأقل.': 'The attribute name must be at least two characters.',
  'القيمة غير موجودة في هذه السمة.': "This value doesn't exist in this attribute.",
  'القيمة لا تكون فارغة.': "The value can't be empty.",
  'المتغيّر غير موجود.': 'Variant not found.',
  'الصورة غير موجودة.': 'Image not found.',
  'هذه الصورة الوحيدة للمنتج. أضف صورة أخرى قبل حذفها — المنتج المعروض لا يبقى بلا صورة.':
    "This is the product's only image. Add another image before deleting it — a listed product can't be left without an image.",
  'صورة مكرّرة في الترتيب.': 'Duplicate image in the order.',
  'تغيّرت صور المنتج منذ فتحت الصفحة. حدّثها ثم رتّب من جديد.':
    "The product's images changed since you opened the page. Refresh it, then reorder.",
  'الصورة لخيار واحد: قيمة (مثل الأحمر) أو متغيّر بعينه، لا الاثنان.':
    'An image belongs to one option: a value (like red) or a specific variant, not both.',
  'المتغيّر غير موجود في هذا المنتج.': "The variant doesn't exist in this product.",
  'هذه القيمة ليست بين خيارات المنتج — احفظ الخيارات أولاً ثم اربط الصورة.':
    "This value isn't one of the product's options — save the options first, then link the image.",
  'تغيّرت منتجات المتجر أثناء الاستيراد (أُضيف SKU من مسار آخر). لم يُكتب شيء من الملف — أعد رفعه.':
    "The shop's products changed during the import (a SKU was added elsewhere). Nothing from the file was saved — upload it again.",
  'متغيّرات المنتج الجديد لا تحمل معرّفات — المعرّف يُنشأ عند الحفظ.':
    "A new product's variants don't carry IDs — the ID is created on save.",
  'اختر فئة للمنتج قبل الحفظ — لا يبقى منتج بلا فئة.':
    "Choose a category for the product before saving — a product can't be left without a category.",
  'المتغيّر نفسه مذكور مرتين.': 'The same variant is listed twice.',
  'العلامة التجارية غير موجودة.': 'Brand not found.',
  'المنتج غير موجود أو لم يعد معروضاً.': "The product doesn't exist or is no longer listed.",
  'المتجر غير موجود.': 'Shop not found.',
  'أرسل كل فئات متجرك بترتيبها الجديد، كلٌّ مرة واحدة.':
    "Send all of your shop's categories in their new order, each one once.",
  'الفئة غير موجودة في متجرك.': "The category doesn't exist in your shop.",
  'الفئة غير موجودة.': 'Category not found.',
  'السمة نفسها مذكورة مرتين في متغيّر واحد — لكل سمة قيمة واحدة.':
    'The same attribute is listed twice in one variant — each attribute has one value.',
  'المنتج يحتاج متغيّراً واحداً على الأقل يحمل السعر والمخزون.':
    'The product needs at least one variant with a price and stock.',
  'أكثر من متغيّر بلا خيارات تميّزها — أضف لكل متغيّر سمة مثل المقاس أو اللون.':
    'More than one variant has no options to tell them apart — give each variant an attribute like size or color.',
  'الملف فارغ.': 'The file is empty.',
  'الملف بلا سطر عناوين ولا بيانات.': 'The file has no header row and no data.',
  'الملف يحوي العناوين فقط، بلا أسطر منتجات.': 'The file only has headers, with no product rows.',
  'الملف ليس CSV بترميز UTF-8 ولا ملف Excel. في Excel احفظه بصيغة «CSV UTF-8» أو .xlsx.':
    'The file is neither a UTF-8 CSV nor an Excel file. In Excel, save it as "CSV UTF-8" or .xlsx.',
  'الملف ثنائي لا نصّي. الصيغ المقبولة: CSV بترميز UTF-8 أو .xlsx.':
    'The file is binary, not text. Accepted formats: UTF-8 CSV or .xlsx.',
  'ملف Excel تالف أو ليس بصيغة .xlsx. احفظه من جديد بصيغة .xlsx أو CSV UTF-8.':
    "The Excel file is corrupted or isn't in .xlsx format. Save it again as .xlsx or CSV UTF-8.",
  'ملف Excel بلا ورقة عمل.': 'The Excel file has no worksheet.',
  'الملف ليس صورة مقروءة. الصيغ المقبولة: JPEG و PNG و WebP و AVIF.':
    "The file isn't a readable image. Accepted formats: JPEG, PNG, WebP and AVIF.",
  'تعذّرت قراءة محتوى الصورة — قد يكون الملف تالفاً. جرّب تصديره من جديد.':
    "We couldn't read the image content — the file may be corrupted. Try exporting it again.",
  'ملف Excel تالف: لا فهرس له.': 'Corrupted Excel file: it has no index.',
  'صيغة ZIP64 غير مدعومة في ملف الاستيراد. احفظه من Excel من جديد.':
    "The ZIP64 format isn't supported in import files. Save it from Excel again.",
  'ملف Excel تالف: فهرسه خارج حدوده.': 'Corrupted Excel file: its index is out of bounds.',
  'ملف Excel تالف: فهرسه مقطوع.': 'Corrupted Excel file: its index is truncated.',
  'ملف Excel مشفّر بكلمة مرور. احفظه بلا حماية.':
    'The Excel file is password-protected. Save it without protection.',
  'ملف Excel تالف: مدخل بلا ترويسة.': 'Corrupted Excel file: an entry has no header.',
  'ملف Excel تالف: مدخل مقطوع.': 'Corrupted Excel file: an entry is truncated.',
  'ملف Excel ينتفخ عند فكّه أضعاف حجمه المعقول — يُرفض. صدّره من جديد أو استعمل CSV.':
    'The Excel file expands far beyond a reasonable size when unpacked — rejected. Export it again or use CSV.',
  'ملف Excel تالف: تعذّر فكّ أحد مداخله.':
    "Corrupted Excel file: one of its entries couldn't be unpacked.",
  'ملف Excel بضغط غير معروف. احفظه من جديد بصيغة .xlsx.':
    'The Excel file uses an unknown compression. Save it again as .xlsx.',

  // ---- المخزون
  'لا سجل مخزون لهذا المتغيّر.': 'This variant has no stock record.',
  'لا أسطر للحجز — السلة فارغة.': 'Nothing to reserve — the cart is empty.',

  // ---- السلة
  'عملة غير مدعومة.': 'Unsupported currency.',
  'أرسل رمز السلة في الترويسة x-cart-token.': 'Send the cart token in the x-cart-token header.',
  'المنتج غير متاح للبيع.': "This product isn't available for sale.",
  'المنتج ليس في سلّتك.': "This product isn't in your cart.",
  'السلة غير موجودة أو انتهت.': "The cart doesn't exist or has expired.",

  // ---- التسعير
  'منتج في سلّتك لم يعد متاحاً للبيع. احذفه ثم تابع.':
    'A product in your cart is no longer available for sale. Remove it, then continue.',
  'بائع مجهول في السلة.': 'Unknown seller in the cart.',

  // ---- إتمام الطلب
  'رقم الهاتف غير صالح.': 'Invalid phone number.',
  'أرسل الإجمالي الذي رأيته قبل الدفع.': 'Send the total you saw before paying.',
  'أرسل عملة الإجمالي الذي رأيته.': 'Send the currency of the total you saw.',
  'البريد غير صالح.': 'Invalid email.',
  'اكتب مرجع التحويل كما في كشف البنك (3 أحرف على الأقل).':
    'Enter the transfer reference as it appears on the bank statement (at least 3 characters).',
  'اكتب المبلغ الذي وصل.': 'Enter the amount received.',
  'سجّل دخولك أو أنشئ حساباً لتكمل الشراء — سلّتك محفوظة كما هي.':
    'Sign in or create an account to complete your purchase — your cart is saved as it is.',
  'أرسل مفتاح عدم التكرار في الترويسة idempotency-key.':
    'Send the idempotency key in the idempotency-key header.',
  'سجّل دخولك لتلغي طلبك.': 'Sign in to cancel your order.',
  'مزوّد غير معروف.': 'Unknown provider.',
  'طلب غير معروف في الإشعار.': 'Unknown order in the payment notification.',
  'رفضت البوابة الدفع.': 'The payment gateway declined the payment.',
  'مفتاح عدم التكرار غير صالح.': 'Invalid idempotency key.',
  'الضيف يحتاج بريداً أو هاتفاً لنبلغه بطلبه.':
    'Guests need an email or a phone number so we can update them about their order.',
  'السلة فارغة.': 'Your cart is empty.',
  'لا يمكن إتمام الطلب بعد.': "The order can't be completed yet.",
  'تغيّر الإجمالي منذ حسبته. راجع المبلغ الجديد ثم اضغط «ادفع».':
    'The total has changed since it was calculated. Review the new amount, then press "Pay".',
  'الدفع غير متاح الآن — نضبط بيانات التحويل. جرّب بعد قليل.':
    "Payment isn't available right now — we're setting up the transfer details. Try again shortly.",
  'لا طلب بهذا الرقم.': 'No order has this number.',
  'هذا الطلب لا ينتظر تحويلاً.': "This order isn't awaiting a transfer.",
  'انتهت مهلة هذا الطلب ويُلغى، والقطع تعود للمخزون. ردّ التحويل للمشتري من البنك، أو اطلب منه أن يطلب من جديد.':
    "This order's time limit has passed and it's being canceled; its items go back to stock. Return the transfer to the buyer through the bank, or ask them to order again.",
  'تغيّرت حالة الطلب للتوّ. حدّث الصفحة.': "The order's status just changed. Refresh the page.",
  'هذا الطلب لا ينتظر تحويلاً — إلغاؤه من صفحة الطلب لكل متجر.':
    "This order isn't awaiting a transfer — cancel it from the order page for each shop.",
  'الكوبون غير صالح. أزله من السلة وأكمل الطلب.':
    'The coupon is invalid. Remove it from your cart and complete your order.',
  'استُنفد الكوبون للتوّ. أزله من السلة وأكمل الطلب.':
    'The coupon has just run out. Remove it from your cart and complete your order.',
  'هذا الكوبون بعدد استعمالات لكل حساب — سجّل الدخول لتستعمله.':
    'This coupon has a per-account usage limit — sign in to use it.',
  'استعملت هذا الكوبون بعدد مرّاته المسموح. أزله من السلة وأكمل الطلب.':
    "You've used this coupon as many times as allowed. Remove it from your cart and complete your order.",

  // ---- مزوّدو الدفع
  'وسيلة دفع غير معروفة.': 'Unknown payment method.',
  'تفويض غير معروف للاسترداد.': 'Unknown authorization for the refund.',
  'مبلغ الاسترداد موجب.': 'The refund amount must be positive.',
  'الاسترداد يتجاوز المبلغ المحصَّل.': 'The refund exceeds the amount collected.',
  'توقيع الإشعار غير صالح.': 'Invalid notification signature.',
  'وسيلة الدفع المتاحة التحويل البنكي — حدّث الصفحة.':
    'The available payment method is bank transfer — refresh the page.',
  'مبلغ الطلب موجب.': 'The order amount must be positive.',
  'التحويل اليدوي بلا إشعارات — يُؤكَّد الوصول من لوحة الإدارة.':
    'Manual transfers have no notifications — receipt is confirmed from the admin dashboard.',

  // ---- الطلبات
  'حالة الطلب غير معروفة.': 'Unknown order status.',
  'سبب الإرجاع غير معروف.': 'Unknown return reason.',
  'لا شركة شحن موصولة — التوصيل ذاتي: اكتب مرجع توصيلك وأكّد الشحن.':
    'No shipping company is connected — this is self-delivery: enter your delivery reference and confirm shipping.',
  'الاسترداد غير موجود.': 'Refund not found.',
  'هذا الاسترداد لا ينتظر تحويلاً — ربما سُجّل للتوّ. حدّث الصفحة.':
    "This refund isn't awaiting a transfer — it may have just been recorded. Refresh the page.",
  'لهذا المتجر طلب إرجاع قائم — انتظر ردّ المتجر عليه، ثم اطلب إرجاع غيره.':
    'This shop already has an open return request — wait for the shop to respond, then request another return.',
  'استلم المتجر مرتجعك ويُردّ مبلغه الآن — اطلب إرجاع غيره بعد أن يُردّ.':
    'The shop has received your return and is refunding it now — request another return after the refund.',
  'الإرجاع متاح بعد التسليم وحده.': 'Returns are only available after delivery.',
  'اختر قطعة واحدة على الأقل.': 'Choose at least one item.',
  'كمية الإرجاع عدد موجب.': 'The return quantity must be a positive number.',
  'سطر ليس في هذا الطلب.': "This item isn't in this order.",
  'لا طلب إرجاع قائم لهذا الطلب.': 'This order has no open return request.',
  'سعر صرف اللقطة غير صالح.': 'Invalid snapshot exchange rate.',
  'السبب مطلوب ويُعرض للطرف الآخر كما يُكتب.':
    'A reason is required and is shown to the other party as written.',
  'رقم التتبّع مطلوب عند الشحن.': 'A tracking number is required when shipping.',

  // ---- الشحن
  'غير موجود.': 'Not found.',
  'رمز البلد حرفان لاتينيان (SA، JO…).': 'The country code is two Latin letters (SA, JO…).',
  'أضف بلداً أو مدينة واحدة على الأقل إلى التغطية.':
    'Add at least one country or city to the coverage.',
  'المنطقة تحتاج تسعيرة واحدة على الأقل.': 'The zone needs at least one rate.',
  'البوليصة تُصدر للطلب قيد التجهيز أو الجاهز للشحن أو الذي تعذّر توصيله.':
    'A waybill can only be issued for an order that is being prepared, is ready to ship, or failed delivery.',
  'لا شركة شحن موصولة تُرسل أحداثاً.': 'No connected shipping company sends events.',
  'رقم تتبّع غير معروف.': 'Unknown tracking number.',
  'التسعيرة غير موجودة.': 'Rate not found.',
  'المنطقة غير موجودة.': 'Zone not found.',
  'المنطقة المفعّلة تحتاج بلداً أو مدينة واحدة على الأقل في تغطيتها.':
    'An active zone needs at least one country or city in its coverage.',
  'طريقة التسعير: سعر ثابت أو حسب الوزن أو مجاني فوق مبلغ.':
    'The pricing method must be a flat rate, by weight, or free above an amount.',
  'المبالغ لا تكون سالبة.': "Amounts can't be negative.",
  'التسعير حسب الوزن يحتاج سعراً للكيلوغرام أكبر من صفر.':
    'Weight-based pricing needs a price per kilogram greater than zero.',
  'سعر الكيلوغرام يخصّ التسعير حسب الوزن وحده.':
    'A price per kilogram applies only to weight-based pricing.',
  '«مجاني فوق مبلغ» يحتاج حدّاً أكبر من صفر.':
    '"Free above an amount" needs a threshold greater than zero.',
  'حدّ الشحن المجاني يخصّ طريقة «مجاني فوق مبلغ» وحدها.':
    'The free-shipping threshold applies only to the "Free above an amount" method.',
  'نهاية مدّة التوصيل يوم واحد على الأقل.': 'The delivery time must end at one day or later.',

  // ---- ما بعد البيع: النزاعات والمراجعات
  'سبب النزاع غير معروف.': 'Unknown dispute reason.',
  'اشرح المشكلة في 10 أحرف على الأقل.': 'Describe the problem in at least 10 characters.',
  'الطلب غير موجود.': 'Order not found.',
  'على طلب مُسترَد يُفتح النزاع لسبب «لم يصلني الاسترداد» وحده.':
    'On a refunded order, a dispute can only be opened for "I didn\'t receive the refund".',
  'النزاع متاح بعد الشحن وقبل إكمال الطلب.':
    'A dispute can be opened after shipping and before the order is completed.',
  'لهذا الطلب نزاع قائم.': 'This order already has an open dispute.',
  'النزاع غير موجود.': 'Dispute not found.',
  'الرسالة فارغة — اكتب ما يقرؤه الطرف الآخر.':
    'The message is empty — write something for the other party to read.',
  'النزاع مغلق.': 'The dispute is closed.',
  'لا يُصعَّد إلا نزاع مفتوح.': 'Only an open dispute can be escalated.',
  'سبب القرار يظهر للطرفين — 5 أحرف على الأقل.':
    'The decision reason is shown to both parties — at least 5 characters.',
  'النزاع مغلق أو غير موجود.': "The dispute is closed or doesn't exist.",
  'التقييم من 1 إلى 5.': 'The rating must be from 1 to 5.',
  'لا شراء بهذا السطر في حسابك.': 'Your account has no purchase of this item.',
  'المراجعة بعد استلام الطلب.': 'You can review after receiving the order.',
  'أُرجع هذا المنتج كاملاً — لا مراجعة عليه.':
    "This product was fully returned — it can't be reviewed.",
  'لا يقيّم صاحب المتجر منتجات متجره.': "Shop owners can't review their own shop's products.",
  'راجعت هذا الشراء من قبل.': "You've already reviewed this purchase.",
  'المنتج غير موجود.': 'Product not found.',

  // ---- المالية
  'المبلغ عدد صحيح موجب بالوحدات الصغرى.':
    'The amount must be a positive whole number in minor units.',
  'النطاق: عامة (global) أو متجر (vendor).': 'The scope must be global or vendor (a shop).',
  'مؤشّر الصفحة لا يخصّ هذا الكشف — ابدأ من الصفحة الأولى.':
    "The page cursor doesn't belong to this statement — start from the first page.",
  'مبلغ السحب موجب.': 'The payout amount must be positive.',
  'حساب المتجر موقوف، والسحب متوقّف معه. راسل الدعم.':
    'The shop account is inactive, so payouts are stopped too. Contact support.',
  'أضف حساباً بنكياً قبل السحب.': 'Add a bank account before requesting a payout.',
  'حسابك البنكي الافتراضي لم يوثّقه فريق بسطة بعد، ولا يُحوَّل إليه شيء قبل التوثيق.':
    "The Basta team hasn't verified your default bank account yet, and nothing is transferred to it until it's verified.",
  'المبلغ أكبر من رصيدك المتاح.': 'The amount is more than your available balance.',
  'مرجع التحويل مطلوب.': 'A transfer reference is required.',
  'سبب الرفض مطلوب ويُعرض للبائع.': 'A rejection reason is required and is shown to the seller.',
  'طلب السحب غير موجود.': 'Payout request not found.',
  'لا يُرفض إلا طلب لم يُحوَّل بعد.':
    "Only a request that hasn't been transferred yet can be rejected.",
  'حالة الطلب لا تسمح بهذا الإجراء.': "The request's status doesn't allow this action.",
  'النطاق: نسبة عامة أو نسبة متجر.': 'The scope must be a global rate or a shop rate.',
  'اختر المتجر.': 'Choose the shop.',
  'لا نسبة خاصة سارية لهذا المتجر.': 'This shop has no active custom rate.',
  'تاريخ غير صالح.': 'Invalid date.',
  'بداية المدى بعد نهايته — بدّل التاريخين.': 'The range starts after it ends — swap the dates.',

  // ---- البائعون
  'بلد المتجر يُكتب برمز من حرفين (JO، SA، AE…).':
    "The shop's country is written as a two-letter code (JO, SA, AE…).",
  'نوع النشاط: فرد أو شركة.': 'The business type must be individual or company.',
  'العملة غير مدعومة للتسوية.': "This currency isn't supported for settlement.",
  'الحدّ رقم صحيح.': 'The limit must be a whole number.',
  'الإزاحة رقم صحيح.': 'The offset must be a whole number.',
  'أرسل الرابط في المعامل value.': 'Send the shop link in the value parameter.',
  'أثناء التسجيل يُعدَّل الحساب البنكي من خطوات التسجيل نفسها.':
    'During registration, the bank account is edited from the registration steps themselves.',
  'اسم صاحب الحساب كما هو لدى البنك.': "Enter the account holder's name as the bank has it.",
  'اسم البنك مطلوب.': 'The bank name is required.',
  'رقم الآيبان غير صحيح. راجعه كما هو مكتوب في كشف حسابك.':
    'The IBAN is incorrect. Check it against your bank statement.',
  'هذا الحساب مضاف من قبل.': 'This account has already been added.',
  'الحساب لم يُوثَّق بعد. يصير افتراضياً بعد أن يوثّقه فريق بسطة.':
    "The account hasn't been verified yet. It can become the default once the Basta team verifies it.",
  'تغيّر الحساب. حدّث الصفحة.': 'The account has changed. Refresh the page.',
  'لا يُؤرشف الحساب الافتراضي. اجعل حساباً آخر افتراضياً أولاً.':
    "The default account can't be archived. Make another account the default first.",
  'الحساب موثَّق من قبل.': 'The account is already verified.',
  'لديك متجر مسجَّل بالفعل.': 'You already have a registered shop.',
  'اسم المتجر بالعربية مطلوب.': "The shop's Arabic name is required.",
  'اسم المتجر بالإنجليزية مطلوب.': "The shop's English name is required.",
  'اسم المتجر بالإنجليزية يُكتب بحروف إنجليزية.': "Write the shop's English name in English letters.",
  'بلد المتجر يُكتب برمز من حرفين (SA، JO، AE…).':
    "The shop's country is written as a two-letter code (SA, JO, AE…).",
  'رابط المتجر مستعمَل. جرّب البديل المقترح.':
    'This shop link is taken. Try the suggested alternative.',
  'لا متجر مسجَّل على حسابك.': "There's no shop registered to your account.",
  'بلد المتجر يُكتب برمز من حرفين.': "The shop's country is written as a two-letter code.",
  'تغيّرت حالة الوثيقة. حدّث الصفحة.': "The document's status has changed. Refresh the page.",
  'الوثيقة غير موجودة.': 'Document not found.',
  'تغيّرت حالة المتجر أو عملته. حدّث الصفحة.':
    "The shop's status or currency has changed. Refresh the page.",
  'أكمل النواقص قبل إرسال الطلب للمراجعة.':
    'Complete the missing items before submitting your application for review.',
  'طلبك قيد المراجعة الآن ولا يقبل التعديل. انتظر النتيجة أو راسل الدعم.':
    "Your application is under review and can't be edited now. Wait for the result or contact support.",
  'متجرك معتمد: اسمه ورابطه ووثائقه مثبّتة كما رُوجعت، ولتغييرها راسل الدعم. الحساب البنكي يُضاف من الإعدادات.':
    'Your shop is approved: its name, link and documents are locked as reviewed — contact support to change them. Bank accounts are added from Settings.',
  'حساب المتجر موقوف. راسل الدعم.': 'The shop account is inactive. Contact support.',
  'نوع وثيقة غير معروف.': 'Unknown document type.',
  'تغيّرت حالة الطلب. حدّث الصفحة.': "The application's status has changed. Refresh the page.",
  'سبب الرفض يُقرأ من البائع كما هو — اكتبه واضحاً (10 أحرف على الأقل).':
    'The seller reads the rejection reason as written — make it clear (at least 10 characters).',
  'سبب التعليق مطلوب ويُسجَّل في التدقيق.':
    'A suspension reason is required and is recorded in the audit log.',
  'تغيّرت حالة المتجر.': "The shop's status has changed.",
  'الملف ليس PDF ولا صورة JPEG أو PNG. حوّله ثم أعد الرفع.':
    "The file isn't a PDF or a JPEG or PNG image. Convert it, then upload it again.",
  'رابط المتجر يقبل الحروف اللاتينية الصغيرة والأرقام والشرطة، ويتراوح بين حرفين و40 حرفاً.':
    'The shop link accepts lowercase Latin letters, digits and hyphens, and must be 2 to 40 characters.',
  'هذا الرابط محجوز للمنصة. اختر غيره.':
    'This link is reserved for the platform. Choose another one.',
  'تعذّر اقتراح رابط متاح. اكتب رابطاً من عندك.':
    "We couldn't suggest an available link. Enter one of your own.",
  'عملة التسوية مثبَّتة ولا يمكن تغييرها. راسل الدعم إن كان التثبيت خطأً.':
    "The settlement currency is locked and can't be changed. Contact support if it was locked by mistake.",
  'عملة التسوية تتغيّر قبل إرسال الطلب للمراجعة فقط. راسل الدعم إن احتجت تغييرها.':
    'The settlement currency can only be changed before you submit your application for review. Contact support if you need to change it.',
  'أسعار منتجاتك أو شحنك مكتوبة بالعملة الحالية — تغييرها يغيّر معنى كل سعر. احذف المسعَّر أولاً أو راسل الدعم.':
    'Your product or shipping prices are in the current currency — changing it would change the meaning of every price. Remove the priced items first or contact support.',

  // ---- المراسلة
  'المحادثة غير موجودة.': 'Conversation not found.',
  'معرّف المنتج غير صالح.': 'Invalid product ID.',
  'رقم الطلب غير صالح.': 'Invalid order number.',
  'اكتب رسالة قبل الإرسال.': 'Write a message before sending.',
  'حدّد سياقاً واحداً للرسالة: منتجاً أو طلباً.':
    'Choose one context for the message: a product or an order.',
  'هذا متجرك — لا تُراسل متجرك من حساب المشتري.':
    "This is your shop — you can't message your own shop from your buyer account.",

  // ---- الإشعارات
  'فئة إشعار غير معروفة.': 'Unknown notification category.',
  'قيمة التفضيل تشغيل أو إطفاء.': 'The preference value must be on or off.',
  'انتهت صلاحية موضع التصفّح. حدّث الصفحة.':
    'Your browsing position has expired. Refresh the page.',
  'حدث غير معروف.': 'Unknown event.',
  'قناة غير معروفة.': 'Unknown channel.',
  'قالب رمز أمان: نصّه وقنواته مثبّتة في الكود ولا تُحرَّر من اللوحة، حتى لا يُكشف الرمز.':
    "This is a security-code template: its text and channels are fixed in the code and can't be edited from the dashboard, so the code is never exposed.",
  'تنبيه أمن إلزامي: يُحرَّر نصّه ولا يُوقف، فإيقافه يُخفي عن صاحب الحساب أن حسابه في خطر.':
    "This is a mandatory security alert: its text can be edited but it can't be turned off, because turning it off would hide from account holders that their account is at risk.",
  'البريد يحتاج عنواناً.': 'An email needs a subject.',

  // ---- الإدارة
  'المورد غير موجود.': 'Resource not found.',
  'التاريخ بصيغة YYYY-MM-DD.': 'The date must be in YYYY-MM-DD format.',
  'بداية الفترة قبل نهايتها.': 'The period must start before it ends.',
  'الرمز بأحرف لاتينية كبيرة وأرقام.': 'The code must use uppercase Latin letters and digits.',
  'أرفق الصورة في الحقل file.': 'Attach the image in the file field.',
  'اسم الحملة من 3 أحرف إلى 80.': 'The campaign name must be 3 to 80 characters.',
  'موضع غير معروف.': 'Unknown placement.',
  'البداية تاريخ صالح.': 'The start must be a valid date.',
  'النهاية تاريخ صالح.': 'The end must be a valid date.',
  'الكوبون غير صالح.': 'Invalid coupon.',
  'معرّف منتج غير صالح.': 'Invalid product ID.',
  'الحملة غير موجودة.': 'Campaign not found.',
  'البداية والنهاية تاريخان صالحان.': 'The start and end must be valid dates.',
  'نهاية الحملة بعد بدايتها.': 'The campaign must end after it starts.',
  'الكوبون غير موجود.': 'Coupon not found.',
  'الاسم والموضع والبداية والنهاية مطلوبة.': 'Name, placement, start and end are required.',
  'الرمز بأحرف لاتينية كبيرة وأرقام، 3–30.':
    'The code must be 3–30 uppercase Latin letters and digits.',
  'كوبون المتجر يحتاج المتجر.': 'A shop coupon needs a shop.',
  'النسبة بين 0.01% و 90%.': 'The percentage must be between 0.01% and 90%.',
  'المبلغ الثابت يحتاج قيمة وعملة.': 'A fixed amount needs a value and a currency.',
  'نهاية الصلاحية بعد بدايتها.': 'The validity must end after it starts.',
  'كوبون المنصة تموّله المنصة.': 'A platform coupon is funded by the platform.',
  'الرمز مستعمل.': 'This code is already in use.',
  'كوبون مستعمل: لا يتغيّر رمزه ولا نوعه ولا ممّوله. أوقفه وأنشئ غيره.':
    "This coupon has been used: its code, type and funder can't change. Disable it and create a new one.",
  'المسار بأحرف لاتينية صغيرة وأرقام وشرطات.':
    'The path must use lowercase Latin letters, digits and hyphens.',
  'المسار مستعمل.': 'This path is already in use.',
  'الصفحة غير موجودة.': 'Page not found.',
  'عرض صورة البانر 600 بكسل على الأقل.': 'The banner image must be at least 600 pixels wide.',
  'الملف ليس صورة صالحة.': "The file isn't a valid image.",
  'ارفع صورة البانر أولاً.': 'Upload the banner image first.',
  'كل المميّز منتجات منشورة.': 'All featured items must be published products.',
  'سبب الإخفاء مطلوب.': 'A reason for hiding is required.',
  'المراجعة غير موجودة.': 'Review not found.',
  'مالك المنصة لا تتغيّر صلاحياته ولا تُسحب إدارته إلا منه هو.':
    "The platform owner's permissions and admin access can only be changed by the owner.",
  'لا حساب بهذا البريد. اطلب من الشخص إنشاء حسابه أولاً.':
    'No account uses this email. Ask the person to create an account first.',
  'الحساب غير نشط.': 'The account is inactive.',
  'لا تسحب من نفسك صلاحية إدارة المستخدمين.':
    "You can't revoke your own user-management permission.",
  'ليس مديراً.': 'Not an admin.',
  'لا تسحب الإدارة من نفسك.': "You can't remove your own admin access.",
  'العميل غير موجود.': 'Customer not found.',
  'سبب التعليق مطلوب.': 'A suspension reason is required.',
  'اكتب سبباً واضحاً — كيف تحقّقت من هوية صاحب الحساب.':
    "Write a clear reason — how you verified the account holder's identity.",
  'لا حساب عميل بتحقق ثنائي مفعَّل بهذا المعرّف.':
    'No customer account with two-step verification turned on has this ID.',
  'إعداد غير قابل للتحرير.': "This setting can't be edited.",
  'قيمة غير مسموحة.': 'Value not allowed.',
  'القيمة نصّ.': 'The value must be text.',
  'عملة غير معروفة.': 'Unknown currency.',
  'هذه العملة موقوفة أو بلا سعر صرف نافذ — أضف سعرها أولاً.':
    'This currency is disabled or has no current exchange rate — add its rate first.',
  'رمز البلد حرفان.': 'The country code must be two letters.',
  'النسبة بين 0 و 50%.': 'The rate must be between 0% and 50%.',
  'السعر عدد موجب حتى عشر خانات.':
    'The rate must be a positive number with up to ten decimal places.',
  'عملة غير صالحة.': 'Invalid currency.',

  // ---- رسائل في ثابت أو شرط ثلاثي — لا يراها en-coverage.spec.ts
  'التاريخ بصيغة YYYY-MM-DD ويوم موجود في التقويم.':
    'The date must be in YYYY-MM-DD format and be a real calendar day.',
  'محاولات كثيرة من هذا الجهاز. انتظر دقيقة ثم حاول من جديد.':
    'Too many attempts from this device. Wait a minute, then try again.',
  'طلبات كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة.':
    'Too many requests in a short time. Wait a minute, then try again.',
  'جُدّدت جلستك للتوّ من نافذة أخرى. استعمل الرمز الجديد.':
    'Your session was just renewed from another window. Use the new token.',
  'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً من «نسيت كلمة المرور».':
    'The code is incorrect or has expired. Request a new code from "Forgot password".',
  'إن كان هذا البريد مسجّلاً لدينا فستصلك رسالة فيها رمز الاستعادة خلال دقائق.':
    "If this email is registered with us, you'll receive a message with a recovery code within minutes.",
  'حُدّثت كلمة المرور، وأُنهيت كل الجلسات المفتوحة على حسابك.':
    'Your password has been updated, and all open sessions on your account have been ended.',
  'تم التحقق.': 'Verified.',
  'الرمز غير صحيح ونفدت المحاولات. اطلب رمزاً جديداً.':
    "The code is incorrect and you're out of attempts. Request a new code.",
  'نفدت محاولاتك على هذا الرمز. اطلب رمزاً جديداً.':
    "You're out of attempts for this code. Request a new code.",
  'هذا الرمز استُعمل من قبل. اطلب رمزاً جديداً.':
    'This code has already been used. Request a new code.',
  'لا يوجد رمز نشط. اطلب رمزاً جديداً.': 'There is no active code. Request a new code.',
  'العنوان غير موجود. حدّث الصفحة لترى عناوينك الحالية.':
    'Address not found. Refresh the page to see your current addresses.',
  'الفئة غير موجود.': 'Category not found.',
  'التركيبة نفسها موجودة لمتغيّر آخر في المنتج — غيّر قيمة خيار.':
    'Another variant of this product already has the same combination — change an option value.',
  'SKU مستعمل لمتغيّر آخر في متجرك — لكل متغيّر حيّ SKU فريد على مستوى المتجر.':
    'This SKU is already used by another variant in your shop — every active variant needs a SKU that is unique across the shop.',
  'الكوبون لم يبدأ بعد.': "The coupon hasn't started yet.",
  'انتهت صلاحية الكوبون.': 'The coupon has expired.',
  'استُنفد الكوبون.': 'The coupon has run out.',
  'استعملت هذا الكوبون من قبل.': "You've already used this coupon.",
  'الإرجاع غير متاح بعد التسليم.': "Returns aren't available after delivery.",
  'انقضت مهلة الإرجاع (يوم واحد من التسليم).':
    'The return window has passed (one day from delivery).',
  'انقضت مهلة الإرجاع (يومين من التسليم).':
    'The return window has passed (two days from delivery).',
  'المبلغ عدد صحيح غير سالب بالوحدات الصغرى.':
    'The amount must be a non-negative whole number in minor units.',
  'المحادثة غير موجودة. حدّث الصفحة لترى رسائلك الحالية.':
    'Conversation not found. Refresh the page to see your current messages.',
  'المنتج غير متاح الآن، فلا يمكن سؤال متجره عنه.':
    "This product isn't available right now, so you can't ask its shop about it.",
  'الطلب غير موجود في حسابك.': "This order isn't in your account.",
  'الحساب البنكي غير موجود. حدّث الصفحة.': 'Bank account not found. Refresh the page.',
  'صيغة غير صحيحة.': 'Invalid format.',

  // ---- موانع وأسباب داخل ردّ ناجح — يترجمها localize-response.interceptor.ts
  // سبب تعذّر الدفع (payment.failureMessage)
  'ألغيت الطلب قبل التحويل.': 'You canceled the order before transferring.',
  'لم يُرسل طلب الدفع إلى البوابة.': 'The payment request was not sent to the gateway.',
  'مبلغ الإشعار لا يطابق الطلب.': "The notification amount doesn't match the order.",
  'رفض البنك البطاقة.': 'The bank declined the card.',
  'الرصيد غير كافٍ.': 'Insufficient funds.',
  'تعذّرت المعالجة.': 'Processing failed.',
  'تفويض غير معروف.': 'Unknown authorization.',
  'أُلغي التفويض.': 'The authorization was voided.',
  // سبب تخطّي إشعار أو فشله في سجل الإرسال (notifications.service.ts)
  'القالب غير مفعّل': 'The template is disabled',
  'استُنفدت المحاولات: سقط الخادم أثناء آخرها.':
    'Attempts exhausted: the server went down during the last one.',
  // نواقص طلب المتجر قبل المراجعة (vendors/domain/onboarding.ts)
  'اختر عملة التسوية — تُسعَّر بها منتجاتك وتُحوَّل بها مستحقاتك، ولا تتغيّر بعد اعتماد متجرك.':
    "Choose the settlement currency — your products are priced in it and your earnings are paid out in it, and it can't change after your shop is approved.",
  'السجل التجاري: لم تُرفع بعد.': 'Commercial register: not uploaded yet.',
  'الهوية الشخصية: لم تُرفع بعد.': 'National ID: not uploaded yet.',
  'الشهادة الضريبية: لم تُرفع بعد.': 'Tax certificate: not uploaded yet.',
  'إثبات الحساب البنكي: لم تُرفع بعد.': 'Bank account proof: not uploaded yet.',
  'بيانات الحساب البنكي مطلوبة لاستلام مستحقاتك.':
    'Bank account details are required to receive your earnings.',
  'اسم صاحب الحساب مطلوب كما هو لدى البنك.':
    "The account holder's name is required, as the bank has it.",
  // أخطاء أسطر ملف الاستيراد (catalog/domain/import-plan.ts)
  'السعر يجب أن يكون أكبر من صفر.': 'The price must be greater than zero.',
  'السطر يحوي خانات أكثر من العناوين — غالباً فاصلة داخل نص غير محاط بعلامتي تنصيص.':
    "The row has more cells than the headers — most likely a comma inside text that isn't wrapped in quotation marks.",
  'إلزامي.': 'Required.',
  'إلزامي — يجمع أسطر متغيّرات المنتج الواحد.':
    'Required — it groups the variant rows of one product.',
  'إلزامي — اسم فئة من فئات متجرك، أو اسم جديد تُنشأ به.':
    "Required — the name of one of your shop's categories, or a new name to create one.",
  'السعر قبل الخصم يجب أن يكون أعلى من السعر الحالي، أو اتركه فارغاً.':
    'The pre-discount price must be higher than the current price, or leave it empty.',
  'إلزامي — اكتب 0 إن لم يتوفّر مخزون.': "Required — enter 0 if there's no stock.",
  'الخياران يشيران إلى السمة نفسها.': 'Both options point to the same attribute.',
  // سياق المحادثة (messaging)
  'استفسار عام': 'General inquiry',

  // ---- صلاحيات الإدارة والإعدادات (admin/domain/permissions.ts) — labelAr و hint و unit و financial
  'مراجعة البائعين': 'Seller review',
  'اعتماد المتاجر ورفضها وتعليقها وقراءة وثائقها':
    'Approve, reject and suspend shops, and read their documents',
  الكتالوج: 'Catalog',
  'مكتبة السمات وقيمها، ومتابعة المنتجات المنشورة وإيقاف المخالف منها':
    'The attribute library and its values, and monitoring published products and taking down violating ones',
  الطلبات: 'Orders',
  'البحث في الطلبات والتدخّل في المرتجعات المتعثّرة':
    'Search orders and step in on stalled returns',
  'إلغاء الطلبات': 'Order cancellation',
  'إلغاء طلب قبل شحنه مع ردّ المبلغ للمشتري':
    'Cancel an order before it ships and refund the buyer',
  'حسم النزاعات': 'Dispute resolution',
  'قرار نهائي في نزاع مصعَّد': 'The final decision on an escalated dispute',
  'السحوبات والتحويلات': 'Payouts and transfers',
  'سحوبات البائعين، وتأكيد وصول تحويلات المشترين، وتسجيل ردّ المبالغ لهم — يحرّك مالاً':
    "Seller payouts, confirming buyers' transfers have arrived, and recording refunds to them — moves money",
  العمولات: 'Commissions',
  'تغيير النسب — تسري على الطلبات الجديدة وحدها':
    'Change the rates — they apply to new orders only',
  الكوبونات: 'Coupons',
  'إنشاء الكوبونات وإيقافها': 'Create and disable coupons',
  'المحتوى والإشعارات': 'Content and notifications',
  'الصفحات والبانرات والمميَّز وقوالب الإشعارات ومراجعات المنتجات':
    'Pages, banners, featured items, notification templates and product reviews',
  العملاء: 'Customers',
  'عرض حسابات المشترين وتعليقها': "View and suspend buyers' accounts",
  الإعدادات: 'Settings',
  'إعدادات المنصة والضرائب وأسعار الصرف — أثرها مالي':
    'Platform settings, taxes and exchange rates — with financial impact',
  التقارير: 'Reports',
  'لوحة المؤشرات والتقارير المالية وتصديرها':
    'The metrics dashboard and financial reports, and exporting them',
  'سجل التدقيق': 'Audit log',
  'قراءة سجل من فعل ماذا ومتى': 'Read the log of who did what and when',
  'مستخدمو الإدارة': 'Admin users',
  'منح صلاحيات الإدارة وسحبها': 'Grant and revoke admin permissions',
  'تعليق رصيد البائع': 'Seller balance hold',
  'يسري على الطلبات التي تُسلَّم بعد الحفظ؛ ما سُلّم قبله يبقى على موعده.':
    'Applies to orders delivered after saving; orders delivered before keep their original date.',
  'حجز رصيد المتجر المعلَّق': 'Suspended shop balance hold',
  'المتجر المعلَّق يسحب رصيده بعد هذه المدة من تعليقه — حجز احترازي لا مصادرة. يسري على المعلَّقين الآن أيضاً.':
    'A suspended shop can withdraw its balance this long after its suspension — a precautionary hold, not a confiscation. It also applies to shops suspended now.',
  'مهلة الإرجاع': 'Return window',
  'أقصر من فترة التعليق يعني تحرير مال قد يُطلب ردّه بعد صرفه.':
    'Shorter than the hold period means releasing money that may have to be refunded after it was paid out.',
  'مهلة حجز المخزون': 'Stock reservation time',
  'مهلة قبول البائع': 'Seller acceptance deadline',
  'انتهاء السلة': 'Cart expiry',
  'مهلة المصالحة': 'Payment reconciliation time',
  'هامش الصرف': 'Exchange spread',
  'يغيّر السعر المعروض للمشتري بين العملات من الآن؛ المستحقات السابقة على لقطتها.':
    'Changes the price buyers see across currencies from now on; earlier dues keep their snapshot.',
  'عملة المحاسبة': 'Accounting currency',
  'تغيّر عملة التقارير الموحّدة فقط — لا تمسّ أي دفتر.':
    "Changes only the currency of consolidated reports — it doesn't touch any ledger.",
  'عملة العرض الافتراضية': 'Default display currency',
  'ما يرى به الزائر الجديد الأسعار ويدفع، حتى يختار عملته من رأس المتجر':
    'The currency new visitors see prices and pay in, until they choose their own from the store header',
  'مموّل الكوبون الافتراضي': 'Default coupon funder',
  'مهلة التحويل': 'Transfer window',
  'القطع محجوزة للمشتري طوال المهلة، وبعدها يُلغى الطلب. تسري على الطلبات الجديدة وحدها.':
    'Items stay reserved for the buyer for the whole window; after it, the order is canceled. Applies to new orders only.',
  'اسم المستفيد': 'Beneficiary name',
  'كما يظهر للمحوِّل في تطبيق بنكه': 'As it appears to the sender in their banking app',
  'الاسم المستعار على كليك': 'CliQ alias',
  'حروف لاتينية وأرقام، كما سجّلته في بنكك':
    'Latin letters and digits, as registered with your bank',
  'رقم الحساب الدولي (IBAN)': 'International account number (IBAN)',
  'يبدأ برمز البلد، مثل JO94…': 'Starts with the country code, like JO94…',
  البنك: 'Bank',
  يوم: 'days',
  ساعة: 'hours',
  دقيقة: 'minutes',
  'نقطة أساس': 'basis points',

  // ---- الإشعارات (notifications/domain/templates.ts): القنوات والأحداث وتفضيلات بريد البائع
  البريد: 'Email',
  'رسالة نصية': 'SMS',
  واتساب: 'WhatsApp',
  'إشعار المتصفّح': 'Browser notification',
  'داخل الموقع': 'On the site',
  'تأكيد الطلب للمشتري': 'Order confirmation to the buyer',
  'طلب جديد للبائع': 'New order for the seller',
  'تغيّر حالة الطلب': 'Order status changed',
  'شحن الطلب للمشتري': 'Order shipped to the buyer',
  'إلغاء جزء من الطلب': 'Part of the order canceled',
  'رفض البائع طلب الإرجاع': 'Seller rejected the return request',
  'دفع متأخر رُدّ': 'Late payment refunded',
  'تنفيذ استرداد': 'Refund issued',
  'طلب بانتظار التحويل': 'Order awaiting transfer',
  'إلغاء طلب لم يصل تحويله': 'Order canceled — transfer not received',
  'ردّ المبلغ بتحويل': 'Refund sent by transfer',
  'إلغاء طلب للبائع': 'Order canceled — to the seller',
  'طلب إرجاع للبائع': 'Return request to the seller',
  'رسالة في نزاع': 'Message in a dispute',
  'نزاع جديد على طلب للبائع': 'New dispute on an order — to the seller',
  'تصعيد نزاع للإدارة — للمشتري': 'Dispute escalated to admin — to the buyer',
  'تصعيد نزاع للإدارة — للبائع': 'Dispute escalated to admin — to the seller',
  'قرار النزاع — للمشتري': 'Dispute decision — to the buyer',
  'قرار النزاع — للبائع': 'Dispute decision — to the seller',
  'سحب المشتري النزاع — للبائع': 'Buyer withdrew the dispute — to the seller',
  'نزاع مصعَّد ينتظر الحسم': 'Escalated dispute awaiting a decision',
  'نزاع مصعَّد بلا ردّ من الإدارة': 'Escalated dispute with no admin response',
  'طلب سحب ينتظر الموافقة': 'Payout request awaiting approval',
  'متجر ينتظر المراجعة': 'Shop awaiting review',
  'حساب بنكي ينتظر التوثيق': 'Bank account awaiting verification',
  'تحويل مشترٍ ينتظر التأكيد': 'Buyer transfer awaiting confirmation',
  'ردّ ينتظر التحويل اليدوي': 'Refund awaiting manual transfer',
  'رسالة في نزاع مصعَّد': 'Message in an escalated dispute',
  'سحب المشتري نزاعاً مصعَّداً': 'Buyer withdrew an escalated dispute',
  'مرتجع لم يستلمه المتجر': 'Return not received by the shop',
  'طلب قارب مهلة القبول': 'Order nearing its acceptance deadline',
  'انحراف في فحوص المال': 'Drift found in money checks',
  'تحويل سحب': 'Payout transferred',
  'رفض طلب سحب': 'Payout request rejected',
  'اعتماد المتجر': 'Shop approved',
  'رفض طلب المتجر': 'Shop application rejected',
  'رفض وثيقة من طلب المتجر': 'Document rejected in the shop application',
  'إيقاف منتج': 'Product taken down',
  'مخزون قارب النفاد': 'Stock running low',
  'رمز تأكيد البريد': 'Email confirmation code',
  'رمز استعادة كلمة المرور': 'Password recovery code',
  'استُعمل رمز استعادة': 'A recovery code was used',
  'تغيّر جهاز التحقق بخطوتين': 'Two-step verification device changed',
  'أعاد الدعم ضبط التحقق بخطوتين': 'Support reset two-step verification',
  'رسالة من مشترٍ': 'Message from a buyer',
  'ردّ من متجر': 'Reply from a shop',
  'أُضيف حساب بنكي': 'Bank account added',
  'وُثّق حساب بنكي': 'Bank account verified',
  'طلب جديد': 'New order',
  'عند كل طلب فرعي جديد': 'For every new shop order',
  'حين توقف الإدارة منتجاً منشوراً، مع السبب':
    'When admin takes down a published product, with the reason',
  'مخزون منخفض': 'Low stock',
  'عند بلوغ حدّ التنبيه': 'When the alert threshold is reached',
  'مرتجع أو نزاع': 'Return or dispute',
  'طلب إرجاع جديد، أو نزاع جديد أو رسالة أو تصعيد فيه — قرار النزاع يصل دائماً':
    'A new return request, or a new dispute or a message or escalation in it — dispute decisions always arrive',
  'حالة التحويلات': 'Payout status',
  'التحويل والرفض': 'Transfers and rejections',
  'رسائل المشترين': 'Buyer messages',
  'أول رسالة غير مقروءة في كل محادثة': 'The first unread message in each conversation',

  // ---- قيود كشف الحساب (finance ENTRY_LABELS) وأسباب الإرجاع والنزاع وأحداث الشحن ومؤشرات التقارير
  مبيعات: 'Sales',
  شحن: 'Shipping',
  'عمولة المنصة': 'Platform commission',
  'تحرير من المعلّق': 'Released from pending',
  'تحرير إلى المتاح': 'Released to available',
  'استرداد للمشتري': 'Refund to buyer',
  سحب: 'Payout',
  'تسوية دائنة': 'Credit adjustment',
  'تسوية مدينة': 'Debit adjustment',
  'فرق صرف': 'Exchange difference',
  'وصل تالفاً': 'Arrived damaged',
  'منتج غير الذي طلبته': 'Not the product I ordered',
  'لا يطابق الوصف': 'Not as described',
  'المقاس غير مناسب': "The size doesn't fit",
  'غيّرت رأيي': 'I changed my mind',
  'سبب آخر': 'Another reason',
  'لم يصلني الطلب': "I didn't receive the order",
  'رُفض إرجاعي': 'My return was refused',
  'لم يصلني الاسترداد': "I didn't receive the refund",
  'مشكلة أخرى': 'Another problem',
  'استلمت شركة الشحن الطرد': 'Picked up by the shipping company',
  'في الطريق': 'In transit',
  'خرج للتوصيل': 'Out for delivery',
  'توصيل ذاتي': 'Self-delivery',
  'أُلغي آلياً': 'Canceled automatically',
  المبيعات: 'Sales',
  العمولة: 'Commission',

  // ---- كلمات تُعرض وحدها أو تملأ متغيّراً ({0}…) في رسالة
  // حالات الطلب الفرعي (orders/domain/state-machine.ts STATUS_LABELS — statusLabel و toLabel) وأسباب رفض الانتقال
  'بانتظار قبول البائع': 'Awaiting seller acceptance',
  مقبول: 'Accepted',
  'قيد التجهيز': 'Preparing',
  'جاهز للشحن': 'Ready to ship',
  'تم الشحن': 'Shipped',
  'تعذّر التوصيل': 'Delivery failed',
  'تم التسليم': 'Delivered',
  'طلب إرجاع': 'Return requested',
  مُرجَع: 'Returned',
  مكتمل: 'Completed',
  'رفضه البائع': 'Rejected by seller',
  'ألغاه المشتري': 'Canceled by buyer',
  'ألغته الإدارة': 'Canceled by admin',
  مُسترَد: 'Refunded',
  'حالة نهائية.': 'it is a final status.',
  'انتقال غير مسموح.': 'this transition is not allowed.',
  'هذا الإجراء لا يخصّ دورك.': "this action isn't for your role.",
  // حالات المتجر (vendors/domain/onboarding.ts STATUS_LABELS)
  مسوّدة: 'Draft',
  'قيد المراجعة': 'Under review',
  معتمد: 'Approved',
  مرفوض: 'Rejected',
  معلَّق: 'Suspended',
  محظور: 'Banned',
  // وثائق المتجر (vendors/domain DOCUMENT_LABELS)
  'السجل التجاري': 'commercial register',
  'الهوية الشخصية': 'national ID',
  'الشهادة الضريبية': 'tax certificate',
  'إثبات الحساب البنكي': 'bank account proof',
  // موانع نشر المنتج (catalog/application/product.service.ts)
  'المتجر معلَّق — لا تنشر منتجاً حتى يُرفع التعليق':
    "the shop is suspended — you can't publish products until the suspension is lifted",
  'أرسل طلب متجرك للمراجعة أولاً — النشر يُتاح من لحظة إرساله':
    'submit your shop application for review first — publishing opens as soon as you submit it',
  'لا متغيّر فعّال يحمل سعراً': 'no active variant has a price',
  'اختر فئة للمنتج من «الفئة في متجرك»':
    'choose a category for the product under "Category in your shop"',
  'أضف صورة واحدة على الأقل — الأولى هي الرئيسية في المتجر':
    'add at least one image — the first one is the main image in the shop',
  // أسماء في القوالب العامة: assertOneOf وعمليات المال وعدد منتجات الفئة
  'حالة الطلب': 'order status',
  'حالة السحب': 'payout status',
  التصفية: 'filter',
  // تصفية القوائم الإدارية من الخادم (3 نوفمبر 2026)
  'حالة الصفحة': 'page status',
  'حالة الكوبون': 'coupon status',
  'حالة الحملة': 'campaign status',
  'تصفية اللافتات': 'banner filter',
  'تصفية المديرين': 'admin filter',
  'تصفية الخصائص': 'attribute filter',
  'رموز الإشعارات بأحرف لاتينية صغيرة وأرقام وشرطة سفلية، مفصولة بفواصل.':
    'Notification codes are lowercase Latin letters, digits and underscores, separated by commas.',
  جمع: 'Addition',
  طرح: 'Subtraction',
  مقارنة: 'Comparison',
  منتج: 'product',
  منتجات: 'products',
  مجهولة: 'unknown',
  // وثيقة مرفوضة بلا سبب مكتوب، وقائمة سمات فارغة في خطأ الاستيراد
  مرفوضة: 'Rejected',
  'لا شيء بعد': 'none yet',
};

export const EN_TEMPLATES: Readonly<Record<string, string>> = {
  'حجم صورة البانر أكبر من {0} م.ب.': 'The banner image is larger than {0} MB.',
  // ---- معالج الأخطاء العام
  'حدث خلل غير متوقّع ولم يكتمل طلبك. أعد المحاولة، وإن تكرّر أبلغنا بالرقم {0}.':
    "Something unexpected went wrong and your request wasn't completed. Try again, and if it keeps happening, report reference {0}.",

  // ---- عام
  // نصّان موصولان بـ «+»: {1} الأخير يأخذ النصّ الثاني، وترجمته في الإنجليزية نفسها
  'متغيّرات بيئة ناقصة: {0}.{1}':
    'Missing environment variables: {0}. Copy .env.example to .env and fill them in before starting.',
  'الانتقال من «{0}» إلى «{1}» غير مسموح.': 'Moving from "{0}" to "{1}" isn\'t allowed.',
  'عملة غير معروفة: {0}. أضِفها إلى جدول currencies أولاً.':
    'Unknown currency: {0}. Add it to the currencies table first.',
  'مبلغ كسري: {0}. المبالغ أعداد صحيحة بأصغر وحدة عملة (ADR-001).':
    'Fractional amount: {0}. Amounts are integers in the smallest currency unit (ADR-001).',
  'كمية غير صحيحة: {0}': 'Invalid quantity: {0}',
  'نسبة عمولة خارج المدى: {0} bps (المدى 0–10000)':
    'Commission rate out of range: {0} bps (range 0–10000)',
  'نصيب خارج السطر: {0}..{1} من {2}': 'Share outside the line: {0}..{1} of {2}',
  'سعر صرف غير صالح: {0}': 'Invalid exchange rate: {0}',
  'مبلغ غير صالح: "{0}"': 'Invalid amount: "{0}"',

  // ---- الهوية والحساب
  'كلمة المرور من {0} محارف على الأقل.': 'The password must be at least {0} characters.',
  'تحتاج صلاحية «{0}» لهذا الإجراء.': 'You need the "{0}" permission for this action.',
  'أرسلنا رمزاً قبل قليل. اطلب غيره بعد {0} ثانية.':
    'We just sent a code. Request another one in {0} seconds.',
  'كلمة المرور قصيرة. الحد الأدنى {0} محارف، والأطول أقوى من الأعقد.':
    'The password is too short. The minimum is {0} characters — longer beats more complex.',

  // ---- العناوين
  'بلغت {0} عنواناً محفوظاً. احذف عنواناً لا تستعمله ثم أضف الجديد.':
    "You've reached {0} saved addresses. Delete one you don't use, then add the new one.",
  'بلغت {0} عنواناً محفوظاً. احذف عنواناً لا تستعمله ثم استرجع هذا.':
    "You've reached {0} saved addresses. Delete one you don't use, then restore this one.",

  // ---- الكتالوج
  'حجم الصورة أكبر من {0} م.ب.': 'The image is larger than {0} MB.',
  'حجم الملف أكبر من {0} م.ب. قسّمه إلى ملفات أصغر.':
    'The file is larger than {0} MB. Split it into smaller files.',
  'رمز السمة «{0}» مستعمل.': 'The attribute code "{0}" is already in use.',
  '«{0}» مستعملة في {1} منتجاً أو متغيّراً أو صورة — صحّح اسمها بدل حذفها.':
    '"{0}" is used in {1} products, variants or images — correct its name instead of deleting it.',
  '«{0}» مستعملة في {1} منتجاً أو متغيّراً — أرشفها بدل حذفها: تختفي من خيارات البائعين وتبقى عند منتجاتها.':
    '"{0}" is used in {1} products or variants — archive it instead of deleting it: it disappears from sellers\' options and stays on its products.',
  'قيم «{0}» مربوطة بـ {1} صورة منتج — أرشفها بدل حذفها.':
    'Values of "{0}" are linked to {1} product images — archive it instead of deleting it.',
  'القيمة «{0}» مكررة في السمة — الاستيراد يطابق بالاسم فلا يُقبل تكراره.':
    'The value "{0}" is repeated in the attribute — import matches by name, so duplicates aren\'t allowed.',
  'الحد {0} صور للمنتج. احذف صورة قبل إضافة أخرى.':
    'The limit is {0} images per product. Delete an image before adding another.',
  'السطر {0} ({1}): {2} لم يُكتب شيء من الملف — أصلح السطر وأعد الرفع.':
    'Row {0} ({1}): {2} Nothing from the file was saved — fix the row and upload it again.',
  // موانع النشر مفصولة بـ «؛» — حتى أربعة، كل مانع يُترجم من EN_MESSAGES. الأطول أولاً
  'لا يمكن نشر المنتج بعد: {0}؛ {1}؛ {2}؛ {3}.':
    "The product can't be published yet: {0}; {1}; {2}; {3}.",
  'لا يمكن نشر المنتج بعد: {0}؛ {1}؛ {2}.': "The product can't be published yet: {0}; {1}; {2}.",
  'لا يمكن نشر المنتج بعد: {0}؛ {1}.': "The product can't be published yet: {0}; {1}.",
  'لا يمكن نشر المنتج بعد: {0}.': "The product can't be published yet: {0}.",
  'كمية المتغيّر «{0}» مطلوبة — اكتب 0 إن لم يتوفّر مخزون.':
    'The quantity of variant "{0}" is required — enter 0 if there\'s no stock.',
  'كمية المتغيّر الجديد «{0}» مطلوبة — اكتب 0 إن لم يتوفّر.':
    'The quantity of the new variant "{0}" is required — enter 0 if none is available.',
  'SKU {0} مستعمل لمتغيّر آخر في متجرك.':
    'SKU {0} is already used by another variant in your shop.',
  'خيار في المتغيّر «{0}» يشير إلى سمة ليست من سمات المتغيّرات (كاللون والمقاس).':
    'An option in variant "{0}" points to an attribute that isn\'t a variant attribute (like color or size).',
  'القيمة المختارة لـ«{0}» في المتغيّر «{1}» ليست من قيمها المعرّفة.':
    'The value chosen for "{0}" in variant "{1}" isn\'t one of its defined values.',
  // سعر متغيّر مرفوض: `${label} يجب أن يكون أكبر من صفر.` و `${label}: ${err.message}` (parsePrice)
  'سعر المتغيّر «{0}» يجب أن يكون أكبر من صفر.':
    'The price of variant "{0}" must be greater than zero.',
  'السعر قبل الخصم للمتغيّر «{0}» يجب أن يكون أكبر من صفر.':
    'The pre-discount price of variant "{0}" must be greater than zero.',
  'سعر المتغيّر «{0}»: مبلغ غير صالح: "{1}"': 'Price of variant "{0}": invalid amount "{1}"',
  'السعر قبل الخصم للمتغيّر «{0}»: مبلغ غير صالح: "{1}"':
    'Pre-discount price of variant "{0}": invalid amount "{1}"',
  'سعر المتغيّر «{0}»: {1} يقبل {2} خانة عشرية، والمُدخل يحمل {3}: "{4}"':
    'Price of variant "{0}": {1} allows {2} decimal places, but the input has {3}: "{4}"',
  'السعر قبل الخصم للمتغيّر «{0}»: {1} يقبل {2} خانة عشرية، والمُدخل يحمل {3}: "{4}"':
    'Pre-discount price of variant "{0}": {1} allows {2} decimal places, but the input has {3}: "{4}"',
  'السعر قبل الخصم للمتغيّر «{0}» يجب أن يكون أعلى من سعره، أو اتركه فارغاً.':
    'The pre-discount price of variant "{0}" must be higher than its price, or leave it empty.',
  'وزن المتغيّر «{0}» عدد صحيح بالغرام لا يقل عن صفر.':
    'The weight of variant "{0}" must be a whole number of grams, not less than zero.',
  '«{0}» سمة متغيّرات — تُحدَّد على كل متغيّر لا على المنتج.':
    '"{0}" is a variant attribute — set it on each variant, not on the product.',
  'السمة «{0}» مذكورة مرتين.': 'The attribute "{0}" is listed twice.',
  'اختر قيمة من قيم «{0}» المعرّفة.': 'Choose one of the defined values of "{0}".',
  '«{0}» تحتاج رقماً.': '"{0}" needs a number.',
  '«{0}» نصّ من حرف إلى 500 حرف.': '"{0}" must be text of 1 to 500 characters.',
  '«{0}» نعم أو لا.': '"{0}" must be yes or no.',
  'السمات متعددة الاختيار («{0}») غير مدعومة على المنتج بعد.':
    'Multi-select attributes ("{0}") aren\'t supported on products yet.',
  '«{0}» مؤرشفة — لا تُختار لمنتج جديد.':
    '"{0}" is archived — it can\'t be chosen for a new product.',
  'بلغ متجرك حدّ {0} فئة. ادمج فئات متقاربة أو احذف ما لا تستعمله.':
    "Your shop has reached the limit of {0} categories. Merge similar categories or delete ones you don't use.",
  '«{0}» فيها {1} {2} — انقلها إلى فئة أخرى قبل حذفها.':
    '"{0}" has {1} {2} — move them to another category before deleting it.',
  'الملف ينشئ فئات تتجاوز حدّ {0} فئة للمتجر.':
    "The file would create categories beyond the shop's limit of {0} categories.",
  'الفئة «{0}» موجودة في متجرك.': 'The category "{0}" already exists in your shop.',
  'العمود «{0}» مذكور مرتين في سطر العناوين.': 'The column "{0}" appears twice in the header row.',
  'أعمدة غير معروفة: {0}. نزّل القالب واستعمل عناوينه كما هي.':
    'Unknown columns: {0}. Download the template and use its headers as they are.',
  'أعمدة إلزامية ناقصة: {0}.': 'Missing required columns: {0}.',
  'SKU «{0}» غير صالح: حروف لاتينية وأرقام و . _ - / فقط، يبدأ بحرف أو رقم، وحتى 64 محرفاً.':
    'SKU "{0}" is invalid: Latin letters, digits and . _ - / only, starting with a letter or digit, up to 64 characters.',
  'الحد {0} متغيّر للمنتج الواحد، والمُرسل {1}.':
    'The limit is {0} variants per product; {1} were sent.',
  'الحد {0} سمات تميّز المتغيّرات (مثل المقاس واللون).':
    'The limit is {0} attributes that distinguish variants (like size and color).',
  'SKU «{0}» مكرر بين المتغيّرين {1} و {2}.': 'SKU "{0}" is repeated in variants {1} and {2}.',
  'المتغيّر «{0}» لا يحمل السمات نفسها التي تحملها بقية المتغيّرات — كلها تُعرَّف بالسمات ذاتها.':
    'Variant "{0}" doesn\'t have the same attributes as the other variants — all of them must be defined by the same attributes.',
  'التركيبة نفسها مكررة في المتغيّرين «{0}» و«{1}» — غيّر قيمة خيار في أحدهما.':
    'Variants "{0}" and "{1}" have the same combination — change an option value in one of them.',
  'الملف يحوي {0} سطراً والحد {1} في الملف الواحد. قسّمه إلى ملفات أصغر.':
    'The file has {0} rows and the limit is {1} per file. Split it into smaller files.',
  // CSV لا يُقرأ: برقم السطر أو بدونه (قالب داخل قالب) — الثاني يلتقط الحالتين، فالأول قبله
  'تعذّرت قراءة CSV قرب السطر {0}: علامة تنصيص غير مغلقة غالباً. أغلقها أو احذفها وأعد الرفع.':
    "Couldn't read the CSV near line {0}: most likely an unclosed quotation mark. Close or remove it and upload again.",
  'تعذّرت قراءة CSV{0}':
    "Couldn't read the CSV: most likely an unclosed quotation mark. Close or remove it and upload again.",
  'الورقة تحوي {0} سطراً والحد {1} في الملف الواحد.':
    'The sheet has {0} rows and the limit is {1} per file.',
  'حجم الصورة {0} م.ب والحد {1} م.ب. صغّرها أو صدّرها بجودة أقل.':
    'The image is {0} MB and the limit is {1} MB. Make it smaller or export it at a lower quality.',
  'صيغة {0} غير مقبولة. الصيغ المقبولة: JPEG و PNG و WebP و AVIF.':
    "The {0} format isn't accepted. Accepted formats: JPEG, PNG, WebP and AVIF.",
  'أبعاد الصورة {0}×{1} والحد الأعلى {2} بكسل للضلع.':
    'The image is {0}×{1} and the maximum is {2} pixels per side.',
  'الصورة صغيرة ({0}×{1}): أقصر ضلع {2} بكسل على الأقل ليظهر المنتج واضحاً.':
    'The image is too small ({0}×{1}): its shortest side must be at least {2} pixels so the product shows clearly.',
  'ملف Excel يحوي {0} مدخلاً — أكثر مما يحويه جدول منتجات.':
    'The Excel file has {0} entries — more than a product sheet would contain.',

  // ---- المخزون
  // نصّان موصولان بـ «+» (StockBelowReservedError): {2} الأخير يأخذ النصّ الثاني
  'لا يمكن جعل المخزون {0} لأن {1} قطعة محجوزة الآن لمشترين في صفحة الدفع.{2}':
    "Stock can't be set to {0} because {1} units are reserved right now by buyers at checkout. Choose {1} or more, or wait for the reservation to expire (15 minutes).",
  // assertQty بأسماء حقوله — قوالب لا كلمات: «الكمية» عنوان عمود في ملف الاستيراد أيضاً ولا يُترجم هناك
  'الكمية المطلوبة يجب أن تكون عدداً صحيحاً بين 0 و {0}، والمُدخل {1}.':
    'The requested quantity must be a whole number between 0 and {0}; got {1}.',
  'حد تنبيه النفاد يجب أن تكون عدداً صحيحاً بين 0 و {0}، والمُدخل {1}.':
    'The low-stock alert threshold must be a whole number between 0 and {0}; got {1}.',
  'الكمية يجب أن تكون عدداً صحيحاً بين 0 و {0}، والمُدخل {1}.':
    'The quantity must be a whole number between 0 and {0}; got {1}.',
  'الكمية المطلوبة من «{0}» يجب أن تكون 1 أو أكثر، والمُدخل {1}.':
    'The requested quantity of "{0}" must be 1 or more; got {1}.',
  'الكمية يجب أن تكون عدداً صحيحاً، والناتج {0}.':
    'The quantity must be a whole number; the result is {0}.',
  'التعديل يجعل المخزون {0}، والمخزون لا يكون سالباً. المتوفّر حالياً {1}.':
    "This adjustment would make the stock {0}, and stock can't be negative. Currently on hand: {1}.",
  'الحد الأعلى للمخزون {0} قطعة لكل متغيّر.': 'The maximum stock is {0} units per variant.',

  // ---- السلة
  'الكمية من 1 إلى {0}.': 'The quantity must be from 1 to {0}.',

  // ---- المفضّلة
  'بلغت مفضّلتك {0} منتج. أزل منتجاً لم تعد تريده ثم احفظ الجديد.':
    'Your wishlist has reached {0} products. Remove one you no longer want, then save the new one.',

  // ---- التسعير
  'لا سعر صرف نافذ بين {0} و {1}.': 'No current exchange rate between {0} and {1}.',
  'كمية غير صالحة لـ {0}.': 'Invalid quantity for {0}.',

  // ---- إتمام الطلب
  'لديك {0} طلبات بانتظار التحويل. حوّل ثمن أحدها أو ألغِه من «طلباتي» قبل طلب جديد.':
    'You have {0} orders awaiting a transfer. Pay for one of them or cancel it from "My orders" before placing a new order.',
  'أُكّد تحويل هذا الطلب من قبل بالمرجع {0}.':
    "This order's transfer was already confirmed with reference {0}.",
  'المبلغ الواصل لا يطابق الطلب ({0}). لا تؤكّد إلا تحويلاً بالمبلغ كاملاً.':
    "The amount received doesn't match the order ({0}). Only confirm a transfer for the full amount.",
  'لم يبقَ ما يكفي من «{0}» لهذا الطلب — لا تؤكّده. ردّ التحويل للمشتري من البنك.':
    'There isn\'t enough "{0}" left for this order — don\'t confirm it. Return the transfer to the buyer through the bank.',

  // ---- الطلبات
  'الكمية المتاحة للإرجاع {0}.': 'The quantity available to return is {0}.',
  'لا يمكن إرجاع {0} من سطر بقي منه {1}.':
    "You can't return {0} of an item that has only {1} left.",
  'لا يمكن نقل الطلب من «{0}» إلى «{1}»: {2}': 'The order can\'t move from "{0}" to "{1}": {2}',

  // ---- الشحن
  'المنطقة تحمل {0} تسعيرات على الأكثر.': 'A zone can have at most {0} rates.',
  'بلغت {0} منطقة — عدّل منطقة قائمة أو احذف واحدة لا تستعملها.':
    "You've reached {0} zones — edit an existing zone or delete one you don't use.",
  'المنطقة تحمل {0} تسعيرات على الأكثر — عدّل تسعيرة قائمة.':
    'A zone can have at most {0} rates — edit an existing rate.',
  '«{0}» مغطّاة بالدقّة نفسها في منطقة «{1}» المفعّلة — المشتري هناك سيُسعَّر بإحداهما دون ترتيب. احذفها من إحدى المنطقتين، أو أوقف الأخرى.':
    '"{0}" is covered just as precisely by the active zone "{1}" — buyers there would be priced by either one at random. Remove it from one of the zones, or turn off the other one.',
  'مدّة التوصيل عدد أيام صحيح بين 0 و {0}.':
    'The delivery time must be a whole number of days between 0 and {0}.',
  'نهاية المدى يجب أن تكون مساوية أو أكبر من بدايته ({0} أيام).':
    'The end of the range must be equal to or greater than its start ({0} days).',

  // ---- ما بعد البيع: النزاعات والمراجعات
  'انقضت {0} يوماً على الاسترداد — لا يُفتح عليه نزاع.':
    '{0} days have passed since the refund — a dispute can no longer be opened on it.',

  // ---- المالية
  'كشف الحساب لمدة {0} يوماً على الأكثر — ضيّق التاريخين.':
    'A statement can cover at most {0} days — narrow the dates.',
  'المتجر معلَّق، ورصيده محجوز احترازياً حتى {0} — يمكن طلب السحب بعدها.':
    'The shop is suspended and its balance is held as a precaution until {0} — you can request a payout after that.',
  'المدى {0} يوماً على الأكثر.': 'The range can be at most {0} days.',

  // ---- البائعون
  'حجم الملف يتجاوز {0} ميغابايت.': 'The file is larger than {0} MB.',
  'الحدّ {0} حسابات. أرشف حساباً لا تستعمله أولاً.':
    "The limit is {0} accounts. Archive an account you don't use first.",
  'نوع وثيقة غير معروف: {0}.': 'Unknown document type: {0}.',
  'سبب رفض {0} يُكتب للبائع — لا يُترك فارغاً.':
    "The reason for rejecting the {0} is shown to the seller — it can't be left empty.",
  // الوثائق المرفوضة مفصولة بـ «،» — حتى أربع، كل اسم يُترجم من EN_MESSAGES. الأطول أولاً
  'لا يُعتمد المتجر وفيه وثيقة مرفوضة: {0}، {1}، {2}، {3}. اقبلها بعد أن يعيد البائع رفعها، أو اطلب تعديلاً.':
    "The shop can't be approved while it has rejected documents: {0}, {1}, {2} and {3}. Accept them after the seller uploads them again, or request changes.",
  'لا يُعتمد المتجر وفيه وثيقة مرفوضة: {0}، {1}، {2}. اقبلها بعد أن يعيد البائع رفعها، أو اطلب تعديلاً.':
    "The shop can't be approved while it has rejected documents: {0}, {1} and {2}. Accept them after the seller uploads them again, or request changes.",
  'لا يُعتمد المتجر وفيه وثيقة مرفوضة: {0}، {1}. اقبلها بعد أن يعيد البائع رفعها، أو اطلب تعديلاً.':
    "The shop can't be approved while it has rejected documents: {0} and {1}. Accept them after the seller uploads them again, or request changes.",
  'لا يُعتمد المتجر وفيه وثيقة مرفوضة: {0}. اقبلها بعد أن يعيد البائع رفعها، أو اطلب تعديلاً.':
    "The shop can't be approved while it has a rejected document: {0}. Accept it after the seller uploads it again, or request changes.",
  'حجم الملف يتجاوز {0} ميغابايت. اضغطه أو صوّره بجودة أقل.':
    'The file is larger than {0} MB. Compress it or photograph it at a lower quality.',
  'العملة {0} غير مدعومة للتسوية.': "The currency {0} isn't supported for settlement.",

  // ---- المراسلة
  'الرسالة أطول من {0} حرف. اختصرها أو قسّمها رسالتين.':
    'The message is longer than {0} characters. Shorten it or split it into two messages.',

  // ---- الإشعارات
  'متغيّرات غير متاحة لهذا الحدث: {0}': 'Variables not available for this event: {0}',

  // ---- الإدارة
  // في المصدر '\\' (شرطة عكسية واحدة عند التشغيل) — {0} مكانها يطابقها كما تصل وكما يقرؤها الفحص
  'الرابط مسار داخل الموقع يبدأ بـ / (لا // ولا {0} ولا مسافات).':
    'The link must be a path within the site that starts with / (no //, no {0} and no spaces).',
  'الفترة {0} يوماً على الأكثر — للأطول صدّر سنة بسنة.':
    'The period can be at most {0} days — for longer periods, export one year at a time.',
  'الحملة حتى {0} منتجاً.': 'A campaign can have up to {0} products.',
  'الكوبون {0} موقوف — فعّله أولاً أو اختر غيره.':
    'Coupon {0} is disabled — enable it first or choose another one.',
  'الكوبون {0} منتهٍ.': 'Coupon {0} has expired.',
  'منتج مكرّر في القائمة: {0}': 'Duplicate product in the list: {0}',
  'منتج غير موجود: {0}': 'Product not found: {0}',
  'كل منتجات الحملة منشورة — غير منشور: {0}':
    'All campaign products must be published — not published: {0}',
  'لا تمنح ولا تسحب صلاحية لا تحملها أنت: {0}. اطلب ذلك من مالك المنصة.':
    "You can't grant or revoke permissions you don't hold: {0}. Ask the platform owner.",
  'صلاحيات غير معروفة: {0}': 'Unknown permissions: {0}',
  'القيمة عدد صحيح بين {0} و {1}.': 'The value must be a whole number between {0} and {1}.',
  'أطول من {0} حرفاً.': 'Longer than {0} characters.',

  // ---- رسائل في ثابت أو شرط ثلاثي أو super بعد تعليق — لا يراها en-coverage.spec.ts
  'بقي {0} فقط من «{1}». قلّل الكمية أو أزل الصنف لمتابعة الشراء.':
    'Only {0} of "{1}" left. Lower the quantity or remove the item to continue checkout.',
  'نفد «{0}». يمكنك إتمام باقي الطلب، أو إزالته ومتابعة الشراء.':
    '"{0}" is out of stock. You can complete the rest of the order, or remove it and continue checkout.',
  'الحد الأدنى للسحب {0} — رصيدك يتراكم حتى يتجاوزه، ولا يضيع منه شيء.':
    'The minimum payout is {0} — your balance keeps building until it passes it, and none of it is lost.',
  // throttle.ts: «دقيقة» وحدها في EN_MESSAGES، وما فوقها هنا
  'محاولات كثيرة من هذا الجهاز. انتظر {0} دقيقة ثم حاول من جديد.':
    'Too many attempts from this device. Wait {0} minutes, then try again.',
  'طلبات كثيرة في وقت قصير. انتظر {0} دقيقة ثم أعد المحاولة.':
    'Too many requests in a short time. Wait {0} minutes, then try again.',
  // otpMessage (identity/domain/otp.ts)
  'الرمز غير صحيح. بقيت لك {0} محاولة.': 'The code is incorrect. You have {0} attempts left.',
  'انتهت صلاحية الرمز بعد {0} دقائق. اطلب رمزاً جديداً.':
    'The code expired after {0} minutes. Request a new code.',
  'الرسالة من {0} إلى {1} حرف.': 'The message must be {0} to {1} characters.',
  // daysAr: «يوم واحد» و«يومين» في EN_MESSAGES، والجمع والمفرد المنصوب هنا
  'انقضت مهلة الإرجاع ({0} أيام من التسليم).':
    'The return window has passed ({0} days from delivery).',
  'انقضت مهلة الإرجاع ({0} يوماً من التسليم).':
    'The return window has passed ({0} days from delivery).',
  // hint الإعداد يُترجم من EN_MESSAGES
  'صيغة غير صحيحة — {0}.': 'Invalid format — {0}.',
  'منطقة «{0}» المفعّلة تحتاج تسعيرة مفعّلة واحدة على الأقل — فعّل تسعيرة فيها أولاً.':
    'The active zone "{0}" needs at least one active rate — activate a rate in it first.',
  'فعّل تسعيرة واحدة على الأقل في «{0}» قبل تفعيل المنطقة — بلا تسعيرة مفعّلة لن يستطيع المشترون هناك الشراء منك.':
    'Activate at least one rate in "{0}" before activating the zone — without an active rate, buyers there can\'t buy from you.',
  'لا يمكن إيقاف هذه التسعيرة — هي الوحيدة المفعّلة في «{0}»، وبدونها لن يستطيع المشترون هناك الشراء منك. أضف تسعيرة أخرى أولاً، أو أوقف المنطقة نفسها.':
    "This rate can't be turned off — it's the only active one in \"{0}\", and without it buyers there can't buy from you. Add another rate first, or turn off the zone itself.",
  'منطقة «{0}» المفعّلة تحتاج تسعيرة مفعّلة واحدة على الأقل — بدونها لن يستطيع المشترون هناك الشراء منك.':
    'The active zone "{0}" needs at least one active rate — without one, buyers there can\'t buy from you.',

  // ---- موانع وأسباب داخل ردّ ناجح — يترجمها localize-response.interceptor.ts
  // سبب تعذّر الدفع: مهلة التحويل بـ hoursAr (6–168 ساعة: جمع أو مفرد)
  'لم يصل التحويل خلال {0} ساعات، فأُلغي الطلب وعادت القطع للمخزون.':
    "The transfer didn't arrive within {0} hours, so the order was canceled and its items went back to stock.",
  'لم يصل التحويل خلال {0} ساعة، فأُلغي الطلب وعادت القطع للمخزون.':
    "The transfer didn't arrive within {0} hours, so the order was canceled and its items went back to stock.",
  // موانع السلة والتسعير (cart.service.ts، pricing/domain/pricing.ts) — ما يبدأ باسم البائع أو المنتج آخر الملف
  'الكوبون {0} لا ينطبق على منتجات سلّتك.':
    "Coupon {0} doesn't apply to the products in your cart.",
  // {1} سبب رفض التسعير له («استُنفد الكوبون.») — يُترجم من الرسائل
  'الكوبون {0} لم يعد صالحاً — {1} أزله من سلّتك لتكمل الطلب.':
    'Coupon {0} is no longer valid — {1} Remove it from your cart to complete the order.',
  // وثيقة مرفوضة في نواقص طلب المتجر — {0} سبب الرفض كما كتبته الإدارة
  'السجل التجاري: {0} — ارفعها من جديد.': 'Commercial register: {0} — upload it again.',
  'الهوية الشخصية: {0} — ارفعها من جديد.': 'National ID: {0} — upload it again.',
  'الشهادة الضريبية: {0} — ارفعها من جديد.': 'Tax certificate: {0} — upload it again.',
  'إثبات الحساب البنكي: {0} — ارفعها من جديد.': 'Bank account proof: {0} — upload it again.',
  // أخطاء أسطر ملف الاستيراد (catalog/domain/import-plan.ts، product-import.service.ts)
  'أطول من {0} محرفاً.': 'Longer than {0} characters.',
  '«{0}» ليس عدداً صحيحاً موجباً.': '"{0}" is not a positive whole number.',
  '«{0}» ليس مبلغاً صالحاً.': '"{0}" is not a valid amount.',
  '«{0}» غير صالح: حروف لاتينية وأرقام و . _ - / فقط، حتى 64 محرفاً.':
    '"{0}" is invalid: Latin letters, digits and . _ - / only, up to 64 characters.',
  'القيمة «{0}» بلا اسم خيار.': 'The value "{0}" has no option name.',
  'الخيار «{0}» بلا قيمة.': 'The option "{0}" has no value.',
  'الخيار «{0}» مذكور مرتين.': 'The option "{0}" is listed twice.',
  'مكرر في الملف — ورد أولاً في السطر {0}.':
    'Duplicated in the file — it first appears on row {0}.',
  '«{0}» ليست سمة متغيّرات معرّفة. المتاح: {1}.':
    '"{0}" isn\'t a defined variant attribute. Available: {1}.',
  'القيمة «{0}» غير معرّفة للسمة «{1}». المتاح: {2}.':
    'The value "{0}" isn\'t defined for the attribute "{1}". Available: {2}.',
  'يخالف الاسم في السطر {0} لرمز المنتج «{1}».':
    'The name differs from row {0} for product code "{1}".',
  'تخالف الفئة في السطر {0} لرمز المنتج «{1}».':
    'The category differs from row {0} for product code "{1}".',
  'خيارات هذا السطر لا تطابق خيارات السطر {0} لرمز المنتج «{1}» — كل المتغيّرات تُعرَّف بالسمات ذاتها.':
    'This row\'s options don\'t match the options on row {0} for product code "{1}" — all variants must be defined by the same attributes.',
  'رمز المنتج «{0}» له أكثر من سطر بلا خيارات تميّزها (السطر {1}).':
    'Product code "{0}" has more than one row with no options to tell them apart (row {1}).',
  'التركيبة نفسها وردت في السطر {0} لرمز المنتج «{1}».':
    'The same combination appears on row {0} for product code "{1}".',
  'لرمز المنتج «{0}» بلغ حد {1} متغيّر.':
    'Product code "{0}" has reached the limit of {1} variants.',
  'محجوز منها {0} لمشترين في صفحة الدفع الآن — لا تقل الكمية عن {1}.':
    "{0} of them are reserved right now by buyers at checkout — the quantity can't go below {1}.",
  // سجل إرسال الإشعارات: {0} اسم القناة (CHANNEL_LABELS) أو اسم المتغيّر
  'لا عنوان لقناة {0}': 'No address for the {0} channel',
  'متغيّر ناقص في القالب: {0}': 'Missing template variable: {0}',
  // سياق المحادثة (messaging) — رقم الطلب الفرعي يبدأ بـ BST-
  'منتج: {0}': 'Product: {0}',
  'طلب BST-{0}': 'Order BST-{0}',

  // ---- قوالب عامة تبدأ بمتغيّر — آخراً: تطابق أوسع من غيرها، فتُجرَّب بعد القوالب المحدّدة
  // موانع السلة والتسعير: {0} اسم المنتج أو البائع
  '{0} نفد. احذفه من سلّتك.': '{0} is out of stock. Remove it from your cart.',
  '{0}: المتاح {1} فقط.': '{0}: only {1} available.',
  '{0} لم يعد متاحاً للبيع. احذفه من سلّتك.':
    '{0} is no longer available for sale. Remove it from your cart.',
  '{0} لا يشحن إلى عنوانك.': "{0} doesn't ship to your address.",
  '{0} لم يحدّد سعر شحن لمنطقتك.': "{0} hasn't set a shipping price for your area.",
  // استيراد: «الحد الأعلى {0}.» يطابق «الحد الأعلى للمخزون …» أيضاً — فهو هنا بعده
  'الحد الأعلى {0}.': 'The maximum is {0}.',
  // نصّان موصولان بـ «+» (assertSameCurrency): {3} الأخير يأخذ النصّ الثاني
  '{0} بين عملتين مختلفتين: {1} و {2}.{3}':
    '{0} between two different currencies: {1} and {2}. Convert with convert() at a captured exchange rate first (ADR-013).',
  '{0} يقبل {1} خانة عشرية، والمُدخل يحمل {2}: "{3}"':
    '{0} allows {1} decimal places, but the input has {2}: "{3}"',
  '{0} غير موجود.': '{0} not found.',
  '{0} غير معروفة: {1}.': 'Unknown {0}: {1}.',
  '{0} يجب أن يكون أكبر من صفر.': '{0} must be greater than zero.',
  '{0} يجب أن تكون عدداً صحيحاً بين 0 و {1}، والمُدخل {2}.':
    '{0} must be a whole number between 0 and {1}; got {2}.',
};
