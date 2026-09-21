import { Injectable, Logger } from '@nestjs/common';
import { MeiliClient } from '../infrastructure/meili.client';
import {
  buildFilter,
  buildSort,
  INDEX_SETTINGS,
  pageOf,
  type SearchDocument,
  type SearchInput,
} from '../domain/search-query';

export interface SearchHit {
  readonly id: string;
  readonly score: number;
}

export interface SearchResult {
  readonly ids: readonly string[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly tookMs: number;
  /** `db` تعني أن المحرّك لم يستجب وأن النتيجة جاءت من قاعدة البيانات */
  readonly engine: 'meili' | 'db';
  /**
   * عدد النتائج لكل قيمة وجه **على كل المطابقات** لا على الصفحة المعروضة.
   * القاعدة لا تستطيع حسابها للبحث المتسامح (لا تعرف أن «قمييص» تطابق
   * «قميص»)، فالمحرّك يحسبها بالمطابقة نفسها التي أعاد بها النتائج.
   */
  readonly facets: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/**
 * البحث والفهرسة — ADR-014.
 *
 * الوحدة تعيد **معرّفات** لا منتجات كاملة: الفهرس مشتقّ، وقاعدة البيانات
 * تبقى مصدر الحقيقة. لو أعاد الفهرس سعراً قديماً لظهر سعر قديم في المتجر،
 * فالسعر يُقرأ دائماً من القاعدة بعد أن يقول الفهرس «هؤلاء المرشّحون».
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger('Search');
  private ensured = false;

  constructor(private readonly meili: MeiliClient) {}

  // ------------------------------------------------------------- الفهرس

  /** يُنشئ الفهرس بإعداداته إن لم يكن موجوداً. يُستدعى قبل أول كتابة. */
  async ensureIndex(): Promise<void> {
    if (this.ensured) return;
    const uid = this.meili.index;
    try {
      await this.meili.request('POST', '/indexes', { uid, primaryKey: 'id' }, 3000).catch(() => undefined);
      await this.meili.request('PATCH', `/indexes/${uid}/settings`, INDEX_SETTINGS, 5000);
      this.ensured = true;
    } catch (err) {
      this.logger.warn(`تعذّر تهيئة الفهرس: ${(err as Error).message}`);
    }
  }

  /**
   * كتابة وثائق. **الفشل لا يُسقط العملية التجارية**: منتج نُشر ولم يُفهرس
   * يظهر بعد إعادة البناء، أما نشرٌ فشل لأن محرّك البحث نائم فخسارة مباشرة.
   */
  async upsert(documents: readonly SearchDocument[]): Promise<boolean> {
    if (documents.length === 0) return true;
    await this.ensureIndex();
    try {
      await this.meili.request('POST', `/indexes/${this.meili.index}/documents`, documents, 5000);
      return true;
    } catch (err) {
      this.logger.error(`تعذّرت فهرسة ${documents.length} منتجاً: ${(err as Error).message}`);
      return false;
    }
  }

  async remove(productIds: readonly string[]): Promise<boolean> {
    if (productIds.length === 0) return true;
    try {
      await this.meili.request(
        'POST',
        `/indexes/${this.meili.index}/documents/delete-batch`,
        productIds,
        5000,
      );
      return true;
    } catch (err) {
      this.logger.error(`تعذّر حذف ${productIds.length} من الفهرس: ${(err as Error).message}`);
      return false;
    }
  }

  /** إعادة بناء كاملة — تُستدعى من سكربت أو من لوحة الإدارة. */
  async reindex(documents: readonly SearchDocument[]): Promise<{ indexed: number }> {
    await this.ensureIndex();
    await this.meili.request('DELETE', `/indexes/${this.meili.index}/documents`, undefined, 10_000);
    await this.upsert(documents);
    return { indexed: documents.length };
  }

  /**
   * «حيّ» تُقرأ من فحص الصحّة لا من إحصاء الفهرس: محرّك شغّال بلا فهرس بعد
   * (أول إقلاع، أو بعد مسح) كان يُقرأ «متوقّفاً» فتُتخطّى الفهرسة الأولى
   * التي كانت ستُنشئه — حلقة لا تنكسر وحدها.
   */
  async stats(): Promise<{ documents: number; up: boolean }> {
    if (!(await this.meili.isUp())) return { documents: 0, up: false };
    try {
      const s = await this.meili.request<{ numberOfDocuments: number }>(
        'GET',
        `/indexes/${this.meili.index}/stats`,
        undefined,
        1000,
      );
      return { documents: s.numberOfDocuments, up: true };
    } catch {
      return { documents: 0, up: true };
    }
  }

  // -------------------------------------------------------------- البحث

  async search(input: SearchInput): Promise<SearchResult | null> {
    const { page, pageSize } = pageOf(input);
    const filter = buildFilter(input);
    const sort = buildSort(input.sort);

    try {
      const res = await this.meili.request<{
        hits: { id: string }[];
        estimatedTotalHits: number;
        processingTimeMs: number;
        facetDistribution?: Record<string, Record<string, number>>;
      }>(
        'POST',
        `/indexes/${this.meili.index}/search`,
        {
          q: input.q ?? '',
          offset: (page - 1) * pageSize,
          limit: pageSize,
          attributesToRetrieve: ['id'],
          facets: ['vendorId', 'brandId', 'attributeValueIds'],
          ...(filter.length > 0 ? { filter } : {}),
          ...(sort.length > 0 ? { sort } : {}),
        },
        1500,
      );

      return {
        ids: res.hits.map((h) => h.id),
        total: res.estimatedTotalHits,
        page,
        pageSize,
        tookMs: res.processingTimeMs,
        engine: 'meili',
        facets: res.facetDistribution ?? {},
      };
    } catch (err) {
      /**
       * **السقوط إلى قاعدة البيانات لا إلى صفحة خطأ.** المتجر الذي يتوقّف
       * لأن محرّك بحثه نائم يخسر بيعاً؛ ونتيجة أضعف تسامحاً تبقى نتيجة.
       * الطرف الآخر (الكتالوج) يقرأ `null` فيبحث في القاعدة.
       */
      this.logger.warn(`سقط البحث إلى قاعدة البيانات: ${(err as Error).message}`);
      return null;
    }
  }

  /** اقتراحات أثناء الكتابة — ST-06. أسماء لا منتجات كاملة. */
  async suggest(term: string, limit = 6): Promise<string[]> {
    if (term.trim().length < 2) return [];
    try {
      const res = await this.meili.request<{ hits: { nameAr: string }[] }>(
        'POST',
        `/indexes/${this.meili.index}/search`,
        { q: term, limit, attributesToRetrieve: ['nameAr'] },
        900,
      );
      return [...new Set(res.hits.map((h) => h.nameAr))];
    } catch {
      return [];
    }
  }
}
