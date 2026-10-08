import {
  LogEntry,
  PipelineStage,
  RawProduct,
  TransformedProduct,
  TransformedCategory,
  TransformedBrand,
  TransformedDimension,
  TransformedReview,
  DQCheckResult,
  AuditRunRecord,
} from '../types/pipeline';

export type SimulationScenario = 'standard' | 'rate_limit_retry' | 'dq_critical_halt' | 'corrupt_json';

export interface PipelineExecutionResult {
  success: boolean;
  rawProducts: RawProduct[];
  transformedProducts: TransformedProduct[];
  categories: TransformedCategory[];
  brands: TransformedBrand[];
  dimensions: TransformedDimension[];
  reviews: TransformedReview[];
  dqResults: DQCheckResult[];
  auditRecord: AuditRunRecord;
}

export class PipelineEngine {
  private logListener?: (log: LogEntry) => void;
  private stageListener?: (stage: PipelineStage) => void;

  constructor(
    onLog?: (log: LogEntry) => void,
    onStageChange?: (stage: PipelineStage) => void
  ) {
    this.logListener = onLog;
    this.stageListener = onStageChange;
  }

  private emitLog(level: LogEntry['level'], logger: string, message: string) {
    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').slice(0, 19);
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: timeStr,
      level,
      logger,
      message,
    };
    if (this.logListener) {
      this.logListener(entry);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async execute(
    scenario: SimulationScenario = 'standard',
    maxRecordsLimit: number = 30
  ): Promise<PipelineExecutionResult> {
    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const startTime = performance.now();
    const startedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);

    this.emitLog('INFO', 'pipeline', '======================================================================');
    this.emitLog('INFO', 'pipeline', 'INITIALIZING ETL PIPELINE: ecommerce_product_catalog_etl');
    this.emitLog('INFO', 'pipeline', `Run ID: ${runId} | Scenario: ${scenario} | Target Records: ${maxRecordsLimit}`);
    this.emitLog('INFO', 'pipeline', '======================================================================');

    // -------------------------------------------------------------------------
    // STAGE 1: API Extraction
    // -------------------------------------------------------------------------
    this.stageListener?.('extracting');
    this.emitLog('INFO', 'pipeline', '>>> STAGE 1: API EXTRACTION STARTING');
    this.emitLog('INFO', 'pipeline.api_client', `APIClient initialized for https://dummyjson.com (timeout=15s, max_retries=3)`);

    await this.sleep(400);

    let rawProducts: RawProduct[] = [];

    if (scenario === 'rate_limit_retry') {
      this.emitLog('INFO', 'pipeline.extract', 'Requesting Page 1: skip=0, limit=30');
      await this.sleep(350);
      this.emitLog('WARNING', 'pipeline.api_client', 'Rate limit encountered (HTTP 429) on https://dummyjson.com/products. Server requested Retry-After: 2.0s');
      this.emitLog('INFO', 'pipeline.api_client', 'Backing off and applying jitter before retry attempt 1/3...');
      await this.sleep(900);
      this.emitLog('INFO', 'pipeline.api_client', 'Retry attempt 1 succeeded (HTTP 200 OK)');
    }

    if (scenario === 'corrupt_json') {
      this.emitLog('INFO', 'pipeline.extract', 'Requesting Page 1: skip=0, limit=30');
      await this.sleep(300);
      this.emitLog('ERROR', 'pipeline.api_client', 'Failed to parse JSON response: Expecting value: line 1 column 1 (char 0)');
      this.emitLog('CRITICAL', 'pipeline', 'PIPELINE HALTED BY REST API ERROR: Malformed JSON payload returned from endpoint.');
      this.stageListener?.('failed');
      throw new Error('APIMalformedJSONError: Response body is not valid JSON.');
    }

    // Try fetching from real DummyJSON API
    try {
      this.emitLog('INFO', 'pipeline.extract', `Fetching live batch: https://dummyjson.com/products?limit=${maxRecordsLimit}&skip=0`);
      const resp = await fetch(`https://dummyjson.com/products?limit=${maxRecordsLimit}&skip=0`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      rawProducts = data.products || [];
      this.emitLog('INFO', 'pipeline.extract', `Page 1 extracted successfully: ${rawProducts.length} records received (total reported: ${data.total || 194})`);
    } catch (fetchErr) {
      this.emitLog('WARNING', 'pipeline.extract', `Live fetch failed or CORS restricted (${fetchErr}). Using realistic embedded catalog payload.`);
      rawProducts = this.getFallbackRawProducts().slice(0, maxRecordsLimit);
      this.emitLog('INFO', 'pipeline.extract', `Loaded ${rawProducts.length} offline sample catalog records.`);
    }

    if (scenario === 'dq_critical_halt') {
      // Intentionally inject invalid data to demonstrate data quality guardrail
      this.emitLog('WARNING', 'pipeline.extract', '[SCENARIO INJECTION] Injecting negative prices and duplicate keys into test payload...');
      if (rawProducts.length > 2) {
        rawProducts[0].price = -49.99; // Negative price
        rawProducts[1].id = rawProducts[2].id; // Duplicate primary key
      }
    }

    this.emitLog('INFO', 'pipeline', `>>> STAGE 1 COMPLETE: Extracted ${rawProducts.length} raw records from REST API.`);
    await this.sleep(400);

    // -------------------------------------------------------------------------
    // STAGE 2: Raw Contract Validation
    // -------------------------------------------------------------------------
    this.stageListener?.('validating');
    this.emitLog('INFO', 'pipeline', '>>> STAGE 2: RAW CONTRACT VALIDATION STARTING');

    const validRawProducts: RawProduct[] = [];
    let quarantinedCount = 0;

    for (const item of rawProducts) {
      if (!item.id || !item.title || item.price === undefined || !item.category) {
        quarantinedCount++;
        this.emitLog('WARNING', 'pipeline.validate', `Record ${item.id || 'unknown'} quarantined: missing required scalar fields.`);
      } else {
        validRawProducts.push(item);
      }
    }

    this.emitLog('INFO', 'pipeline.validate', `Contract validation finished: ${validRawProducts.length} valid records, ${quarantinedCount} quarantined records.`);
    this.emitLog('INFO', 'pipeline', `>>> STAGE 2 COMPLETE: ${validRawProducts.length} / ${rawProducts.length} records passed schema contracts.`);
    await this.sleep(400);

    // -------------------------------------------------------------------------
    // STAGE 3: Pandas Data Transformation
    // -------------------------------------------------------------------------
    this.stageListener?.('transforming');
    this.emitLog('INFO', 'pipeline', '>>> STAGE 3: PANDAS DATA TRANSFORMATION STARTING');
    this.emitLog('INFO', 'pipeline.transform', `Normalizing and flattening ${validRawProducts.length} records...`);

    // Transform products & calculate derived metrics
    const transformedProducts: TransformedProduct[] = validRawProducts.map((p) => {
      const price = Number(p.price) || 0;
      const discount = Number(p.discountPercentage) || 0;
      const discountedPrice = Math.max(0, Math.round(price * (1 - discount / 100) * 100) / 100);
      const stock = Number(p.stock) || 0;
      const stockStatus: TransformedProduct['stock_status'] =
        stock <= 0 ? 'OUT_OF_STOCK' : stock <= 10 ? 'LOW_STOCK' : 'IN_STOCK';

      return {
        product_id: p.id,
        sku: p.sku || `SKU-${String(p.id).padStart(6, '0')}`,
        title: p.title || 'Untitled',
        description: p.description || '',
        category_code: (p.category || 'uncategorized').toLowerCase().trim(),
        brand_name: p.brand || null,
        price,
        discount_percentage: discount,
        discounted_price: discountedPrice,
        rating: Number(p.rating) || 0,
        stock,
        stock_status: stockStatus,
        weight_grams: p.weight || null,
        warranty_information: p.warrantyInformation || '1 year warranty',
        shipping_information: p.shippingInformation || 'Standard shipping',
        availability_status: p.availabilityStatus || 'In Stock',
        return_policy: p.returnPolicy || '30 days return',
        minimum_order_quantity: p.minimumOrderQuantity || 1,
        barcode: p.meta?.barcode || null,
      };
    });

    // Categories
    const categorySet = new Set<string>();
    transformedProducts.forEach((p) => categorySet.add(p.category_code));
    const categories: TransformedCategory[] = Array.from(categorySet).sort().map((code, idx) => ({
      category_id: idx + 1,
      category_code: code,
      category_name: code.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }));

    // Brands
    const brandSet = new Set<string>();
    transformedProducts.forEach((p) => {
      if (p.brand_name) brandSet.add(p.brand_name);
    });
    const brands: TransformedBrand[] = Array.from(brandSet).sort().map((b, idx) => ({
      brand_id: idx + 1,
      brand_name: b,
    }));

    // Dimensions
    const dimensions: TransformedDimension[] = validRawProducts.map((p) => {
      const w = Math.round(Number(p.dimensions?.width || 2.5) * 100) / 100;
      const h = Math.round(Number(p.dimensions?.height || 5.0) * 100) / 100;
      const d = Math.round(Number(p.dimensions?.depth || 2.5) * 100) / 100;
      return {
        product_id: p.id,
        width_cm: w,
        height_cm: h,
        depth_cm: d,
        volume_cm3: Math.round(w * h * d * 100) / 100,
      };
    });

    // Reviews
    const reviews: TransformedReview[] = [];
    validRawProducts.forEach((p) => {
      if (Array.isArray(p.reviews)) {
        p.reviews.forEach((r, idx) => {
          reviews.push({
            review_id: reviews.length + 1,
            product_id: p.id,
            reviewer_name: r.reviewerName || `User_${idx + 1}`,
            reviewer_email: r.reviewerEmail || `user${idx + 1}@example.com`,
            rating: Number(r.rating) || 5,
            comment: r.comment || 'Great product!',
            review_date: (r.date || new Date().toISOString()).slice(0, 19).replace('T', ' '),
          });
        });
      }
    });

    this.emitLog(
      'INFO',
      'pipeline.transform',
      `Transformation complete. Products: ${transformedProducts.length}, Categories: ${categories.length}, Brands: ${brands.length}, Dimensions: ${dimensions.length}, Reviews: ${reviews.length}`
    );
    this.emitLog('INFO', 'pipeline', '>>> STAGE 3 COMPLETE: Transformed into 5 relational tables.');
    await this.sleep(400);

    // -------------------------------------------------------------------------
    // STAGE 4: Automated Data Quality Checks
    // -------------------------------------------------------------------------
    this.stageListener?.('checking_dq');
    this.emitLog('INFO', 'pipeline', '>>> STAGE 4: DATA QUALITY VALIDATION SUITE STARTING');

    const dqResults: DQCheckResult[] = [];

    // Check 1: Record count
    const minCountPassed = transformedProducts.length >= 1;
    dqResults.push({
      check_name: 'min_record_count_products',
      target_table: 'products',
      severity: 'CRITICAL',
      status: minCountPassed ? 'PASSED' : 'FAILED',
      message: minCountPassed
        ? `Products count (${transformedProducts.length}) meets threshold (1).`
        : 'Zero records in transformed products table.',
      metrics: { row_count: transformedProducts.length },
    });

    // Check 2: PK Uniqueness
    const seenIds = new Set<number>();
    let duplicateIds = 0;
    for (const p of transformedProducts) {
      if (seenIds.has(p.product_id)) duplicateIds++;
      seenIds.add(p.product_id);
    }
    dqResults.push({
      check_name: 'primary_key_uniqueness_product_id',
      target_table: 'products',
      severity: 'CRITICAL',
      status: duplicateIds === 0 ? 'PASSED' : 'FAILED',
      message: duplicateIds === 0
        ? 'All product_id values are strictly unique.'
        : `Found ${duplicateIds} duplicate product_id values.`,
      metrics: { duplicate_ids: duplicateIds },
    });

    // Check 3: SKU Uniqueness
    const seenSkus = new Set<string>();
    let duplicateSkus = 0;
    for (const p of transformedProducts) {
      if (seenSkus.has(p.sku)) duplicateSkus++;
      seenSkus.add(p.sku);
    }
    dqResults.push({
      check_name: 'unique_sku_constraint',
      target_table: 'products',
      severity: 'CRITICAL',
      status: duplicateSkus === 0 ? 'PASSED' : 'FAILED',
      message: duplicateSkus === 0
        ? 'All SKU values are strictly unique.'
        : `Found ${duplicateSkus} duplicate SKU values.`,
      metrics: { duplicate_skus: duplicateSkus },
    });

    // Check 4: Mandatory null check
    let nullCount = 0;
    for (const p of transformedProducts) {
      if (!p.title || p.price === undefined || !p.category_code || !p.stock_status) {
        nullCount++;
      }
    }
    dqResults.push({
      check_name: 'mandatory_fields_null_check',
      target_table: 'products',
      severity: 'CRITICAL',
      status: nullCount === 0 ? 'PASSED' : 'FAILED',
      message: nullCount === 0
        ? 'Mandatory columns contain 0 null values.'
        : `Found ${nullCount} records with nulls in mandatory columns.`,
      metrics: { records_with_nulls: nullCount },
    });

    // Check 5: Price positive range
    const negativePrices = transformedProducts.filter((p) => p.price < 0.01).length;
    dqResults.push({
      check_name: 'price_positive_range',
      target_table: 'products',
      severity: 'CRITICAL',
      status: negativePrices === 0 ? 'PASSED' : 'FAILED',
      message: negativePrices === 0
        ? 'All prices exceed minimum threshold of $0.01.'
        : `Found ${negativePrices} products with negative or sub-$0.01 price.`,
      metrics: { invalid_prices: negativePrices },
    });

    // Check 6: Ratings bounds
    const outOfBoundsRatings = transformedProducts.filter((p) => p.rating < 0 || p.rating > 5).length;
    dqResults.push({
      check_name: 'rating_domain_bounds',
      target_table: 'products',
      severity: 'WARNING',
      status: outOfBoundsRatings === 0 ? 'PASSED' : 'FAILED',
      message: outOfBoundsRatings === 0
        ? 'All ratings fall within legitimate bounds [0.0, 5.0].'
        : `Found ${outOfBoundsRatings} ratings outside standard range.`,
      metrics: { invalid_ratings: outOfBoundsRatings },
    });

    // Check 7: Referential integrity
    const catCodes = new Set(categories.map((c) => c.category_code));
    const orphanCats = transformedProducts.filter((p) => !catCodes.has(p.category_code)).length;
    dqResults.push({
      check_name: 'category_referential_integrity',
      target_table: 'products',
      severity: 'CRITICAL',
      status: orphanCats === 0 ? 'PASSED' : 'FAILED',
      message: orphanCats === 0
        ? 'All product category codes map successfully to category dimension.'
        : `Found ${orphanCats} orphan category references.`,
      metrics: { orphan_categories: orphanCats },
    });

    // Check 8: Dimensions consistency
    const prodIds = new Set(transformedProducts.map((p) => p.product_id));
    const orphanDims = dimensions.filter((d) => !prodIds.has(d.product_id)).length;
    dqResults.push({
      check_name: 'dimensions_parent_consistency',
      target_table: 'product_dimensions',
      severity: 'CRITICAL',
      status: orphanDims === 0 ? 'PASSED' : 'FAILED',
      message: orphanDims === 0
        ? 'All dimension records correspond to active product IDs.'
        : `Found ${orphanDims} orphan dimensions rows.`,
      metrics: { orphan_dimensions: orphanDims },
    });

    let criticalFailures = 0;
    for (const r of dqResults) {
      if (r.status === 'PASSED') {
        this.emitLog('INFO', 'pipeline.quality_checks', `  [PASSED] [${r.target_table}] ${r.check_name}: ${r.message}`);
      } else if (r.severity === 'CRITICAL') {
        criticalFailures++;
        this.emitLog('ERROR', 'pipeline.quality_checks', `  [FAILED-CRITICAL] [${r.target_table}] ${r.check_name}: ${r.message}`);
      } else {
        this.emitLog('WARNING', 'pipeline.quality_checks', `  [FAILED-WARNING] [${r.target_table}] ${r.check_name}: ${r.message}`);
      }
    }

    if (criticalFailures > 0) {
      this.emitLog('CRITICAL', 'pipeline', `PIPELINE HALTED BY DATA QUALITY GUARDRAIL: ${criticalFailures} CRITICAL failure(s) detected. Aborting before database write.`);
      this.stageListener?.('failed');
      throw new Error(`CriticalDataQualityError: ${criticalFailures} critical checks failed.`);
    }

    this.emitLog('INFO', 'pipeline', `>>> STAGE 4 COMPLETE: 8 Quality Checks Evaluated (0 Critical Failures).`);
    await this.sleep(400);

    // -------------------------------------------------------------------------
    // STAGE 5: MySQL Database Load (Idempotent Upsert)
    // -------------------------------------------------------------------------
    this.stageListener?.('loading_db');
    this.emitLog('INFO', 'pipeline', '>>> STAGE 5: MYSQL IDEMPOTENT LOAD STARTING');
    this.emitLog('INFO', 'pipeline.load', `Connecting to MySQL 8.0 (ecommerce_dw) with pool pre-ping...`);
    await this.sleep(250);
    this.emitLog('INFO', 'pipeline.load', `Syncing ${categories.length} categories (ON DUPLICATE KEY UPDATE)...`);
    this.emitLog('INFO', 'pipeline.load', `Syncing ${brands.length} brands (ON DUPLICATE KEY UPDATE)...`);
    await this.sleep(300);
    this.emitLog('INFO', 'pipeline.load', `Executing batch upsert for ${transformedProducts.length} products...`);
    this.emitLog('INFO', 'pipeline.load', `Syncing ${dimensions.length} product dimensions (1:1 relation)...`);
    this.emitLog('INFO', 'pipeline.load', `Syncing ${reviews.length} product reviews (INSERT IGNORE)...`);
    await this.sleep(350);

    const durationSec = Math.round(((performance.now() - startTime) / 1000) * 100) / 100;
    const completedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const auditRecord: AuditRunRecord = {
      run_id: runId,
      pipeline_name: 'ecommerce_product_catalog_etl',
      status: 'SUCCESS',
      records_extracted: rawProducts.length,
      records_validated: validRawProducts.length,
      records_transformed: transformedProducts.length,
      records_inserted: transformedProducts.length,
      records_updated: 0,
      dq_passed_count: dqResults.filter((r) => r.status === 'PASSED').length,
      dq_failed_count: dqResults.filter((r) => r.status === 'FAILED').length,
      execution_duration_sec: durationSec,
      started_at: startedAt,
      completed_at: completedAt,
    };

    this.emitLog('INFO', 'pipeline.load', `ETL audit log entry recorded for run '${runId}' (status=SUCCESS)`);
    this.emitLog('INFO', 'pipeline', '======================================================================');
    this.emitLog('INFO', 'pipeline', 'PIPELINE EXECUTION SUMMARY');
    this.emitLog('INFO', 'pipeline', `Run ID: ${runId}`);
    this.emitLog('INFO', 'pipeline', `Status: SUCCESS`);
    this.emitLog('INFO', 'pipeline', `Execution Time: ${durationSec} seconds`);
    this.emitLog('INFO', 'pipeline', `Records Extracted: ${rawProducts.length}`);
    this.emitLog('INFO', 'pipeline', `Records Loaded: ${transformedProducts.length}`);
    this.emitLog('INFO', 'pipeline', `DQ Checks Passed: ${auditRecord.dq_passed_count} / ${dqResults.length}`);
    this.emitLog('INFO', 'pipeline', '======================================================================');

    this.stageListener?.('completed');

    return {
      success: true,
      rawProducts,
      transformedProducts,
      categories,
      brands,
      dimensions,
      reviews,
      dqResults,
      auditRecord,
    };
  }

  private getFallbackRawProducts(): RawProduct[] {
    return [
      {
        id: 1,
        title: 'Essence Mascara Lash Princess',
        description: 'The Essence Mascara Lash Princess is a popular mascara renowned for dramatic volume and curl.',
        category: 'beauty',
        price: 9.99,
        discountPercentage: 7.17,
        rating: 4.94,
        stock: 5,
        brand: 'Essence',
        sku: 'RCH45Q1A',
        weight: 120,
        dimensions: { width: 2.5, height: 10.0, depth: 2.5 },
        reviews: [
          { rating: 5, comment: 'Very happy with it!', date: '2024-05-23T08:56:21.618Z', reviewerName: 'Eleanor', reviewerEmail: 'eleanor@example.com' },
          { rating: 4, comment: 'Great product, subtle curl.', date: '2024-05-23T08:56:21.618Z', reviewerName: 'Lucas', reviewerEmail: 'lucas@example.com' }
        ],
        meta: { barcode: '9164035105688' },
        warrantyInformation: '1 month warranty',
        shippingInformation: 'Ships in 1 month',
        availabilityStatus: 'Low Stock',
        returnPolicy: '30 days return policy',
        minimumOrderQuantity: 24,
      },
      {
        id: 2,
        title: 'Eyeshadow Palette with Mirror',
        description: 'The Eyeshadow Palette offers 12 highly pigmented shades ranging from subtle neutrals to vibrant tones.',
        category: 'beauty',
        price: 19.99,
        discountPercentage: 5.5,
        rating: 3.28,
        stock: 44,
        brand: 'Glamour',
        sku: 'MVCFLL0V',
        weight: 180,
        dimensions: { width: 12.4, height: 8.2, depth: 1.5 },
        reviews: [
          { rating: 4, comment: 'Nice pigments!', date: '2024-05-23T08:56:21.618Z', reviewerName: 'Elena', reviewerEmail: 'elena@example.com' }
        ],
        meta: { barcode: '2817839095220' },
        warrantyInformation: '1 year warranty',
        shippingInformation: 'Ships in 2 weeks',
        availabilityStatus: 'In Stock',
        returnPolicy: 'No return policy',
        minimumOrderQuantity: 32,
      },
      {
        id: 3,
        title: 'Powder Canister Flawless Finish',
        description: 'Finely milled translucent powder designed to set makeup, minimize shine, and soften pores.',
        category: 'beauty',
        price: 14.99,
        discountPercentage: 18.14,
        rating: 3.82,
        stock: 59,
        brand: 'Velvet Touch',
        sku: '98Y128DP',
        weight: 85,
        dimensions: { width: 6.8, height: 6.8, depth: 3.2 },
        reviews: [
          { rating: 5, comment: 'Very smooth powder.', date: '2024-05-23T08:56:21.618Z', reviewerName: 'Sophia', reviewerEmail: 'sophia@example.com' }
        ],
        meta: { barcode: '0516267972044' },
        warrantyInformation: 'No warranty',
        shippingInformation: 'Ships overnight',
        availabilityStatus: 'In Stock',
        returnPolicy: '60 days return policy',
        minimumOrderQuantity: 25,
      },
      {
        id: 4,
        title: 'Red Lipstick Velvet Matte',
        description: 'Long-lasting hydrating red lipstick with a velvety matte finish.',
        category: 'beauty',
        price: 12.99,
        discountPercentage: 19.03,
        rating: 2.51,
        stock: 68,
        brand: 'Chic Co',
        sku: 'O5IF1N0P',
        weight: 35,
        dimensions: { width: 2.0, height: 7.5, depth: 2.0 },
        reviews: [
          { rating: 2, comment: 'A bit drying on lips.', date: '2024-05-23T08:56:21.618Z', reviewerName: 'Chloe', reviewerEmail: 'chloe@example.com' }
        ],
        meta: { barcode: '9444582199406' },
        warrantyInformation: 'Lifetime warranty',
        shippingInformation: 'Ships in 2 weeks',
        availabilityStatus: 'In Stock',
        returnPolicy: '90 days return policy',
        minimumOrderQuantity: 40,
      },
      {
        id: 5,
        title: 'Red Nail Polish Glossy Quick-Dry',
        description: 'Rich vibrant red nail polish with quick-dry technology and high gloss durability.',
        category: 'beauty',
        price: 8.99,
        discountPercentage: 2.46,
        rating: 3.91,
        stock: 71,
        brand: 'NailPro',
        sku: 'W75005P7',
        weight: 50,
        dimensions: { width: 3.0, height: 6.0, depth: 3.0 },
        reviews: [
          { rating: 4, comment: 'Dries fast as promised.', date: '2024-05-23T08:56:21.618Z', reviewerName: 'Ava', reviewerEmail: 'ava@example.com' }
        ],
        meta: { barcode: '3212847602441' },
        warrantyInformation: '1 year warranty',
        shippingInformation: 'Ships in 1 week',
        availabilityStatus: 'In Stock',
        returnPolicy: 'No return policy',
        minimumOrderQuantity: 46,
      },
      {
        id: 6,
        title: 'Calvin Klein CK One EDT',
        description: 'Classic iconic unisex fragrance featuring refreshing citrus and green notes.',
        category: 'fragrances',
        price: 49.99,
        discountPercentage: 0.32,
        rating: 4.85,
        stock: 17,
        brand: 'Calvin Klein',
        sku: 'CK-ONE-100',
        weight: 300,
        dimensions: { width: 8.0, height: 16.0, depth: 4.5 },
        reviews: [
          { rating: 5, comment: 'Timeless scent, lasts all day.', date: '2024-05-23T08:56:21.618Z', reviewerName: 'Marcus', reviewerEmail: 'marcus@example.com' }
        ],
        meta: { barcode: '1029384756102' },
        warrantyInformation: 'Authenticity guaranteed',
        shippingInformation: 'Ships in 3 days',
        availabilityStatus: 'In Stock',
        returnPolicy: '14 days return policy',
        minimumOrderQuantity: 1,
      },
    ];
  }
}
