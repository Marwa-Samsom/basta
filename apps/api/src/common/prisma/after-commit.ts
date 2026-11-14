/**
 * «بعد أن تُثبَّت المعاملة» — لما يجب أن يقرأ ما كتبته المعاملة من خارجها (فهرس البحث).
 *
 * وحدة دنيا (المخزون) تكتب داخل معاملة يملكها مستدعيها (الطلبات، الدفع) ولا تعرف متى
 * تُثبَّت؛ ومزامنةٌ تجري قبل التثبيت تقرأ القيمة القديمة من اتصال آخر. فيسجّل `$transaction`
 * في PrismaService طابوراً لكل معاملة، ويُفرغه بعد نجاحها وحدها — والمعاملة المرتدّة لا يجري
 * لها شيء. خارج معاملة مسجّلة (العميل نفسه، أو عميل اختبار عادي) يجري فوراً.
 */
const pending = new WeakMap<object, (() => void)[]>();

export function afterCommit(tx: object, fn: () => void): void {
  const queue = pending.get(tx);
  if (queue) queue.push(fn);
  else fn();
}

type TransactionFn = (arg: unknown, options?: unknown) => Promise<unknown>;

/** يلفّ `$transaction` بصيغة الدالّة؛ صيغة المصفوفة تبقى كما هي (لا معاملة يُمرَّر عميلها لأحد) */
export function trackCommits(client: { $transaction: unknown }): void {
  const run = (client.$transaction as TransactionFn).bind(client);
  client.$transaction = (arg: unknown, options?: unknown) => {
    if (typeof arg !== 'function') return run(arg, options);
    const queue: (() => void)[] = [];
    return run((tx: object) => {
      pending.set(tx, queue);
      return (arg as (tx: object) => unknown)(tx);
    }, options).then((result) => {
      // ما بعد التثبيت لا يُسقط عملية ثُبّتت: المستمع يسجّل فشله بنفسه
      for (const fn of queue) {
        try {
          fn();
        } catch {
          /* لا شيء */
        }
      }
      return result;
    });
  };
}
