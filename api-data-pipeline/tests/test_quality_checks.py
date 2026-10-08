"""Unit tests for Data Quality check suite."""

import pytest
import pandas as pd
from src.quality_checks import DataQualityChecker, CriticalDataQualityError


def test_quality_checks_pass_valid_dataset():
    df_prod = pd.DataFrame([{
        "product_id": 101,
        "sku": "SKU-101",
        "title": "Clean Product",
        "price": 19.99,
        "category_code": "books",
        "rating": 4.5,
        "stock": 10,
        "stock_status": "LOW_STOCK",
    }])
    df_cat = pd.DataFrame([{"category_code": "books", "category_name": "Books"}])
    df_dim = pd.DataFrame([{"product_id": 101, "width_cm": 1.0, "height_cm": 2.0, "depth_cm": 3.0, "volume_cm3": 6.0}])
    df_rev = pd.DataFrame()

    checker = DataQualityChecker(halt_on_critical=True)
    report = checker.run_all_checks(df_prod, df_cat, df_dim, df_rev)

    assert report.is_safe_to_load is True
    assert report.failed_critical == 0


def test_quality_checks_halt_on_duplicate_primary_key():
    df_prod = pd.DataFrame([
        {"product_id": 1, "sku": "SKU-1", "title": "A", "price": 10.0, "category_code": "c", "rating": 4.0, "stock_status": "IN_STOCK"},
        {"product_id": 1, "sku": "SKU-2", "title": "B", "price": 20.0, "category_code": "c", "rating": 4.0, "stock_status": "IN_STOCK"},
    ])
    df_cat = pd.DataFrame([{"category_code": "c", "category_name": "C"}])
    df_dim = pd.DataFrame([{"product_id": 1}])
    df_rev = pd.DataFrame()

    checker = DataQualityChecker(halt_on_critical=True)
    with pytest.raises(CriticalDataQualityError):
        checker.run_all_checks(df_prod, df_cat, df_dim, df_rev)


def test_quality_checks_halt_on_negative_price():
    df_prod = pd.DataFrame([
        {"product_id": 1, "sku": "SKU-1", "title": "Broken", "price": -5.00, "category_code": "c", "rating": 4.0, "stock_status": "IN_STOCK"},
    ])
    df_cat = pd.DataFrame([{"category_code": "c", "category_name": "C"}])
    df_dim = pd.DataFrame([{"product_id": 1}])
    df_rev = pd.DataFrame()

    checker = DataQualityChecker(halt_on_critical=True)
    with pytest.raises(CriticalDataQualityError):
        checker.run_all_checks(df_prod, df_cat, df_dim, df_rev)
