-- ==============================================================================
-- REST API to MySQL Pipeline - Sample Analytical & Data Validation Queries
-- These queries demonstrate practical business insights and post-load validation.
-- ==============================================================================

USE ecommerce_dw;

-- ------------------------------------------------------------------------------
-- Query 1: Post-Load Reconciliation & Record Count Verification
-- Validates relational consistency between products and child tables
-- ------------------------------------------------------------------------------
SELECT
    (SELECT COUNT(*) FROM products) AS total_products,
    (SELECT COUNT(*) FROM categories) AS total_categories,
    (SELECT COUNT(*) FROM brands) AS total_brands,
    (SELECT COUNT(*) FROM product_dimensions) AS total_dimensions_records,
    (SELECT COUNT(*) FROM product_reviews) AS total_reviews,
    (SELECT COUNT(*) FROM products p LEFT JOIN product_dimensions d ON p.product_id = d.product_id WHERE d.product_id IS NULL) AS products_missing_dimensions;

-- ------------------------------------------------------------------------------
-- Query 2: Category Inventory & Valuation Summary
-- Aggregates stock units, average pricing, total inventory valuation per category
-- ------------------------------------------------------------------------------
SELECT 
    c.category_name,
    COUNT(p.product_id) AS sku_count,
    SUM(p.stock) AS total_inventory_units,
    ROUND(AVG(p.price), 2) AS avg_retail_price,
    ROUND(AVG(p.discount_percentage), 1) AS avg_discount_pct,
    ROUND(SUM(p.price * p.stock), 2) AS total_potential_inventory_value,
    ROUND(SUM(p.discounted_price * p.stock), 2) AS discounted_inventory_value
FROM categories c
JOIN products p ON c.category_id = p.category_id
GROUP BY c.category_id, c.category_name
ORDER BY total_potential_inventory_value DESC;

-- ------------------------------------------------------------------------------
-- Query 3: Low-Stock High-Rating Alert (Inventory Risk Analysis)
-- Identifies critical replenishment needs for high-performing products
-- ------------------------------------------------------------------------------
SELECT 
    p.product_id,
    p.sku,
    p.title,
    c.category_name,
    p.stock,
    p.stock_status,
    p.rating,
    p.price,
    p.discount_percentage,
    COUNT(r.review_id) AS review_count
FROM products p
JOIN categories c ON p.category_id = c.category_id
LEFT JOIN product_reviews r ON p.product_id = r.product_id
WHERE p.rating >= 4.00 
  AND p.stock <= 10
GROUP BY p.product_id, p.sku, p.title, c.category_name, p.stock, p.stock_status, p.rating, p.price, p.discount_percentage
ORDER BY p.rating DESC, p.stock ASC;

-- ------------------------------------------------------------------------------
-- Query 4: Dimensions & Volumetric Density per Category
-- Examines shipping impact by calculating average volume per product category
-- ------------------------------------------------------------------------------
SELECT 
    c.category_name,
    ROUND(AVG(d.width_cm), 1) AS avg_width_cm,
    ROUND(AVG(d.height_cm), 1) AS avg_height_cm,
    ROUND(AVG(d.depth_cm), 1) AS avg_depth_cm,
    ROUND(AVG(d.volume_cm3), 1) AS avg_volume_cm3,
    ROUND(AVG(p.weight_grams), 1) AS avg_weight_grams
FROM categories c
JOIN products p ON c.category_id = p.category_id
JOIN product_dimensions d ON p.product_id = d.product_id
GROUP BY c.category_id, c.category_name
ORDER BY avg_volume_cm3 DESC;

-- ------------------------------------------------------------------------------
-- Query 5: Pipeline Execution Run Audit & Health Check
-- Inspects the operational telemetry and runtime durations of latest ETL runs
-- ------------------------------------------------------------------------------
SELECT 
    run_id,
    pipeline_name,
    status,
    records_extracted,
    records_transformed,
    records_inserted,
    records_updated,
    dq_passed_count,
    dq_failed_count,
    execution_duration_sec,
    started_at,
    completed_at
FROM etl_audit_log
ORDER BY started_at DESC
LIMIT 10;
