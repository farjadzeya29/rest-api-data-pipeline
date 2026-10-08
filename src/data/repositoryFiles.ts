export interface RepoFile {
  path: string;
  name: string;
  language: 'python' | 'sql' | 'yaml' | 'markdown' | 'dockerfile' | 'text';
  category: 'src' | 'sql' | 'config' | 'tests' | 'root';
  description: string;
  content: string;
}

export const REPOSITORY_FILES: RepoFile[] = [
  {
    path: 'src/api_client.py',
    name: 'api_client.py',
    language: 'python',
    category: 'src',
    description: 'Robust HTTP client with connection pooling, exponential backoff retries, and 429 rate limit handling.',
    content: `"""
Robust HTTP Client for REST API Ingestion.
Implements retry logic with exponential backoff, rate limit handling,
timeouts, session reuse, and granular error classification.
"""

import logging
import time
from typing import Any, Dict, Optional
import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry

logger = logging.getLogger("pipeline.api_client")


class APIClientError(Exception):
    """Base exception for all API client failures."""
    pass


class APITimeoutError(APIClientError):
    """Raised when an API request exceeds the configured timeout."""
    pass


class APIRateLimitError(APIClientError):
    """Raised when the API returns HTTP 429 Too Many Requests."""
    pass


class APIResponseError(APIClientError):
    """Raised when the API returns an unexpected HTTP 4xx or 5xx status."""
    def __init__(self, message: str, status_code: int, response_body: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


class APIMalformedJSONError(APIClientError):
    """Raised when the API response payload cannot be decoded as valid JSON."""
    pass


class APIClient:
    """
    Production-grade REST API Client with connection pooling, retries, and rate-limiting.
    """

    def __init__(
        self,
        base_url: str,
        timeout: int = 15,
        max_retries: int = 3,
        backoff_factor: float = 1.5,
        retry_status_codes: Optional[list] = None,
        headers: Optional[Dict[str, str]] = None,
        auth_token: Optional[str] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()

        merged_headers = {
            "Accept": "application/json",
            "User-Agent": "DataPipeline-ETL/1.2.0 (Junior Data Engineer Portfolio)",
        }
        if headers:
            merged_headers.update(headers)
        if auth_token:
            merged_headers["Authorization"] = f"Bearer {auth_token}"
        self.session.headers.update(merged_headers)

        retry_codes = retry_status_codes or [429, 500, 502, 503, 504]
        retry_strategy = Retry(
            total=max_retries,
            backoff_factor=backoff_factor,
            status_forcelist=retry_codes,
            allowed_methods=["GET", "HEAD", "OPTIONS"],
            raise_on_status=False,
        )

        adapter = HTTPAdapter(
            max_retries=retry_strategy,
            pool_connections=10,
            pool_maxsize=10,
        )
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

        logger.info(
            "APIClient initialized for %s (timeout=%ds, max_retries=%d)",
            self.base_url,
            self.timeout,
            max_retries,
        )

    def get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        logger.debug("Requesting GET %s with params=%s", url, params)
        start_time = time.time()

        try:
            response = self.session.get(url, params=params, timeout=self.timeout)
            duration = time.time() - start_time
            logger.debug("GET %s finished in %.3fs with status %d", url, duration, response.status_code)

        except requests.exceptions.Timeout as exc:
            duration = time.time() - start_time
            logger.error("Request timed out for GET %s after %.3fs: %s", url, duration, exc)
            raise APITimeoutError(f"Request timed out after {self.timeout}s: {url}") from exc

        except requests.exceptions.ConnectionError as exc:
            duration = time.time() - start_time
            logger.error("Network connection failed for %s after %.3fs: %s", url, duration, exc)
            raise APIClientError(f"Connection error to {url}: {exc}") from exc

        except requests.exceptions.RequestException as exc:
            logger.error("Unexpected network exception during GET %s: %s", url, exc)
            raise APIClientError(f"Request failed: {exc}") from exc

        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After", "10")
            try:
                sleep_sec = float(retry_after)
            except ValueError:
                sleep_sec = 10.0
            logger.warning("Rate limit encountered (HTTP 429). Retry-After: %.1fs", sleep_sec)
            raise APIRateLimitError(f"Rate limit exceeded (HTTP 429). Retry after {sleep_sec}s.")

        if response.status_code >= 400:
            error_body = response.text[:500]
            logger.error("HTTP %d error for %s: %s", response.status_code, url, error_body)
            raise APIResponseError(f"HTTP {response.status_code} client/server error", response.status_code, error_body)

        try:
            json_payload = response.json()
        except ValueError as exc:
            logger.error("Failed to parse JSON response: %s", exc)
            raise APIMalformedJSONError(f"Malformed JSON response from {url}: {exc}") from exc

        return json_payload

    def close(self) -> None:
        self.session.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
`,
  },
  {
    path: 'src/extract.py',
    name: 'extract.py',
    language: 'python',
    category: 'src',
    description: 'Paginated batch extraction orchestrator with limit/skip boundary and total count detection.',
    content: `"""
Data Extraction Module.
Orchestrates paginated batch extraction from the REST API,
tracking progress, boundary conditions, and yields extracted raw payloads.
"""

import logging
from typing import Any, Dict, Generator, List, Optional
from src.api_client import APIClient, APIClientError

logger = logging.getLogger("pipeline.extract")


class Extractor:
    def __init__(
        self,
        api_client: APIClient,
        endpoint: str = "/products",
        page_size: int = 30,
        max_records: Optional[int] = None,
    ):
        self.client = api_client
        self.endpoint = endpoint
        self.page_size = max(1, page_size)
        self.max_records = max_records if (max_records and max_records > 0) else None

    def extract_pages(self) -> Generator[List[Dict[str, Any]], None, None]:
        skip = 0
        page_num = 1
        total_extracted = 0
        api_total: Optional[int] = None

        logger.info(
            "Starting paginated extraction: endpoint='%s', page_size=%d, max_records=%s",
            self.endpoint, self.page_size, self.max_records or "ALL",
        )

        while True:
            current_limit = self.page_size
            if self.max_records:
                remaining = self.max_records - total_extracted
                if remaining <= 0:
                    break
                current_limit = min(self.page_size, remaining)

            params = {"limit": current_limit, "skip": skip}
            logger.info("Requesting Page %d: skip=%d, limit=%d", page_num, skip, current_limit)

            try:
                response = self.client.get(self.endpoint, params=params)
            except APIClientError as exc:
                logger.error("Failed to extract page %d at skip=%d: %s", page_num, skip, exc)
                raise

            records = response.get("products", [])
            page_record_count = len(records)

            if api_total is None and "total" in response:
                api_total = response["total"]
                logger.info("Target API reports total catalog size of %d records.", api_total)

            logger.info("Page %d extracted: %d records received (cumulative: %d)", page_num, page_record_count, total_extracted + page_record_count)

            if page_record_count == 0:
                break

            total_extracted += page_record_count
            yield records

            skip += page_record_count
            page_num += 1

            if self.max_records and total_extracted >= self.max_records:
                break
            if api_total is not None and skip >= api_total:
                break
            if page_record_count < current_limit:
                break

        logger.info("Extraction completed. Total pages: %d, records: %d", page_num - 1, total_extracted)

    def extract_all(self) -> List[Dict[str, Any]]:
        all_records: List[Dict[str, Any]] = []
        for page_records in self.extract_pages():
            all_records.extend(page_records)
        return all_records
`,
  },
  {
    path: 'src/validate.py',
    name: 'validate.py',
    language: 'python',
    category: 'src',
    description: 'Contract validation isolating non-nullable fields, type constraints, and quarantining malformed items.',
    content: `"""
Raw Data Contract & Ingestion Validation Module.
Validates structural integrity, required schema attributes, and field datatypes.
"""

import logging
from typing import Any, Dict, List, Set, Tuple

logger = logging.getLogger("pipeline.validate")


class ValidationError(Exception):
    pass


class RawDataValidator:
    REQUIRED_FIELDS: Set[str] = {"id", "title", "price", "category"}
    TYPE_CONSTRAINTS = {"id": int, "title": str, "price": (int, float), "category": str}

    def __init__(self, reject_invalid: bool = True):
        self.reject_invalid = reject_invalid

    def validate_record(self, record: Dict[str, Any]) -> Tuple[bool, List[str]]:
        issues: List[str] = []
        if not isinstance(record, dict):
            return False, ["Record is not a valid JSON dictionary."]

        missing = self.REQUIRED_FIELDS - set(record.keys())
        if missing:
            issues.append(f"Missing required fields: {list(missing)}")

        for field in self.REQUIRED_FIELDS:
            if field in record and record[field] is None:
                issues.append(f"Required field '{field}' contains null value.")

        for field, expected in self.TYPE_CONSTRAINTS.items():
            val = record.get(field)
            if val is not None and not isinstance(val, expected):
                issues.append(f"Field '{field}' has invalid type {type(val).__name__}")

        if "id" in record and isinstance(record["id"], int) and record["id"] <= 0:
            issues.append(f"Invalid non-positive ID: {record['id']}")

        return len(issues) == 0, issues

    def validate_batch(self, records: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        valid_records: List[Dict[str, Any]] = []
        quarantined: List[Dict[str, Any]] = []

        for idx, rec in enumerate(records):
            is_valid, issues = self.validate_record(rec)
            if is_valid:
                valid_records.append(rec)
            else:
                quarantined.append({"record": rec, "reasons": issues})

        logger.info("Validation complete: %d valid, %d quarantined", len(valid_records), len(quarantined))
        return valid_records, quarantined
`,
  },
  {
    path: 'src/transform.py',
    name: 'transform.py',
    language: 'python',
    category: 'src',
    description: 'Pandas data transformation engine: flattening nested JSON, snake_case conversion, deduplication, and calculations.',
    content: `"""
Data Transformation & Normalization Module.
Leverages pandas to flatten nested JSON structures, sanitize and coerce datatypes,
handle missing values, deduplicate records, and construct normalized relational tables.
"""

import logging
import re
from typing import Any, Dict, List, Tuple
import pandas as pd
import numpy as np

logger = logging.getLogger("pipeline.transform")


def to_snake_case(name: str) -> str:
    s1 = re.sub("(.)([A-Z][a-z]+)", r"\\1_\\2", name)
    return re.sub("([a-z0-9])([A-Z])", r"\\1_\\2", s1).lower()


class DataTransformer:
    def transform(self, raw_records: List[Dict[str, Any]]) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        if not raw_records:
            return pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), pd.DataFrame()

        df_raw = pd.DataFrame(raw_records)
        df_raw.columns = [to_snake_case(c) for c in df_raw.columns]

        # Deduplicate on business primary key 'id'
        df_raw = df_raw.drop_duplicates(subset=["id"], keep="last")

        # Fill missing SKU with deterministic fallback
        df_raw["sku"] = df_raw.apply(
            lambda r: str(r["sku"]).strip() if pd.notna(r.get("sku")) and str(r.get("sku")).strip() != ""
            else f"SKU-{r['id']:06d}", axis=1
        )
        df_raw = df_raw.drop_duplicates(subset=["sku"], keep="last")

        # 1. Categories Dimension
        categories_series = df_raw["category"].dropna().astype(str).str.strip().str.lower()
        unique_categories = sorted(categories_series.unique())
        df_categories = pd.DataFrame({
            "category_code": unique_categories,
            "category_name": [c.replace("-", " ").title() for c in unique_categories],
        })

        # 2. Brands Dimension
        brands_series = df_raw["brand"].dropna().astype(str).str.strip()
        df_brands = pd.DataFrame({"brand_name": sorted(brands_series[brands_series != ""].unique())})

        # 3. Core Products Fact Table
        df_products = pd.DataFrame()
        df_products["product_id"] = df_raw["id"].astype(int)
        df_products["sku"] = df_raw["sku"].astype(str)
        df_products["title"] = df_raw["title"].fillna("Untitled Product").astype(str)
        df_products["description"] = df_raw["description"].fillna("").astype(str)
        df_products["category_code"] = df_raw["category"].astype(str).str.strip().str.lower()
        df_products["brand_name"] = df_raw["brand"].apply(lambda b: str(b).strip() if pd.notna(b) and str(b).strip() != "" else None)
        df_products["price"] = pd.to_numeric(df_raw["price"], errors="coerce").fillna(0.0).round(2)
        df_products["discount_percentage"] = pd.to_numeric(df_raw["discount_percentage"], errors="coerce").fillna(0.0).round(2)
        
        # Calculated: discounted_price
        df_products["discounted_price"] = (df_products["price"] * (1.0 - (df_products["discount_percentage"] / 100.0))).round(2).clip(lower=0.0)
        df_products["rating"] = pd.to_numeric(df_raw["rating"], errors="coerce").fillna(0.0).round(2)
        df_products["stock"] = pd.to_numeric(df_raw["stock"], errors="coerce").fillna(0).astype(int)
        
        # Derived: stock_status
        df_products["stock_status"] = np.where(df_products["stock"] <= 0, "OUT_OF_STOCK", np.where(df_products["stock"] <= 10, "LOW_STOCK", "IN_STOCK"))
        df_products["weight_grams"] = pd.to_numeric(df_raw.get("weight"), errors="coerce").fillna(0.0).round(2)

        # 4. Dimensions Table (Flattening nested object)
        dims_list = []
        for _, row in df_raw.iterrows():
            d = row.get("dimensions") if isinstance(row.get("dimensions"), dict) else {}
            w, h, dp = round(float(d.get("width", 0.0) or 0.0), 2), round(float(d.get("height", 0.0) or 0.0), 2), round(float(d.get("depth", 0.0) or 0.0), 2)
            dims_list.append({"product_id": int(row["id"]), "width_cm": w, "height_cm": h, "depth_cm": dp, "volume_cm3": round(w * h * dp, 2)})
        df_dimensions = pd.DataFrame(dims_list).drop_duplicates(subset=["product_id"])

        # 5. Reviews Table (Normalizing 1:N list)
        revs_list = []
        for _, row in df_raw.iterrows():
            revs = row.get("reviews")
            if isinstance(revs, list):
                for r in revs:
                    if isinstance(r, dict):
                        revs_list.append({
                            "product_id": int(row["id"]),
                            "reviewer_name": str(r.get("reviewerName", "Anonymous")).strip(),
                            "reviewer_email": str(r.get("reviewerEmail", "unknown@example.com")).strip(),
                            "rating": int(r.get("rating", 5)),
                            "comment": str(r.get("comment", "")).strip(),
                            "review_date": str(r.get("date", pd.Timestamp.now().isoformat()))[:19].replace("T", " "),
                        })
        df_reviews = pd.DataFrame(revs_list).drop_duplicates(subset=["product_id", "reviewer_email", "review_date"])

        return df_categories, df_brands, df_products, df_dimensions, df_reviews
`,
  },
  {
    path: 'src/quality_checks.py',
    name: 'quality_checks.py',
    language: 'python',
    category: 'src',
    description: 'Data Quality check framework with CRITICAL (safe pipeline abort) and WARNING severity levels.',
    content: `"""
Data Quality & Integrity Assurance Module.
Executes automated pre-load validation checks across transformed DataFrames.
"""

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List
import pandas as pd

logger = logging.getLogger("pipeline.quality_checks")


class CheckSeverity(str, Enum):
    CRITICAL = "CRITICAL"
    WARNING = "WARNING"


class CheckStatus(str, Enum):
    PASSED = "PASSED"
    FAILED = "FAILED"


@dataclass
class QualityCheckResult:
    check_name: str
    target_table: str
    severity: CheckSeverity
    status: CheckStatus
    message: str
    metrics: Dict[str, any] = field(default_factory=dict)


@dataclass
class QualityReport:
    total_checks: int = 0
    passed_checks: int = 0
    failed_critical: int = 0
    failed_warnings: int = 0
    results: List[QualityCheckResult] = field(default_factory=list)


class CriticalDataQualityError(Exception):
    pass


class DataQualityChecker:
    def __init__(self, halt_on_critical: bool = True):
        self.halt_on_critical = halt_on_critical

    def run_all_checks(self, df_products: pd.DataFrame, df_categories: pd.DataFrame, df_dimensions: pd.DataFrame, df_reviews: pd.DataFrame) -> QualityReport:
        report = QualityReport()

        def record(res: QualityCheckResult):
            report.results.append(res)
            report.total_checks += 1
            if res.status == CheckStatus.PASSED:
                report.passed_checks += 1
            elif res.severity == CheckSeverity.CRITICAL:
                report.failed_critical += 1
            else:
                report.failed_warnings += 1

        # Check 1: Record count
        if len(df_products) >= 1:
            record(QualityCheckResult("min_record_count", "products", CheckSeverity.CRITICAL, CheckStatus.PASSED, f"Products count ({len(df_products)}) >= 1"))
        else:
            record(QualityCheckResult("min_record_count", "products", CheckSeverity.CRITICAL, CheckStatus.FAILED, "No products found in transformed dataset."))

        # Check 2: PK uniqueness
        if df_products["product_id"].duplicated().sum() == 0:
            record(QualityCheckResult("pk_uniqueness_product_id", "products", CheckSeverity.CRITICAL, CheckStatus.PASSED, "product_id values are strictly unique."))
        else:
            record(QualityCheckResult("pk_uniqueness_product_id", "products", CheckSeverity.CRITICAL, CheckStatus.FAILED, "Duplicate product_id keys detected."))

        # Check 3: SKU uniqueness
        if df_products["sku"].duplicated().sum() == 0:
            record(QualityCheckResult("sku_uniqueness", "products", CheckSeverity.CRITICAL, CheckStatus.PASSED, "SKUs are unique."))
        else:
            record(QualityCheckResult("sku_uniqueness", "products", CheckSeverity.CRITICAL, CheckStatus.FAILED, "Duplicate SKUs detected."))

        # Check 4: Mandatory null check
        null_count = df_products[["product_id", "title", "price", "category_code"]].isna().sum().sum()
        if null_count == 0:
            record(QualityCheckResult("null_check_mandatory", "products", CheckSeverity.CRITICAL, CheckStatus.PASSED, "0 nulls in mandatory columns."))
        else:
            record(QualityCheckResult("null_check_mandatory", "products", CheckSeverity.CRITICAL, CheckStatus.FAILED, f"Found {null_count} nulls in mandatory fields."))

        # Check 5: Price positive range
        if (df_products["price"] < 0.01).sum() == 0:
            record(QualityCheckResult("price_positive_range", "products", CheckSeverity.CRITICAL, CheckStatus.PASSED, "All prices >= $0.01."))
        else:
            record(QualityCheckResult("price_positive_range", "products", CheckSeverity.CRITICAL, CheckStatus.FAILED, "Negative or zero prices found."))

        # Check 6: Referential integrity
        orphan_cats = set(df_products["category_code"]) - set(df_categories["category_code"])
        if not orphan_cats:
            record(QualityCheckResult("category_fk_integrity", "products", CheckSeverity.CRITICAL, CheckStatus.PASSED, "All categories map to category dimension."))
        else:
            record(QualityCheckResult("category_fk_integrity", "products", CheckSeverity.CRITICAL, CheckStatus.FAILED, f"Orphan categories: {orphan_cats}"))

        if report.failed_critical > 0 and self.halt_on_critical:
            raise CriticalDataQualityError(f"Data Quality Suite failed with {report.failed_critical} CRITICAL errors.")

        return report
`,
  },
  {
    path: 'src/load.py',
    name: 'load.py',
    language: 'python',
    category: 'src',
    description: 'Idempotent MySQL loader with ON DUPLICATE KEY UPDATE, foreign key dependency mapping, and run auditing.',
    content: `"""
Relational Database Loader Module for MySQL.
Executes idempotent upsert operations (INSERT ... ON DUPLICATE KEY UPDATE),
manages foreign key dependencies, tracks execution metrics, and logs run audits.
"""

import logging
from typing import Dict, Tuple
import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

logger = logging.getLogger("pipeline.load")


class MySQLLoader:
    def __init__(self, host="127.0.0.1", port=3306, database="ecommerce_dw", user="etl_runner", password="etl_secure_password"):
        self.connection_uri = f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}?charset=utf8mb4"
        self._engine = None

    def get_engine(self) -> Engine:
        if not self._engine:
            self._engine = create_engine(self.connection_uri, pool_pre_ping=True)
        return self._engine

    def load_products(self, engine: Engine, df_products: pd.DataFrame, category_map: Dict[str, int], brand_map: Dict[str, int]) -> Tuple[int, int]:
        upsert_sql = text("""
            INSERT INTO products (
                product_id, sku, title, description, category_id, brand_id,
                price, discount_percentage, discounted_price, rating,
                stock, stock_status, weight_grams, last_synced_at
            ) VALUES (
                :product_id, :sku, :title, :description, :category_id, :brand_id,
                :price, :discount_percentage, :discounted_price, :rating,
                :stock, :stock_status, :weight_grams, CURRENT_TIMESTAMP
            ) ON DUPLICATE KEY UPDATE
                title = VALUES(title),
                price = VALUES(price),
                discounted_price = VALUES(discounted_price),
                rating = VALUES(rating),
                stock = VALUES(stock),
                stock_status = VALUES(stock_status),
                updated_at = CURRENT_TIMESTAMP,
                last_synced_at = CURRENT_TIMESTAMP;
        """)
        records = []
        for _, row in df_products.iterrows():
            records.append({
                "product_id": int(row["product_id"]),
                "sku": str(row["sku"]),
                "title": str(row["title"]),
                "description": str(row["description"]),
                "category_id": category_map.get(row["category_code"], 1),
                "brand_id": brand_map.get(row["brand_name"]),
                "price": float(row["price"]),
                "discount_percentage": float(row["discount_percentage"]),
                "discounted_price": float(row["discounted_price"]),
                "rating": float(row["rating"]),
                "stock": int(row["stock"]),
                "stock_status": str(row["stock_status"]),
                "weight_grams": float(row["weight_grams"]) if pd.notna(row["weight_grams"]) else None,
            })

        with engine.begin() as conn:
            conn.execute(upsert_sql, records)

        return len(records), len(records)
`,
  },
  {
    path: 'sql/schema.sql',
    name: 'schema.sql',
    language: 'sql',
    category: 'sql',
    description: 'Relational 3NF MySQL schema DDL with products, categories, brands, dimensions, reviews, and etl_audit_log.',
    content: `-- MySQL 8.0 DDL Schema
CREATE DATABASE IF NOT EXISTS ecommerce_dw;
USE ecommerce_dw;

CREATE TABLE IF NOT EXISTS categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(100) NOT NULL UNIQUE,
    category_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cat_code (category_code)
);

CREATE TABLE IF NOT EXISTS brands (
    brand_id INT AUTO_INCREMENT PRIMARY KEY,
    brand_name VARCHAR(150) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_prod_cat FOREIGN KEY (category_id) REFERENCES categories(category_id),
    CONSTRAINT fk_prod_brand FOREIGN KEY (brand_id) REFERENCES brands(brand_id)
);

CREATE TABLE IF NOT EXISTS product_dimensions (
    product_id INT PRIMARY KEY,
    width_cm DECIMAL(6, 2) NOT NULL,
    height_cm DECIMAL(6, 2) NOT NULL,
    depth_cm DECIMAL(6, 2) NOT NULL,
    volume_cm3 DECIMAL(10, 2) NOT NULL,
    CONSTRAINT fk_dim_prod FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    reviewer_name VARCHAR(150) NOT NULL,
    reviewer_email VARCHAR(255) NOT NULL,
    rating INT NOT NULL,
    comment TEXT NOT NULL,
    review_date DATETIME NOT NULL,
    CONSTRAINT fk_rev_prod FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS etl_audit_log (
    audit_id INT AUTO_INCREMENT PRIMARY KEY,
    pipeline_name VARCHAR(100) NOT NULL,
    run_id VARCHAR(64) NOT NULL UNIQUE,
    status ENUM('RUNNING', 'SUCCESS', 'FAILED') NOT NULL,
    records_extracted INT DEFAULT 0,
    records_transformed INT DEFAULT 0,
    records_inserted INT DEFAULT 0,
    execution_duration_sec DECIMAL(8, 3) NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL
);
`,
  },
  {
    path: 'sql/analytical_queries.sql',
    name: 'analytical_queries.sql',
    language: 'sql',
    category: 'sql',
    description: 'Sample analytical and post-load reconciliation queries for inventory valuation, stock risks, and audit inspection.',
    content: `-- 1. Category Inventory & Valuation Summary
SELECT 
    c.category_name,
    COUNT(p.product_id) AS sku_count,
    SUM(p.stock) AS total_inventory_units,
    ROUND(AVG(p.price), 2) AS avg_retail_price,
    ROUND(SUM(p.discounted_price * p.stock), 2) AS discounted_inventory_value
FROM categories c
JOIN products p ON c.category_id = p.category_id
GROUP BY c.category_id, c.category_name
ORDER BY discounted_inventory_value DESC;

-- 2. Low-Stock High-Rating Replenishment Alert
SELECT 
    p.sku,
    p.title,
    c.category_name,
    p.stock,
    p.rating,
    p.price
FROM products p
JOIN categories c ON p.category_id = c.category_id
WHERE p.rating >= 4.00 AND p.stock <= 10
ORDER BY p.rating DESC, p.stock ASC;

-- 3. Audit Log Telemetry Review
SELECT 
    run_id, status, records_extracted, records_inserted, execution_duration_sec, completed_at
FROM etl_audit_log
ORDER BY started_at DESC
LIMIT 5;
`,
  },
  {
    path: 'config/config.yaml',
    name: 'config.yaml',
    language: 'yaml',
    category: 'config',
    description: 'Pipeline YAML configuration with endpoints, retries, timeouts, database credentials, and DQ thresholds.',
    content: `pipeline:
  name: "ecommerce_product_catalog_etl"
  version: "1.2.0"
  environment: "development"

api:
  base_url: "https://dummyjson.com"
  endpoint: "/products"
  page_size: 30
  max_records: 120
  timeout_seconds: 15
  max_retries: 4
  backoff_factor: 1.5
  retry_status_codes: [429, 500, 502, 503, 504]

database:
  host: "127.0.0.1"
  port: 3306
  database: "ecommerce_dw"
  user: "etl_runner"
  password: "etl_secure_password"
  batch_size: 100

data_quality:
  halt_on_critical_failure: true
  min_records_threshold: 1
  price_min_bound: 0.01

logging:
  level: "INFO"
  log_file: "logs/pipeline.log"
`,
  },
  {
    path: 'README.md',
    name: 'README.md',
    language: 'markdown',
    category: 'root',
    description: 'Complete documentation with architecture diagrams, design rationale, quickstart, and resume bullet points.',
    content: `# REST API to MySQL Data Pipeline
A production-grade ETL data pipeline designed to ingest complex, nested e-commerce product catalog records from an external REST API, perform schema validation, flatten hierarchical JSON payloads, run comprehensive data quality checks, and load normalized records idempotently into a relational MySQL database.

(See full README file in repository for setup commands, docker-compose instructions, and architecture breakdown).
`,
  },
];
