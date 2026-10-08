"""Unit tests for pandas data transformations."""

from src.transform import DataTransformer, to_snake_case


def test_to_snake_case():
    assert to_snake_case("discountPercentage") == "discount_percentage"
    assert to_snake_case("productID") == "product_id"
    assert to_snake_case("already_snake") == "already_snake"


def test_transform_normalizes_and_calculates_fields():
    raw_sample = [
        {
            "id": 1,
            "title": "Essence Mascara Lash Princess",
            "description": "Popular mascara for lash volume.",
            "category": "beauty",
            "price": 9.99,
            "discountPercentage": 10.0,
            "rating": 4.94,
            "stock": 5,
            "brand": "Essence",
            "sku": "SKU-BEAUTY-001",
            "weight": 120.0,
            "dimensions": {"width": 2.5, "height": 10.0, "depth": 2.5},
            "reviews": [
                {
                    "rating": 5,
                    "comment": "Loved it!",
                    "date": "2024-05-23T08:56:21.618Z",
                    "reviewerName": "Eleanor",
                    "reviewerEmail": "eleanor@example.com",
                }
            ],
            "meta": {"barcode": "9123456789012"},
        }
    ]

    transformer = DataTransformer()
    df_cat, df_brand, df_prod, df_dim, df_rev = transformer.transform(raw_sample)

    assert len(df_prod) == 1
    assert df_prod.iloc[0]["product_id"] == 1
    assert df_prod.iloc[0]["price"] == 9.99
    # Calculated: 9.99 * 0.9 = 8.99
    assert df_prod.iloc[0]["discounted_price"] == 8.99
    # Stock status: stock = 5 <= 10 -> LOW_STOCK
    assert df_prod.iloc[0]["stock_status"] == "LOW_STOCK"

    # Verify category
    assert len(df_cat) == 1
    assert df_cat.iloc[0]["category_code"] == "beauty"

    # Verify dimension volume: 2.5 * 10 * 2.5 = 62.5
    assert len(df_dim) == 1
    assert df_dim.iloc[0]["volume_cm3"] == 62.5

    # Verify reviews
    assert len(df_rev) == 1
    assert df_rev.iloc[0]["reviewer_name"] == "Eleanor"


def test_transform_deduplication():
    # Duplicate ID records with different prices
    raw_sample = [
        {"id": 1, "title": "Old Version", "price": 10.0, "category": "home"},
        {"id": 1, "title": "New Version", "price": 12.0, "category": "home"},
    ]
    transformer = DataTransformer()
    _, _, df_prod, _, _ = transformer.transform(raw_sample)

    assert len(df_prod) == 1
    # Latest record kept
    assert df_prod.iloc[0]["title"] == "New Version"
    assert df_prod.iloc[0]["price"] == 12.0
