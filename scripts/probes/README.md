# مسابر القرار

سكربتان يثبتان قراري [ADR-014](../../docs/01-foundation/ADR.md): البحث على Meilisearch محمول،
والطوابير على PostgreSQL بلا Redis. ليسا اختبارَي انحدار — يُعاد تشغيلهما عند مراجعة القرار
أو الترقية، لا في كل بناء.

## البحث

```bash
# مرة واحدة: الملف التنفيذي المحمول (330 ميغابايت، خارج git مع .localdb/)
curl -sL -o .localdb/meili/meilisearch.exe \
  https://github.com/meilisearch/meilisearch/releases/download/v1.53.2/meilisearch-windows-amd64.exe

# تشغيل الخادم — المنفذ 7701 كي لا يزاحم شيئاً
.localdb/meili/meilisearch.exe --http-addr 127.0.0.1:7701 \
  --db-path .localdb/meili/data --master-key basta_local_dev_key_0001 --env development

node scripts/probes/meili-probe.mjs
```

يفهرس 10,002 منتجاً عربياً ويقيس: توحيد الهمزات (احمد/أحمد)، والشدّة (سماعة/سمّاعة)،
والتسامح الإملائي، والفلترة والترتيب، وزمن الاستجابة. البوابة تشترط أقل من 100 مللي ثانية.

**المفتاح أعلاه للتطوير المحلي وحده** ولا يصلح لأي بيئة أخرى.

## الطوابير

```bash
# القاعدة شغّالة أولاً، ثم:
npm i --no-save pg-boss pg
node scripts/probes/queue-probe.mjs
```

يثبت أربعة أشياء: الإرسال والاستهلاك، وإعادة المحاولة بعد الفشل، والجدولة الدورية،
و**الإدراج داخل معاملة قاعدة البيانات** — مهمة تتراجع مع معاملتها فلا تصل أبداً.
ينظّف مخطّط `queue_probe` بعد نفسه.
