"""
Main Pipeline Orchestrator.
Coordinates the end-to-end execution of the REST API to MySQL ETL pipeline:
Extraction -> Contract Validation -> Transformation -> Quality Checks -> Idempotent Load -> Verification.
"""

import argparse
import os
import sys
import time
import uuid
from typing import Any, Dict, Optional
import yaml
from dotenv import load_dotenv

from src.utils.logger import setup_logger
from src.api_client import APIClient, APIClientError
from src.extract import Extractor
from src.validate import RawDataValidator
from src.transform import DataTransformer
from src.quality_checks import DataQualityChecker, CriticalDataQualityError
from src.load import MySQLLoader, DatabaseConnectionError


def load_configuration(config_path: str = "config/config.yaml") -> Dict[str, Any]:
    """Loads YAML configuration with environment variable fallbacks."""
    load_dotenv()

    config: Dict[str, Any] = {}
    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f) or {}

    # Allow environment variables to override sensitive or dynamic settings
    db_cfg = config.setdefault("database", {})
    db_cfg["host"] = os.getenv("DB_HOST", db_cfg.get("host", "127.0.0.1"))
    db_cfg["port"] = int(os.getenv("DB_PORT", db_cfg.get("port", 3306)))
    db_cfg["database"] = os.getenv("DB_NAME", db_cfg.get("database", "ecommerce_dw"))
    db_cfg["user"] = os.getenv("DB_USER", db_cfg.get("user", "etl_runner"))
    db_cfg["password"] = os.getenv("DB_PASSWORD", db_cfg.get("password", "etl_secure_password"))

    api_cfg = config.setdefault("api", {})
    if os.getenv("API_BASE_URL"):
        api_cfg["base_url"] = os.getenv("API_BASE_URL")
    if os.getenv("API_MAX_RECORDS"):
        api_cfg["max_records"] = int(os.getenv("API_MAX_RECORDS"))

    return config


