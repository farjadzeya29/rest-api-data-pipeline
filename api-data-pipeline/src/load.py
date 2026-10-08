"""
Relational Database Loader Module for MySQL.
Executes idempotent upsert operations (`INSERT ... ON DUPLICATE KEY UPDATE`),
manages foreign key dependencies, tracks execution metrics, and logs run audits.
"""

import logging
import time
from typing import Any, Dict, Optional, Tuple
import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError, SQLAlchemyError

logger = logging.getLogger("pipeline.load")


class DatabaseConnectionError(Exception):
    """Raised when pipeline cannot establish or maintain connection with MySQL."""
    pass


class MySQLLoader:
    """
    Manages loading of transformed DataFrames into MySQL with idempotent upserts.
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 3306,
        database: str = "ecommerce_dw",
        user: str = "etl_runner",
        password: str = "etl_secure_password",
        charset: str = "utf8mb4",
        pool_size: int = 5,
        max_overflow: int = 10,
        batch_size: int = 100,
    ):
        self.host = host
        self.port = port
        self.database = database
        self.user = user
        self.password = password
        self.batch_size = batch_size

        # Construct SQLAlchemy MySQL connection URI
        # Supports PyMySQL driver: mysql+pymysql://user:pass@host:port/dbname
        self.connection_uri = (
            f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}?charset={charset}"
        )

        self._engine: Optional[Engine] = None
        logger.info("MySQLLoader initialized targeting %s:%d/%s", host, port, database)

    def get_engine(self, max_connection_retries: int = 3) -> Engine:
        """
        Lazily creates and tests database engine with connection retries.
        """
        if self._engine is not None:
            return self._engine

        logger.info("Connecting to MySQL at %s:%d/%s...", self.host, self.port, self.database)
        attempt = 1
        last_error = None

        while attempt <= max_connection_retries:
            try:
                engine = create_engine(
                    self.connection_uri,
                    pool_pre_ping=True,  # Tests connection before checkout to prevent dead connections
                    pool_recycle=3600,
                )
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1;"))
                logger.info("Successfully established connection to MySQL.")
                self._engine = engine
                return self._engine
            except OperationalError as exc:
                last_error = exc
                logger.warning(
                    "Connection attempt %d/%d failed: %s. Retrying in %ds...",
                    attempt,
                    max_connection_retries,
                    exc,
                    attempt * 2,
                )
                time.sleep(attempt * 2)
                attempt += 1
            except Exception as exc:
                logger.error("Non-recoverable database driver error: %s", exc)
                raise DatabaseConnectionError(f"Failed to connect to MySQL: {exc}") from exc

        raise DatabaseConnectionError(
            f"Could not connect to MySQL after {max_connection_retries} attempts: {last_error}"
        )

    def load_categories(self, engine: Engine, df_categories: pd.DataFrame) -> Dict[str, int]:
        """
        Upserts categories and returns mapping of {category_code: category_id}.
        """
        if df_categories.empty:
            return {}

        logger.info("Syncing %d categories...", len(df_categories))
        with engine.begin() as conn:
            for _, row in df_categories.iterrows():
                sql = text("""
                    INSERT INTO categories (category_code, category_name)
                    VALUES (:code, :name)
                    ON DUPLICATE KEY UPDATE
                        category_name = VALUES(category_name),
                        updated_at = CURRENT_TIMESTAMP;
                """)
                conn.execute(sql, {"code": row["category_code"], "name": row["category_name"]})

            # Fetch fresh mapping
            result = conn.execute(text("SELECT category_code, category_id FROM categories;"))
            category_map = {row[0]: row[1] for row in result.fetchall()}

        logger.info("Categories synchronized. Total mapped categories: %d", len(category_map))
        return category_map

    def load_brands(self, engine: Engine, df_brands: pd.DataFrame) -> Dict[str, int]:
        """
        Upserts brands and returns mapping of {brand_name: brand_id}.
        """
        if df_brands.empty:
            return {}

        logger.info("Syncing %d brands...", len(df_brands))
        with engine.begin() as conn:
            for _, row in df_brands.iterrows():
                sql = text("""
                    INSERT INTO brands (brand_name)
                    VALUES (:bname)
                    ON DUPLICATE KEY UPDATE
                        brand_name = VALUES(brand_name);
                """)
                conn.execute(sql, {"bname": row["brand_name"]})

            result = conn.execute(text("SELECT brand_name, brand_id FROM brands;"))
            brand_map = {row[0]: row[1] for row in result.fetchall()}

        logger.info("Brands synchronized. Total mapped brands: %d", len(brand_map))
        return brand_map

    def load_products(
        self,
        engine: Engine,
        df_products: pd.DataFrame,
        category_map: Dict[str, int],
        brand_map: Dict[str, int],
    ) -> Tuple[int, int]:
        """
        Idempotently upserts products into MySQL using ON DUPLICATE KEY UPDATE.

        Returns:
            Tuple of (inserted_count, updated_count).
        """
        if df_products.empty:
            return 0, 0

        logger.info("Loading %d products into MySQL (idempotent upsert)...", len(df_products))
        upsert_sql = text("""
            INSERT INTO products (
                product_id, sku, title, description, category_id, brand_id,
                price, discount_percentage, discounted_price, rating,
                stock, stock_status, weight_grams, warranty_information,
                shipping_information, availability_status, return_policy,
                minimum_order_quantity, barcode, last_synced_at
            ) VALUES (
                :product_id, :sku, :title, :description, :category_id, :brand_id,
                :price, :discount_percentage, :discounted_price, :rating,
                :stock, :stock_status, :weight_grams, :warranty_information,
                :shipping_information, :availability_status, :return_policy,
                :minimum_order_quantity, :barcode, CURRENT_TIMESTAMP
            ) ON DUPLICATE KEY UPDATE
                title = VALUES(title),
                description = VALUES(description),
                category_id = VALUES(category_id),
                brand_id = VALUES(brand_id),
                price = VALUES(price),
                discount_percentage = VALUES(discount_percentage),
                discounted_price = VALUES(discounted_price),
                rating = VALUES(rating),
                stock = VALUES(stock),
                stock_status = VALUES(stock_status),
                weight_grams = VALUES(weight_grams),
                warranty_information = VALUES(warranty_information),
                shipping_information = VALUES(shipping_information),
                availability_status = VALUES(availability_status),
                return_policy = VALUES(return_policy),
                minimum_order_quantity = VALUES(minimum_order_quantity),
                barcode = VALUES(barcode),
                updated_at = CURRENT_TIMESTAMP,
                last_synced_at = CURRENT_TIMESTAMP;
        """)

        # Resolve foreign keys
        records_to_load = []
        for _, row in df_products.iterrows():
            cat_id = category_map.get(row["category_code"])
            if not cat_id:
                logger.error("Missing category mapping for code '%s'", row["category_code"])
                continue

            brand_id = brand_map.get(row["brand_name"]) if pd.notna(row["brand_name"]) else None

            rec = {
                "product_id": int(row["product_id"]),
                "sku": str(row["sku"]),
                "title": str(row["title"]),
                "description": str(row["description"]),
                "category_id": int(cat_id),
                "brand_id": int(brand_id) if brand_id else None,
                "price": float(row["price"]),
                "discount_percentage": float(row["discount_percentage"]),
                "discounted_price": float(row["discounted_price"]),
                "rating": float(row["rating"]),
                "stock": int(row["stock"]),
                "stock_status": str(row["stock_status"]),
                "weight_grams": float(row["weight_grams"]) if pd.notna(row["weight_grams"]) else None,
                "warranty_information": str(row["warranty_information"]),
                "shipping_information": str(row["shipping_information"]),
                "availability_status": str(row["availability_status"]),
                "return_policy": str(row["return_policy"]),
                "minimum_order_quantity": int(row["minimum_order_quantity"]),
                "barcode": str(row["barcode"]) if pd.notna(row["barcode"]) else None,
            }
            records_to_load.append(rec)

        affected_rows = 0
        with engine.begin() as conn:
            # Execute in batches for memory and transaction efficiency
            for i in range(0, len(records_to_load), self.batch_size):
                batch = records_to_load[i : i + self.batch_size]
                res = conn.execute(upsert_sql, batch)
                affected_rows += res.rowcount

        logger.info(
            "Products load finished. Target records: %d, affected rowcount indicator: %d",
            len(records_to_load),
            affected_rows,
        )
        return len(records_to_load), affected_rows

    def load_dimensions(self, engine: Engine, df_dimensions: pd.DataFrame) -> int:
        """
        Upserts 1:1 product dimensions.
        """
        if df_dimensions.empty:
            return 0

        logger.info("Loading %d product dimensions...", len(df_dimensions))
        sql = text("""
            INSERT INTO product_dimensions (product_id, width_cm, height_cm, depth_cm, volume_cm3)
            VALUES (:pid, :width, :height, :depth, :volume)
            ON DUPLICATE KEY UPDATE
                width_cm = VALUES(width_cm),
                height_cm = VALUES(height_cm),
                depth_cm = VALUES(depth_cm),
                volume_cm3 = VALUES(volume_cm3),
                updated_at = CURRENT_TIMESTAMP;
        """)

        records = [
            {
                "pid": int(r["product_id"]),
                "width": float(r["width_cm"]),
                "height": float(r["height_cm"]),
                "depth": float(r["depth_cm"]),
                "volume": float(r["volume_cm3"]),
            }
            for _, r in df_dimensions.iterrows()
        ]

        with engine.begin() as conn:
            for i in range(0, len(records), self.batch_size):
                batch = records[i : i + self.batch_size]
                conn.execute(sql, batch)

        logger.info("Product dimensions synchronized successfully (%d records).", len(records))
        return len(records)

    def load_reviews(self, engine: Engine, df_reviews: pd.DataFrame) -> int:
        """
        Loads 1:N product reviews using INSERT IGNORE to prevent duplicate historical reviews.
        """
        if df_reviews.empty:
            return 0

        logger.info("Loading %d product reviews...", len(df_reviews))
        sql = text("""
            INSERT IGNORE INTO product_reviews (
                product_id, reviewer_name, reviewer_email, rating, comment, review_date
            ) VALUES (
                :pid, :rname, :remail, :rating, :comment, :rdate
            );
        """)

        records = [
            {
                "pid": int(r["product_id"]),
                "rname": str(r["reviewer_name"]),
                "remail": str(r["reviewer_email"]),
                "rating": int(r["rating"]),
                "comment": str(r["comment"]),
                "rdate": str(r["review_date"]),
            }
            for _, r in df_reviews.iterrows()
        ]

        inserted_count = 0
        with engine.begin() as conn:
            for i in range(0, len(records), self.batch_size):
                batch = records[i : i + self.batch_size]
                res = conn.execute(sql, batch)
                inserted_count += res.rowcount

        logger.info("Product reviews loaded. Inserted new reviews: %d (Evaluated: %d)", inserted_count, len(records))
        return inserted_count

    def record_audit_log(
        self,
        engine: Engine,
        run_id: str,
        pipeline_name: str,
        status: str,
        records_extracted: int,
        records_validated: int,
        records_transformed: int,
        records_inserted: int,
        records_updated: int,
        dq_passed: int,
        dq_failed: int,
        duration_sec: float,
        error_message: Optional[str] = None,
    ):
        """
        Inserts pipeline execution metadata into etl_audit_log table.
        """
        sql = text("""
            INSERT INTO etl_audit_log (
                run_id, pipeline_name, status, records_extracted, records_validated,
                records_transformed, records_inserted, records_updated,
                dq_passed_count, dq_failed_count, execution_duration_sec,
                error_message, completed_at
            ) VALUES (
                :run_id, :pname, :status, :extracted, :validated,
                :transformed, :inserted, :updated,
                :dq_passed, :dq_failed, :duration,
                :err, CURRENT_TIMESTAMP
            );
        """)
        try:
            with engine.begin() as conn:
                conn.execute(sql, {
                    "run_id": run_id,
                    "pname": pipeline_name,
                    "status": status,
                    "extracted": records_extracted,
                    "validated": records_validated,
                    "transformed": records_transformed,
                    "inserted": records_inserted,
                    "updated": records_updated,
                    "dq_passed": dq_passed,
                    "dq_failed": dq_failed,
                    "duration": round(duration_sec, 3),
                    "err": error_message,
                })
            logger.info("ETL audit log entry recorded for run '%s' (status=%s)", run_id, status)
        except Exception as exc:
            logger.warning("Failed to persist audit log entry: %s", exc)
