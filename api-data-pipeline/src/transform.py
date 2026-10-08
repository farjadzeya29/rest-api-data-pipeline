"""
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
    """Converts camelCase or PascalCase string to snake_case."""
    s1 = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub("([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


class DataTransformer:
    """
    Transforms validated raw JSON payloads into normalized, typed pandas DataFrames.
    """

    def __init__(self):
        logger.info("DataTransformer initialized.")

    def transform(
        self, raw_records: List[Dict[str, Any]]
    ) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """
        Processes validated raw records into 5 relational tables:
        1. categories (unique categories)
        2. brands (unique brands)
        3. products (core facts with calculated fields)
        4. product_dimensions (flattened 1:1 entity with derived volume)
        5. product_reviews (normalized 1:N child reviews)

        Returns:
            Tuple of (df_categories, df_brands, df_products, df_dimensions, df_reviews)
        """
        if not raw_records:
            logger.warning("Empty records list supplied to DataTransformer.")
            return (
                pd.DataFrame(columns=["category_code", "category_name"]),
                pd.DataFrame(columns=["brand_name"]),
                pd.DataFrame(),
                pd.DataFrame(),
                pd.DataFrame(),
            )

        logger.info("Transforming %d raw product records...", len(raw_records))

        # ----------------------------------------------------------------------
        # 1. Base DataFrame & Deduplication
        # ----------------------------------------------------------------------
        df_raw = pd.DataFrame(raw_records)

        # Standardize column names to snake_case
        df_raw.columns = [to_snake_case(c) for c in df_raw.columns]

        # Deduplicate on business primary key 'id'
        initial_count = len(df_raw)
        df_raw = df_raw.drop_duplicates(subset=["id"], keep="last")
        dedup_count = initial_count - len(df_raw)
        if dedup_count > 0:
            logger.info("Removed %d duplicate records matching on primary key 'id'.", dedup_count)

        # Ensure essential columns exist with fallback defaults
        default_columns = {
            "title": "Untitled Product",
            "description": "",
            "category": "uncategorized",
            "price": 0.0,
            "discount_percentage": 0.0,
            "rating": 0.0,
            "stock": 0,
            "brand": None,
            "weight": 0.0,
            "sku": None,
            "warranty_information": "None",
            "shipping_information": "Standard Shipping",
            "availability_status": "In Stock",
            "return_policy": "No Returns",
            "minimum_order_quantity": 1,
            "dimensions": {},
            "reviews": [],
            "meta": {},
        }
        for col, default_val in default_columns.items():
            if col not in df_raw.columns:
                df_raw[col] = default_val

        # Fill missing SKU with deterministic fallback: SKU-{id}
        df_raw["sku"] = df_raw.apply(
            lambda row: str(row["sku"]).strip()
            if pd.notna(row["sku"]) and str(row["sku"]).strip() != ""
            else f"SKU-{row['id']:06d}",
            axis=1,
        )

        # Deduplicate SKU if any collisions exist
        df_raw = df_raw.drop_duplicates(subset=["sku"], keep="last")

        # ----------------------------------------------------------------------
        # 2. Categories Dimension
        # ----------------------------------------------------------------------
        categories_series = df_raw["category"].dropna().astype(str).str.strip().str.lower()
        unique_categories = sorted(categories_series.unique())

        df_categories = pd.DataFrame({
            "category_code": unique_categories,
            "category_name": [c.replace("-", " ").title() for c in unique_categories],
        })

        # ----------------------------------------------------------------------
        # 3. Brands Dimension
        # ----------------------------------------------------------------------
        brands_series = df_raw["brand"].dropna().astype(str).str.strip()
        brands_series = brands_series[brands_series != ""]
        unique_brands = sorted(brands_series.unique())

        df_brands = pd.DataFrame({
            "brand_name": unique_brands,
        })

        # ----------------------------------------------------------------------
        # 4. Core Products Table Transformation
        # ----------------------------------------------------------------------
        df_products = pd.DataFrame()
        df_products["product_id"] = df_raw["id"].astype(int)
        df_products["sku"] = df_raw["sku"].astype(str)
        df_products["title"] = df_raw["title"].fillna("Untitled Product").astype(str)
        df_products["description"] = df_raw["description"].fillna("").astype(str)
        df_products["category_code"] = df_raw["category"].astype(str).str.strip().str.lower()
        df_products["brand_name"] = df_raw["brand"].apply(
            lambda b: str(b).strip() if pd.notna(b) and str(b).strip() != "" else None
        )

        # Data type casting for financial & numeric fields
        df_products["price"] = pd.to_numeric(df_raw["price"], errors="coerce").fillna(0.0).round(2)
        df_products["discount_percentage"] = (
            pd.to_numeric(df_raw["discount_percentage"], errors="coerce").fillna(0.0).round(2)
        )

        # Calculated Field: discounted_price = price * (1 - discount_percentage / 100)
        df_products["discounted_price"] = (
            df_products["price"] * (1.0 - (df_products["discount_percentage"] / 100.0))
        ).round(2)
        # Ensure discounted_price never drops below zero
        df_products["discounted_price"] = df_products["discounted_price"].clip(lower=0.0)

        df_products["rating"] = pd.to_numeric(df_raw["rating"], errors="coerce").fillna(0.0).round(2)
        df_products["stock"] = pd.to_numeric(df_raw["stock"], errors="coerce").fillna(0).astype(int)

        # Derived business metric: stock_status
        df_products["stock_status"] = np.where(
            df_products["stock"] <= 0,
            "OUT_OF_STOCK",
            np.where(df_products["stock"] <= 10, "LOW_STOCK", "IN_STOCK"),
        )

        df_products["weight_grams"] = pd.to_numeric(df_raw["weight"], errors="coerce").fillna(0.0).round(2)
        df_products["warranty_information"] = df_raw["warranty_information"].fillna("None").astype(str)
        df_products["shipping_information"] = df_raw["shipping_information"].fillna("Standard").astype(str)
        df_products["availability_status"] = df_raw["availability_status"].fillna("Unknown").astype(str)
        df_products["return_policy"] = df_raw["return_policy"].fillna("None").astype(str)
        df_products["minimum_order_quantity"] = (
            pd.to_numeric(df_raw["minimum_order_quantity"], errors="coerce").fillna(1).astype(int)
        )

        # Extract barcode from nested meta object if available
        def extract_barcode(meta_val):
            if isinstance(meta_val, dict):
                return meta_val.get("barcode", None)
            return None

        df_products["barcode"] = df_raw["meta"].apply(extract_barcode)

        # ----------------------------------------------------------------------
        # 5. Product Dimensions Table (Flattening nested object)
        # ----------------------------------------------------------------------
        dims_records = []
        for _, row in df_raw.iterrows():
            prod_id = int(row["id"])
            dims = row.get("dimensions") if isinstance(row.get("dimensions"), dict) else {}
            w = round(float(dims.get("width", 0.0) or 0.0), 2)
            h = round(float(dims.get("height", 0.0) or 0.0), 2)
            d = round(float(dims.get("depth", 0.0) or 0.0), 2)
            vol = round(w * h * d, 2)
            dims_records.append({
                "product_id": prod_id,
                "width_cm": w,
                "height_cm": h,
                "depth_cm": d,
                "volume_cm3": vol,
            })
        df_dimensions = pd.DataFrame(dims_records)
        df_dimensions = df_dimensions.drop_duplicates(subset=["product_id"], keep="last")

        # ----------------------------------------------------------------------
        # 6. Product Reviews Table (Normalizing nested list)
        # ----------------------------------------------------------------------
        reviews_records = []
        for _, row in df_raw.iterrows():
            prod_id = int(row["id"])
            reviews = row.get("reviews")
            if isinstance(reviews, list):
                for rev in reviews:
                    if isinstance(rev, dict):
                        rev_date_raw = rev.get("date")
                        try:
                            clean_date = pd.to_datetime(rev_date_raw).strftime("%Y-%m-%d %H:%M:%S")
                        except Exception:
                            clean_date = pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S")

                        reviews_records.append({
                            "product_id": prod_id,
                            "reviewer_name": str(rev.get("reviewerName", "Anonymous")).strip(),
                            "reviewer_email": str(rev.get("reviewerEmail", "unknown@example.com")).strip(),
                            "rating": int(rev.get("rating", 5)),
                            "comment": str(rev.get("comment", "")).strip(),
                            "review_date": clean_date,
                        })

        if reviews_records:
            df_reviews = pd.DataFrame(reviews_records)
            # Deduplicate reviews on composite uniqueness constraint
            df_reviews = df_reviews.drop_duplicates(
                subset=["product_id", "reviewer_email", "review_date"], keep="first"
            )
        else:
            df_reviews = pd.DataFrame(columns=[
                "product_id", "reviewer_name", "reviewer_email", "rating", "comment", "review_date"
            ])

        logger.info(
            "Transformation complete. Products: %d, Categories: %d, Brands: %d, Dimensions: %d, Reviews: %d",
            len(df_products),
            len(df_categories),
            len(df_brands),
            len(df_dimensions),
            len(df_reviews),
        )

        return df_categories, df_brands, df_products, df_dimensions, df_reviews
