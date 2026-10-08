# REST API to MySQL Data Pipeline

[![Python Version](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![Database](https://img.shields.io/badge/database-MySQL%208.0-orange.svg)](https://www.mysql.com/)
[![ETL Framework](https://img.shields.io/badge/ETL-pandas%20%7C%20SQLAlchemy-green.svg)](https://pandas.pydata.org/)
[![Tests](https://img.shields.io/badge/tests-pytest-purple.svg)](https://docs.pytest.org/)

A production-grade ETL data pipeline designed to ingest complex, nested e-commerce product catalog records from an external REST API, perform schema validation, flatten hierarchical JSON payloads, run comprehensive data quality checks, and load normalized records idempotently into a relational MySQL database.

---

## Architecture Overview

```text
┌────────────────────────┐
│  External REST API     │ (DummyJSON /products)
│  (Paginated Endpoints) │
└───────────┬────────────┘
            │  HTTP GET /products?limit=30&skip=0
            ▼
┌────────────────────────┐
│  Python API Client     │ (Session pooling, Exponential Backoff,
│  & Extractor           │  429 Retry-After, Timeout handling)
└───────────┬────────────┘
            │  Raw JSON Payload
            ▼
┌────────────────────────┐
│  Contract Validator    │ (Required field presence, type assertions,
│                        │  domain sanity, quarantine isolation)
└───────────┬────────────┘
            │  Validated Dictionaries
            ▼
┌────────────────────────┐
│  Pandas Transformation │ (JSON flattening, snake_case normalization,
│  & Normalization Engine│  deduplication, calculated pricing & stock metrics)
└───────────┬────────────┘
            │  5 Normalized DataFrames
            ▼
┌────────────────────────┐
│  Data Quality Checks   │ (Critical vs. Warning thresholds,
│  (Pre-Load Guardrails) │  null checks, uniqueness, domain boundaries)
└───────────┬────────────┘
            │  Clean Relational Records (Halt safely if critical fails)
            ▼
┌────────────────────────┐
│  MySQL Database Loader │ (SQLAlchemy + PyMySQL, Idempotent Upserts
│  (ecommerce_dw)        │  `ON DUPLICATE KEY UPDATE`, FK mapping)
└───────────┬────────────┘
            │
            ├──────────────────────────┬──────────────────────────┐
            ▼                          ▼                          ▼
┌────────────────────────┐ ┌────────────────────────┐ ┌────────────────────────┐
│ Normalized Schema      │ │ Post-Load SQL Audits   │ │ ETL Audit Log          │
│ • categories (1:N)     │ │ • Category Inventory   │ │ • Run telemetry        │
│ • brands (1:N)         │ │ • Stock Risk Analysis  │ │ • Row counts           │
│ • products (Core Fact) │ │ • Volumetric Density   │ │ • Duration & Status    │
│ • dimensions (1:1)     │ │                        │ │                        │
│ • reviews (1:N)        │ │                        │ │                        │
└────────────────────────┘ └────────────────────────┘ └────────────────────────┘
```

---

## Target API Selection & Rationale

This pipeline extracts records from the publicly accessible **DummyJSON Products API** (`https://dummyjson.com/products`).

### Why this API is appropriate for a Data Engineering project:
1. **Realistic Hierarchical Structures**: Responses contain a mix of scalar attributes (`id`, `title`, `price`), nested 1:1 objects (`dimensions: {width, height, depth}`), 1:N array collections (`reviews: [...]`), and multi-label tags (`tags: [...]`). This accurately mirrors production SaaS and e-commerce APIs that cannot be dumped into flat database tables without decomposition.
2. **Deterministic Pagination**: Implements offset-based pagination (`skip` and `limit`) with metadata headers (`total`, `skip`, `limit`), allowing rigorous testing of pagination loops and page boundary handling.
3. **Public Reliability & Free Availability**: Requires no secret API keys, enabling recruiters and interviewers to run the code locally in seconds without friction.
4. **Data Normalization Potential**: Enables breaking down single JSON documents into a 3rd Normal Form (3NF) relational star/snowflake schema with dimensions, foreign keys, and cascading relationships.

---

## Core Pipeline Components

### 1. Robust API Client (`src/api_client.py`)
- **Connection Reuse**: Uses `requests.Session` with a connection pool adapter to minimize TCP and TLS handshake overhead.
- **Retry Strategy with Exponential Backoff**: Uses `urllib3.util.Retry` configured with a 1.5 backoff factor across HTTP `429`, `500`, `502`, `503`, and `504` status codes.
- **Rate-Limit Handling**: Intercepts HTTP 429 Too Many Requests and parses the `Retry-After` header to avoid overwhelming the upstream provider.
- **Strict Timeouts & Exceptions**: Enforces a 15-second per-request timeout. Maps native exceptions into typed custom domain errors: `APITimeoutError`, `APIRateLimitError`, `APIResponseError`, and `APIMalformedJSONError`.

### 2. Paginated Extractor (`src/extract.py`)
- Traverses the API by incrementing `skip` by `limit` until `skip >= total` or an empty page is returned.
- Supports configurable batch sizes (`page_size`) and extraction limits (`max_records`), allowing rapid local smoke testing before full backfills.
- Tracks and logs cumulative extracted counts page-by-page.

### 3. Contract Validation (`src/validate.py`)
- Evaluates raw JSON dictionaries before passing them to memory-intensive pandas operations.
- Verifies required non-null fields (`id`, `title`, `price`, `category`).
- Quarantines corrupt or unparseable records to prevent pipeline crashes while maintaining an audit trail of dropped rows.

### 4. Transformation & Flattening (`src/transform.py`)
- **Schema Normalization**: Converts API `camelCase` keys to database-compliant `snake_case`.
- **Deduplication**: Removes duplicate records based on business primary key (`id`) and `sku`, retaining the latest occurrence.
- **Nested Object Flattening**:
  - Extracts `dimensions` (`width`, `height`, `depth`) into a 1:1 `product_dimensions` DataFrame and computes volumetric density (`volume_cm3 = width * height * depth`).
  - Normalizes `reviews` into a 1:N `product_reviews` DataFrame with validated ISO timestamps.
- **Derived Financial Metrics**:
  - Calculates `discounted_price = ROUND(price * (1 - discount_percentage / 100), 2)`.
  - Derives `stock_status` (`OUT_OF_STOCK` if stock $\le$ 0, `LOW_STOCK` if stock $\le$ 10, otherwise `IN_STOCK`).
- **Data Type Casting**: Strict casting to `float`, `int`, `string`, and `datetime` to avoid silent conversion errors downstream.

### 5. Automated Data Quality Guardrails (`src/quality_checks.py`)
Before loading any record into MySQL, an automated suite of checks executes against all transformed DataFrames:

| Check Name | Target Table | Severity | Condition |
| :--- | :--- | :--- | :--- |
| `min_record_count_products` | `products` | **CRITICAL** | `count >= 1` |
| `primary_key_uniqueness` | `products` | **CRITICAL** | `product_id` must have 0 duplicate values |
| `unique_sku_constraint` | `products` | **CRITICAL** | `sku` must have 0 duplicate values |
| `mandatory_fields_null_check` | `products` | **CRITICAL** | 0 nulls in mandatory columns |
| `price_positive_range` | `products` | **CRITICAL** | `price >= $0.01` |
| `rating_domain_bounds` | `products` | **WARNING** | `rating` between `0.0` and `5.0` |
| `category_referential_integrity` | `products` | **CRITICAL** | 0 orphan category codes |
| `dimensions_parent_consistency` | `dimensions` | **CRITICAL** | 0 orphan dimensions rows |

**Safe Failure Behavior**: If any **CRITICAL** check fails, the pipeline raises `CriticalDataQualityError` and immediately aborts before initiating any database transactions.

### 6. Idempotent Relational MySQL Loader (`src/load.py`)
- **Idempotency Guarantee**: Implements `INSERT ... ON DUPLICATE KEY UPDATE` across the `products` and `product_dimensions` tables. Re-running the pipeline multiple times safely updates changing attributes (e.g. stock, pricing, reviews) without generating duplicates or unique key collisions.
- **Dependency Resolution**: Ingests lookup dimension tables (`categories`, `brands`) first, retrieves generated surrogate primary keys, and maps foreign keys into child entities before execution.
- **Transaction Safety**: All batch operations execute inside context-managed transactions (`engine.begin()`), rolling back cleanly upon mid-batch execution exceptions.
- **ETL Audit Trail**: Persists operational metadata for each pipeline run into the `etl_audit_log` table (run ID, duration, status, row counts, DQ pass/fail tallies).

---

## Relational Database Schema

```sql
-- Core Fact/Entity: products
CREATE TABLE products (
    product_id INT PRIMARY KEY,
    sku VARCHAR(100) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category_id INT NOT NULL,
    brand_id INT NULL,
    price DECIMAL(10, 2) NOT NULL,
    discount_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    discounted_price DECIMAL(10, 2) NOT NULL,
    rating DECIMAL(3, 2) NOT NULL DEFAULT 0.00,
    stock INT NOT NULL DEFAULT 0,
    stock_status VARCHAR(30) NOT NULL,
    weight_grams DECIMAL(8, 2) NULL,
    warranty_information VARCHAR(255) NULL,
    shipping_information VARCHAR(255) NULL,
    availability_status VARCHAR(100) NULL,
    return_policy VARCHAR(255) NULL,
    minimum_order_quantity INT NOT NULL DEFAULT 1,
    barcode VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_prod_cat FOREIGN KEY (category_id) REFERENCES categories(category_id),
    CONSTRAINT fk_prod_brand FOREIGN KEY (brand_id) REFERENCES brands(brand_id)
);
```

Full DDL with `categories`, `brands`, `product_dimensions`, `product_reviews`, and `etl_audit_log` is available in [`sql/schema.sql`](sql/schema.sql).

---

## Repository Structure

```text
api-data-pipeline/
│
├── config/
│   ├── config.yaml               # Pipeline execution parameters, thresholds, and endpoints
│   └── .env.example              # Database credential template
│
├── sql/
│   ├── schema.sql                # Complete MySQL 8.0 DDL schema with constraints & indexes
│   └── analytical_queries.sql    # Validation and business analytics queries
│
├── src/
│   ├── __init__.py
│   ├── api_client.py             # HTTP client with session pooling and exponential backoff
│   ├── extract.py                # Paginated extraction and offset traversal
│   ├── validate.py               # Raw schema contract validation and quarantine logic
│   ├── transform.py              # Pandas normalization, flattening, and field derivation
│   ├── quality_checks.py         # Automated data quality validation framework
│   ├── load.py                   # Idempotent MySQL loader with ON DUPLICATE KEY UPDATE
│   ├── pipeline.py               # Main CLI orchestrator & execution lifecycle
│   └── utils/
│       ├── __init__.py
│       └── logger.py             # Formatted console and rotating file logger
│
├── tests/
│   ├── __init__.py
│   ├── test_api_client.py        # Mocks for 200, 429, 500, timeout, and corrupt JSON
│   ├── test_transform.py         # Unit tests for flattening and calculated metrics
│   └── test_quality_checks.py    # Unit tests for critical validation halts
│
├── logs/
│   └── .gitkeep                  # Preserves logging directory in git
│
├── docker-compose.yml            # Spins up local MySQL 8.0 & Adminer GUI in one command
├── requirements.txt              # Pinned Python package dependencies
├── .gitignore                    # Prevents credentials, logs, and venvs from being committed
└── README.md                     # Comprehensive technical documentation
```

---

## Quickstart & Local Setup

### Step 1: Clone Repository & Create Virtual Environment
```bash
git clone https://github.com/your-username/api-data-pipeline.git
cd api-data-pipeline

python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Step 2: Start Local MySQL Database
Use the provided `docker-compose.yml` to spin up MySQL 8.0 and automatically initialize the schema:
```bash
docker compose up -d
```
*MySQL will be accessible at `127.0.0.1:3306` (`user: etl_runner`, `password: etl_secure_password`).*  
*An optional Adminer database UI will be available at `http://localhost:8080`.*

### Step 3: Configure Environment Variables
```bash
cp config/.env.example .env
```
*(The default settings in `.env.example` already match the docker-compose environment).*

### Step 4: Run the Pipeline

**Standard Full Run:**
```bash
python -m src.pipeline
```

**Dry-Run Mode (Extract, Validate, Transform, and Test DQ without writing to DB):**
```bash
python -m src.pipeline --dry-run
```

**Custom Pagination & Record Limits:**
```bash
python -m src.pipeline --max-records 50 --page-size 25
```

### Step 5: Run the Test Suite
```bash
pytest tests/ -v
```

---

## Sample Execution Log Output

```text
2026-10-08 10:15:02 [INFO    ] [pipeline:__init__:42] ======================================================================
2026-10-08 10:15:02 [INFO    ] [pipeline:__init__:43] INITIALIZING ETL PIPELINE: ecommerce_product_catalog_etl
2026-10-08 10:15:02 [INFO    ] [pipeline:__init__:44] Run ID: run_20261008_101502_a9f14b | Dry Run Mode: False
2026-10-08 10:15:02 [INFO    ] [pipeline:__init__:45] ======================================================================
2026-10-08 10:15:02 [INFO    ] [pipeline:run:67] >>> STAGE 1: API EXTRACTION STARTING
2026-10-08 10:15:02 [INFO    ] [pipeline.api_client:__init__:65] APIClient initialized for https://dummyjson.com (timeout=15s, max_retries=3)
2026-10-08 10:15:02 [INFO    ] [pipeline.extract:extract_pages:45] Requesting Page 1: skip=0, limit=30
2026-10-08 10:15:03 [INFO    ] [pipeline.extract:extract_pages:56] Page 1 extracted successfully: 30 records received (cumulative: 30 / 120)
2026-10-08 10:15:03 [INFO    ] [pipeline.extract:extract_pages:45] Requesting Page 2: skip=30, limit=30
2026-10-08 10:15:03 [INFO    ] [pipeline.extract:extract_pages:56] Page 2 extracted successfully: 30 records received (cumulative: 60 / 120)
2026-10-08 10:15:03 [INFO    ] [pipeline.extract:extract_pages:45] Requesting Page 3: skip=60, limit=30
2026-10-08 10:15:04 [INFO    ] [pipeline.extract:extract_pages:56] Page 3 extracted successfully: 30 records received (cumulative: 90 / 120)
2026-10-08 10:15:04 [INFO    ] [pipeline.extract:extract_pages:45] Requesting Page 4: skip=90, limit=30
2026-10-08 10:15:04 [INFO    ] [pipeline.extract:extract_pages:56] Page 4 extracted successfully: 30 records received (cumulative: 120 / 120)
2026-10-08 10:15:04 [INFO    ] [pipeline:run:92] >>> STAGE 1 COMPLETE: Extracted 120 raw records from REST API.
2026-10-08 10:15:04 [INFO    ] [pipeline:run:98] >>> STAGE 2: RAW CONTRACT VALIDATION STARTING
2026-10-08 10:15:04 [INFO    ] [pipeline.validate:validate_batch:108] Contract validation finished: 120 valid records, 0 quarantined records
2026-10-08 10:15:04 [INFO    ] [pipeline:run:111] >>> STAGE 3: PANDAS DATA TRANSFORMATION STARTING
2026-10-08 10:15:04 [INFO    ] [pipeline.transform:transform:198] Transformation complete. Products: 120, Categories: 18, Brands: 64, Dimensions: 120, Reviews: 360
2026-10-08 10:15:04 [INFO    ] [pipeline:run:126] >>> STAGE 4: DATA QUALITY VALIDATION SUITE STARTING
2026-10-08 10:15:04 [INFO    ] [pipeline.quality_checks:record:68]   [PASSED] [products] min_record_count_products: Products count (120) meets threshold (1).
2026-10-08 10:15:04 [INFO    ] [pipeline.quality_checks:record:68]   [PASSED] [products] primary_key_uniqueness_product_id: All product_id values are strictly unique.
2026-10-08 10:15:04 [INFO    ] [pipeline.quality_checks:record:68]   [PASSED] [products] unique_sku_constraint: All SKU values are strictly unique.
2026-10-08 10:15:04 [INFO    ] [pipeline.quality_checks:record:68]   [PASSED] [products] mandatory_fields_null_check: Mandatory columns contain 0 null values.
2026-10-08 10:15:04 [INFO    ] [pipeline.quality_checks:record:68]   [PASSED] [products] price_positive_range: All prices exceed minimum threshold of $0.01.
2026-10-08 10:15:04 [INFO    ] [pipeline.quality_checks:record:68]   [PASSED] [products] rating_domain_bounds: All ratings fall within legitimate bounds [0.0, 5.0].
2026-10-08 10:15:04 [INFO    ] [pipeline.quality_checks:record:68]   [PASSED] [products] category_referential_integrity: All product category codes map successfully to category dimension.
2026-10-08 10:15:04 [INFO    ] [pipeline.quality_checks:record:68]   [PASSED] [product_dimensions] dimensions_parent_consistency: All dimension records correspond to active product IDs.
2026-10-08 10:15:04 [INFO    ] [pipeline:run:142] >>> STAGE 5: MYSQL IDEMPOTENT LOAD STARTING
2026-10-08 10:15:04 [INFO    ] [pipeline.load:load_categories:88] Syncing 18 categories...
2026-10-08 10:15:05 [INFO    ] [pipeline.load:load_brands:109] Syncing 64 brands...
2026-10-08 10:15:05 [INFO    ] [pipeline.load:load_products:162] Loading 120 products into MySQL (idempotent upsert)...
2026-10-08 10:15:05 [INFO    ] [pipeline.load:load_dimensions:198] Product dimensions synchronized successfully (120 records).
2026-10-08 10:15:05 [INFO    ] [pipeline.load:load_reviews:225] Product reviews loaded. Inserted new reviews: 360 (Evaluated: 360)
2026-10-08 10:15:05 [INFO    ] [pipeline.load:record_audit_log:255] ETL audit log entry recorded for run 'run_20261008_101502_a9f14b' (status=SUCCESS)
2026-10-08 10:15:05 [INFO    ] [pipeline:run:210] ======================================================================
2026-10-08 10:15:05 [INFO    ] [pipeline:run:211] PIPELINE EXECUTION SUMMARY
2026-10-08 10:15:05 [INFO    ] [pipeline:run:212] Run ID: run_20261008_101502_a9f14b
2026-10-08 10:15:05 [INFO    ] [pipeline:run:213] Status: SUCCESS
2026-10-08 10:15:05 [INFO    ] [pipeline:run:214] Execution Time: 3.42 seconds
2026-10-08 10:15:05 [INFO    ] [pipeline:run:215] Records Extracted: 120
2026-10-08 10:15:05 [INFO    ] [pipeline:run:216] Records Validated: 120
2026-10-08 10:15:05 [INFO    ] [pipeline:run:217] Records Transformed: 120
2026-10-08 10:15:05 [INFO    ] [pipeline:run:218] Records Loaded (Products): 120
2026-10-08 10:15:05 [INFO    ] [pipeline:run:219] Data Quality Checks Passed: 8 / Failed: 0
2026-10-08 10:15:05 [INFO    ] [pipeline:run:220] ======================================================================
```

---

## Analytical & Post-Load Verification SQL

After the pipeline runs, execute the queries in [`sql/analytical_queries.sql`](sql/analytical_queries.sql) to inspect the loaded data.

### Sample Query: Category Inventory Valuation
```sql
SELECT 
    c.category_name,
    COUNT(p.product_id) AS sku_count,
    SUM(p.stock) AS total_inventory_units,
    ROUND(AVG(p.price), 2) AS avg_retail_price,
    ROUND(SUM(p.discounted_price * p.stock), 2) AS discounted_inventory_value
FROM categories c
JOIN products p ON c.category_id = p.category_id
GROUP BY c.category_id, c.category_name
ORDER BY discounted_inventory_value DESC
LIMIT 5;
```

**Output:**
| category_name | sku_count | total_inventory_units | avg_retail_price | discounted_inventory_value |
| :--- | :--- | :--- | :--- | :--- |
| Smart phones | 12 | 580 | $689.50 | $341,200.40 |
| Laptops | 8 | 320 | $1,120.00 | $312,450.80 |
| Furniture | 15 | 450 | $349.99 | $135,120.00 |
| Fragrances | 10 | 620 | $78.50 | $42,100.50 |
| Beauty | 20 | 1,120 | $24.90 | $24,800.00 |

---

## Resume Bullets for Job Applications

- **Engineered an automated REST API to MySQL ETL pipeline in Python and pandas**, extracting nested JSON data across paginated endpoints with exponential backoff retries, request session pooling, and rate-limit handling.
- **Architected a 3NF relational database schema in MySQL with idempotent upsert loading (`ON DUPLICATE KEY UPDATE`)**, guaranteeing duplicate-free incremental syncs and maintaining referential integrity across 5 parent and child entities.
- **Implemented an automated pre-load data quality validation framework and structured rotating logging**, enforcing primary key uniqueness, non-null constraints, and range bounds to safely quarantine anomalous records before database ingestion.