class ETLPipeline:
    """End-to-End REST API to MySQL ETL Pipeline Orchestrator."""

    def __init__(self, config: Dict[str, Any], dry_run: bool = False):
        self.config = config
        self.dry_run = dry_run
        self.run_id = f"run_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        self.pipeline_name = config.get("pipeline", {}).get("name", "ecommerce_product_catalog_etl")

        log_cfg = config.get("logging", {})
        self.logger = setup_logger(
            name="pipeline",
            log_level=log_cfg.get("level", "INFO"),
            log_file=log_cfg.get("log_file", "logs/pipeline.log"),
            max_bytes=log_cfg.get("max_bytes", 10485760),
            backup_count=log_cfg.get("backup_count", 5),
        )

        self.logger.info("=" * 70)
        self.logger.info("INITIALIZING ETL PIPELINE: %s", self.pipeline_name)
        self.logger.info("Run ID: %s | Dry Run Mode: %s", self.run_id, self.dry_run)
        self.logger.info("=" * 70)

    def run(self) -> bool:
        """
        Executes the full pipeline lifecycle.

        Returns:
            bool: True if pipeline succeeded, False otherwise.
        """
        start_time = time.time()
        records_extracted_count = 0
        records_validated_count = 0
        records_transformed_count = 0
        records_inserted_count = 0
        records_updated_count = 0
        dq_passed_count = 0
        dq_failed_count = 0
        status = "FAILED"
        error_msg: Optional[str] = None
        loader: Optional[MySQLLoader] = None

        try:
            # ------------------------------------------------------------------
            # Stage 1: API Extraction
            # ------------------------------------------------------------------
            self.logger.info(">>> STAGE 1: API EXTRACTION STARTING")
            api_cfg = self.config.get("api", {})
            api_client = APIClient(
                base_url=api_cfg.get("base_url", "https://dummyjson.com"),
                timeout=api_cfg.get("timeout_seconds", 15),
                max_retries=api_cfg.get("max_retries", 3),
                backoff_factor=api_cfg.get("backoff_factor", 1.5),
                retry_status_codes=api_cfg.get("retry_status_codes", [429, 500, 502, 503, 504]),
                headers=api_cfg.get("headers"),
            )

            extractor = Extractor(
                api_client=api_client,
                endpoint=api_cfg.get("endpoint", "/products"),
                page_size=api_cfg.get("page_size", 30),
                max_records=api_cfg.get("max_records"),
            )

            raw_records = extractor.extract_all()
            records_extracted_count = len(raw_records)
            self.logger.info(
                ">>> STAGE 1 COMPLETE: Extracted %d raw records from REST API.",
                records_extracted_count,
            )

            if records_extracted_count == 0:
                self.logger.warning("No records were extracted. Pipeline finished with 0 records.")
                status = "SUCCESS"
                return True

            # ------------------------------------------------------------------
            # Stage 2: Schema Contract Validation
            # ------------------------------------------------------------------
            self.logger.info(">>> STAGE 2: RAW CONTRACT VALIDATION STARTING")
            validator = RawDataValidator(reject_invalid=True)
            valid_records, quarantined = validator.validate_batch(raw_records)
            records_validated_count = len(valid_records)

            if quarantined:
                self.logger.warning(
                    "Quarantined %d bad records during contract validation.", len(quarantined)
                )

            self.logger.info(
                ">>> STAGE 2 COMPLETE: %d / %d records passed schema contracts.",
                records_validated_count,
                records_extracted_count,
            )

            # ------------------------------------------------------------------
            # Stage 3: Data Transformation with Pandas
            # ------------------------------------------------------------------
            self.logger.info(">>> STAGE 3: PANDAS DATA TRANSFORMATION STARTING")
            transformer = DataTransformer()
            df_categories, df_brands, df_products, df_dimensions, df_reviews = (
                transformer.transform(valid_records)
            )
            records_transformed_count = len(df_products)
            self.logger.info(
                ">>> STAGE 3 COMPLETE: Transformed into relational entities: "
                "Products=%d, Categories=%d, Brands=%d, Dimensions=%d, Reviews=%d",
                len(df_products),
                len(df_categories),
                len(df_brands),
                len(df_dimensions),
                len(df_reviews),
            )

            # ------------------------------------------------------------------
            # Stage 4: Automated Data Quality Checks
            # ------------------------------------------------------------------
            self.logger.info(">>> STAGE 4: DATA QUALITY VALIDATION SUITE STARTING")
            dq_cfg = self.config.get("data_quality", {})
            dq_checker = DataQualityChecker(
                halt_on_critical=dq_cfg.get("halt_on_critical_failure", True),
                min_products_threshold=dq_cfg.get("min_records_threshold", 1),
                price_min_bound=dq_cfg.get("price_min_bound", 0.01),
                rating_min_bound=dq_cfg.get("rating_min_bound", 0.0),
                rating_max_bound=dq_cfg.get("rating_max_bound", 5.0),
            )

            dq_report = dq_checker.run_all_checks(
                df_products=df_products,
                df_categories=df_categories,
                df_dimensions=df_dimensions,
                df_reviews=df_reviews,
            )
            dq_passed_count = dq_report.passed_checks
            dq_failed_count = dq_report.failed_critical + dq_report.failed_warnings

            self.logger.info(
                ">>> STAGE 4 COMPLETE: Quality Checks Passed: %d, Critical: %d, Warnings: %d",
                dq_passed_count,
                dq_report.failed_critical,
                dq_report.failed_warnings,
            )

            # ------------------------------------------------------------------
            # Stage 5: MySQL Idempotent Database Load
            # ------------------------------------------------------------------
            if self.dry_run:
                self.logger.info(">>> DRY RUN ACTIVE: Skipping MySQL database write operations.")
                status = "SUCCESS"
            else:
                self.logger.info(">>> STAGE 5: MYSQL IDEMPOTENT LOAD STARTING")
                db_cfg = self.config.get("database", {})
                loader = MySQLLoader(
                    host=db_cfg.get("host", "127.0.0.1"),
                    port=db_cfg.get("port", 3306),
                    database=db_cfg.get("database", "ecommerce_dw"),
                    user=db_cfg.get("user", "etl_runner"),
                    password=db_cfg.get("password", "etl_secure_password"),
                    charset=db_cfg.get("charset", "utf8mb4"),
                    pool_size=db_cfg.get("pool_size", 5),
                    max_overflow=db_cfg.get("max_overflow", 10),
                    batch_size=db_cfg.get("batch_size", 100),
                )

                engine = loader.get_engine()

                # Step 5a: Sync lookup dimensions
                category_map = loader.load_categories(engine, df_categories)
                brand_map = loader.load_brands(engine, df_brands)

                # Step 5b: Upsert products
                inserted_count, updated_indicator = loader.load_products(
                    engine, df_products, category_map, brand_map
                )
                records_inserted_count = inserted_count

                # Step 5c: Upsert dimensions & reviews
                loader.load_dimensions(engine, df_dimensions)
                loader.load_reviews(engine, df_reviews)

                self.logger.info(
                    ">>> STAGE 5 COMPLETE: Successfully synchronized MySQL relational tables."
                )
                status = "SUCCESS"

        except CriticalDataQualityError as exc:
            status = "FAILED"
            error_msg = f"Critical DQ Failure: {exc}"
            self.logger.critical("PIPELINE HALTED BY DATA QUALITY GUARDRAIL: %s", exc)
        except DatabaseConnectionError as exc:
            status = "FAILED"
            error_msg = f"Database Error: {exc}"
            self.logger.critical("PIPELINE HALTED BY DATABASE ERROR: %s", exc)
        except APIClientError as exc:
            status = "FAILED"
            error_msg = f"API Client Error: {exc}"
            self.logger.critical("PIPELINE HALTED BY REST API ERROR: %s", exc)
        except Exception as exc:
            status = "FAILED"
            error_msg = f"Unexpected Exception: {exc}"
            self.logger.exception("UNHANDLED PIPELINE FAILURE: %s", exc)
        finally:
            duration_sec = time.time() - start_time
            self.logger.info("=" * 70)
            self.logger.info("PIPELINE EXECUTION SUMMARY")
            self.logger.info("Run ID: %s", self.run_id)
            self.logger.info("Status: %s", status)
            self.logger.info("Execution Time: %.2f seconds", duration_sec)
            self.logger.info("Records Extracted: %d", records_extracted_count)
            self.logger.info("Records Validated: %d", records_validated_count)
            self.logger.info("Records Transformed: %d", records_transformed_count)
            self.logger.info("Records Loaded (Products): %d", records_inserted_count)
            self.logger.info("Data Quality Checks Passed: %d / Failed: %d", dq_passed_count, dq_failed_count)
            if error_msg:
                self.logger.error("Error Detail: %s", error_msg)
            self.logger.info("=" * 70)

            # Persist run audit log to database if loader and engine are available
            if loader and not self.dry_run:
                try:
                    engine = loader.get_engine()
                    loader.record_audit_log(
                        engine=engine,
                        run_id=self.run_id,
                        pipeline_name=self.pipeline_name,
                        status=status,
                        records_extracted=records_extracted_count,
                        records_validated=records_validated_count,
                        records_transformed=records_transformed_count,
                        records_inserted=records_inserted_count,
                        records_updated=records_updated_count,
                        dq_passed=dq_passed_count,
                        dq_failed=dq_failed_count,
                        duration_sec=duration_sec,
                        error_message=error_msg,
                    )
                except Exception as audit_exc:
                    self.logger.warning("Could not persist audit record: %s", audit_exc)

        return status == "SUCCESS"


def main():
    """Command-line entrypoint."""
    parser = argparse.ArgumentParser(
        description="REST API to MySQL Data Pipeline - Portfolio ETL Project"
    )
    parser.add_argument(
        "--config",
        default="config/config.yaml",
        help="Path to pipeline YAML configuration file (default: config/config.yaml)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Extract, validate, transform, and run DQ checks without loading into MySQL.",
    )
    parser.add_argument(
        "--max-records",
        type=int,
        default=None,
        help="Override total records ceiling (e.g., --max-records 50).",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=None,
        help="Override pagination batch size (e.g., --page-size 25).",
    )

    args = parser.parse_args()

    # Load configuration
    cfg = load_configuration(args.config)

    # CLI Overrides
    if args.max_records is not None:
        cfg.setdefault("api", {})["max_records"] = args.max_records
    if args.page_size is not None:
        cfg.setdefault("api", {})["page_size"] = args.page_size

    pipeline = ETLPipeline(config=cfg, dry_run=args.dry_run)
    success = pipeline.run()

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
