"""
Data Quality & Integrity Assurance Module.
Executes automated pre-load validation checks across transformed DataFrames.
Distinguishes between CRITICAL failures (which halt the pipeline) and WARNINGs.
"""

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional
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
    metrics: Dict[str, int | float | str] = field(default_factory=dict)


@dataclass
class QualityReport:
    total_checks: int = 0
    passed_checks: int = 0
    failed_critical: int = 0
    failed_warnings: int = 0
    results: List[QualityCheckResult] = field(default_factory=list)

    @property
    def is_safe_to_load(self) -> bool:
        return self.failed_critical == 0


class CriticalDataQualityError(Exception):
    """Raised when one or more CRITICAL data quality checks fail."""
    def __init__(self, message: str, report: QualityReport):
        super().__init__(message)
        self.report = report


class DataQualityChecker:
    """
    Executes automated data quality validations against transformed datasets.
    """

    def __init__(
        self,
        halt_on_critical: bool = True,
        min_products_threshold: int = 1,
        price_min_bound: float = 0.01,
        rating_min_bound: float = 0.0,
        rating_max_bound: float = 5.0,
    ):
        self.halt_on_critical = halt_on_critical
        self.min_products_threshold = min_products_threshold
        self.price_min_bound = price_min_bound
        self.rating_min_bound = rating_min_bound
        self.rating_max_bound = rating_max_bound

    def run_all_checks(
        self,
        df_products: pd.DataFrame,
        df_categories: pd.DataFrame,
        df_dimensions: pd.DataFrame,
        df_reviews: pd.DataFrame,
    ) -> QualityReport:
        """
        Runs comprehensive suite of data quality validations.

        Returns:
            QualityReport containing all check outputs.

        Raises:
            CriticalDataQualityError: If critical failures occur and halt_on_critical is True.
        """
        report = QualityReport()
        logger.info("Executing Pre-Load Data Quality Check Suite...")

        def record(result: QualityCheckResult):
            report.results.append(result)
            report.total_checks += 1
            if result.status == CheckStatus.PASSED:
                report.passed_checks += 1
                logger.info("  [PASSED] [%s] %s: %s", result.target_table, result.check_name, result.message)
            else:
                if result.severity == CheckSeverity.CRITICAL:
                    report.failed_critical += 1
                    logger.error("  [FAILED-CRITICAL] [%s] %s: %s (metrics: %s)", result.target_table, result.check_name, result.message, result.metrics)
                else:
                    report.failed_warnings += 1
                    logger.warning("  [FAILED-WARNING] [%s] %s: %s (metrics: %s)", result.target_table, result.check_name, result.message, result.metrics)

        # ----------------------------------------------------------------------
        # Check 1: Record Count Sanity (Products)
        # ----------------------------------------------------------------------
        prod_count = len(df_products)
        if prod_count >= self.min_products_threshold:
            record(QualityCheckResult(
                check_name="min_record_count_products",
                target_table="products",
                severity=CheckSeverity.CRITICAL,
                status=CheckStatus.PASSED,
                message=f"Products count ({prod_count}) meets threshold ({self.min_products_threshold}).",
                metrics={"row_count": prod_count},
            ))
        else:
            record(QualityCheckResult(
                check_name="min_record_count_products",
                target_table="products",
                severity=CheckSeverity.CRITICAL,
                status=CheckStatus.FAILED,
                message=f"Products count ({prod_count}) is below minimum threshold ({self.min_products_threshold}).",
                metrics={"row_count": prod_count, "threshold": self.min_products_threshold},
            ))

        # ----------------------------------------------------------------------
        # Check 2: Primary Key Uniqueness (product_id)
        # ----------------------------------------------------------------------
        if not df_products.empty:
            pk_dupes = df_products["product_id"].duplicated().sum()
            if pk_dupes == 0:
                record(QualityCheckResult(
                    check_name="primary_key_uniqueness_product_id",
                    target_table="products",
                    severity=CheckSeverity.CRITICAL,
                    status=CheckStatus.PASSED,
                    message="All product_id values are strictly unique.",
                    metrics={"duplicate_keys": 0},
                ))
            else:
                record(QualityCheckResult(
                    check_name="primary_key_uniqueness_product_id",
                    target_table="products",
                    severity=CheckSeverity.CRITICAL,
                    status=CheckStatus.FAILED,
                    message=f"Found {pk_dupes} duplicate product_id values.",
                    metrics={"duplicate_keys": int(pk_dupes)},
                ))

        # ----------------------------------------------------------------------
        # Check 3: SKU Uniqueness
        # ----------------------------------------------------------------------
        if not df_products.empty:
            sku_dupes = df_products["sku"].duplicated().sum()
            if sku_dupes == 0:
                record(QualityCheckResult(
                    check_name="unique_sku_constraint",
                    target_table="products",
                    severity=CheckSeverity.CRITICAL,
                    status=CheckStatus.PASSED,
                    message="All SKU values are strictly unique.",
                    metrics={"duplicate_skus": 0},
                ))
            else:
                record(QualityCheckResult(
                    check_name="unique_sku_constraint",
                    target_table="products",
                    severity=CheckSeverity.CRITICAL,
                    status=CheckStatus.FAILED,
                    message=f"Found {sku_dupes} duplicate SKU values.",
                    metrics={"duplicate_skus": int(sku_dupes)},
                ))

        # ----------------------------------------------------------------------
        # Check 4: Null Values in Mandatory Fields
        # ----------------------------------------------------------------------
        mandatory_fields = ["product_id", "sku", "title", "price", "category_code", "stock_status"]
        if not df_products.empty:
            null_summary = {}
            for field_name in mandatory_fields:
                if field_name in df_products.columns:
                    null_count = df_products[field_name].isna().sum()
                    if null_count > 0:
                        null_summary[field_name] = int(null_count)

            if not null_summary:
                record(QualityCheckResult(
                    check_name="mandatory_fields_null_check",
                    target_table="products",
                    severity=CheckSeverity.CRITICAL,
                    status=CheckStatus.PASSED,
                    message="Mandatory columns contain 0 null values.",
                    metrics={"null_columns_detected": 0},
                ))
            else:
                record(QualityCheckResult(
                    check_name="mandatory_fields_null_check",
                    target_table="products",
                    severity=CheckSeverity.CRITICAL,
                    status=CheckStatus.FAILED,
                    message=f"Nulls detected in mandatory columns: {null_summary}",
                    metrics=null_summary,
                ))

        # ----------------------------------------------------------------------
        # Check 5: Numerical Range Validation - Price
        # ----------------------------------------------------------------------
        if not df_products.empty:
            invalid_prices = (df_products["price"] < self.price_min_bound).sum()
            if invalid_prices == 0:
                record(QualityCheckResult(
                    check_name="price_positive_range",
                    target_table="products",
                    severity=CheckSeverity.CRITICAL,
                    status=CheckStatus.PASSED,
                    message=f"All prices exceed minimum threshold of ${self.price_min_bound:.2f}.",
                    metrics={"invalid_price_count": 0},
                ))
            else:
                record(QualityCheckResult(
                    check_name="price_positive_range",
                    target_table="products",
                    severity=CheckSeverity.CRITICAL,
                    status=CheckStatus.FAILED,
                    message=f"{invalid_prices} products have prices lower than ${self.price_min_bound:.2f}.",
                    metrics={"invalid_price_count": int(invalid_prices)},
                ))

        # ----------------------------------------------------------------------
        # Check 6: Numerical Range Validation - Ratings (0.0 to 5.0)
        # ----------------------------------------------------------------------
        if not df_products.empty:
            out_of_bounds_ratings = (
                (df_products["rating"] < self.rating_min_bound) |
                (df_products["rating"] > self.rating_max_bound)
            ).sum()
            if out_of_bounds_ratings == 0:
                record(QualityCheckResult(
                    check_name="rating_domain_bounds",
                    target_table="products",
                    severity=CheckSeverity.WARNING,
                    status=CheckStatus.PASSED,
                    message=f"All ratings fall within legitimate bounds [{self.rating_min_bound}, {self.rating_max_bound}].",
                    metrics={"invalid_ratings": 0},
                ))
            else:
                record(QualityCheckResult(
                    check_name="rating_domain_bounds",
                    target_table="products",
                    severity=CheckSeverity.WARNING,
                    status=CheckStatus.FAILED,
                    message=f"{out_of_bounds_ratings} ratings outside expected 0.0-5.0 scale.",
                    metrics={"invalid_ratings": int(out_of_bounds_ratings)},
                ))

        # ----------------------------------------------------------------------
        # Check 7: Referential Integrity Preview - Category Codes
        # ----------------------------------------------------------------------
        if not df_products.empty and not df_categories.empty:
            known_cats = set(df_categories["category_code"])
            prod_cats = set(df_products["category_code"])
            orphan_cats = prod_cats - known_cats
            if not orphan_cats:
                record(QualityCheckResult(
                    check_name="category_referential_integrity",
                    target_table="products",
                    severity=CheckSeverity.CRITICAL,
                    status=CheckStatus.PASSED,
                    message="All product category codes map successfully to category dimension.",
                    metrics={"orphan_categories": 0},
                ))
            else:
                record(QualityCheckResult(
                    check_name="category_referential_integrity",
                    target_table="products",
                    severity=CheckSeverity.CRITICAL,
                    status=CheckStatus.FAILED,
                    message=f"Orphan category codes detected: {list(orphan_cats)}",
                    metrics={"orphan_categories": len(orphan_cats)},
                ))

        # ----------------------------------------------------------------------
        # Check 8: Dimensions 1:1 Relationship Consistency
        # ----------------------------------------------------------------------
        if not df_products.empty and not df_dimensions.empty:
            prod_ids = set(df_products["product_id"])
            dim_ids = set(df_dimensions["product_id"])
            orphan_dims = dim_ids - prod_ids
            if not orphan_dims:
                record(QualityCheckResult(
                    check_name="dimensions_parent_consistency",
                    target_table="product_dimensions",
                    severity=CheckSeverity.CRITICAL,
                    status=CheckStatus.PASSED,
                    message="All dimension records correspond to active product IDs.",
                    metrics={"orphan_dimensions": 0},
                ))
            else:
                record(QualityCheckResult(
                    check_name="dimensions_parent_consistency",
                    target_table="product_dimensions",
                    severity=CheckSeverity.CRITICAL,
                    status=CheckStatus.FAILED,
                    message=f"Found {len(orphan_dims)} dimension rows with nonexistent parent products.",
                    metrics={"orphan_dimensions": len(orphan_dims)},
                ))

        logger.info(
            "Data Quality Suite finished: %d passed, %d critical failures, %d warnings (Total: %d)",
            report.passed_checks,
            report.failed_critical,
            report.failed_warnings,
            report.total_checks,
        )

        if report.failed_critical > 0 and self.halt_on_critical:
            raise CriticalDataQualityError(
                f"Data Quality Suite encountered {report.failed_critical} CRITICAL failure(s). Ingestion halted for database protection.",
                report=report,
            )

        return report
