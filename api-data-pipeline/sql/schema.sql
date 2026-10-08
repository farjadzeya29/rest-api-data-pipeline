-- ==============================================================================
-- REST API to MySQL Data Pipeline - Relational DDL Schema
-- Database: ecommerce_dw (MySQL 8.0+)
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS ecommerce_dw
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ecommerce_dw;

-- Disable foreign key checks during initialization
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------------------------
-- 1. Dimension: Categories
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(100) NOT NULL UNIQUE,
    category_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cat_code (category_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 2. Dimension: Brands
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brands (
    brand_id INT AUTO_INCREMENT PRIMARY KEY,
    brand_name VARCHAR(150) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_brand_name (brand_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 3. Core Entity: Products
-- ------------------------------------------------------------------------------
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
    warranty_information VARCHAR(255) NULL,
    shipping_information VARCHAR(255) NULL,
    availability_status VARCHAR(100) NULL,
    return_policy VARCHAR(255) NULL,
    minimum_order_quantity INT NOT NULL DEFAULT 1,
    barcode VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_prod_category FOREIGN KEY (category_id)
        REFERENCES categories (category_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_prod_brand FOREIGN KEY (brand_id)
        REFERENCES brands (brand_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
        
    INDEX idx_prod_cat (category_id),
    INDEX idx_prod_brand (brand_id),
    INDEX idx_prod_price (price),
    INDEX idx_prod_rating (rating),
    INDEX idx_prod_stock_status (stock_status),
    INDEX idx_prod_last_synced (last_synced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 4. Sub-Entity: Product Dimensions (1:1 Extension Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_dimensions (
    product_id INT PRIMARY KEY,
    width_cm DECIMAL(6, 2) NOT NULL,
    height_cm DECIMAL(6, 2) NOT NULL,
    depth_cm DECIMAL(6, 2) NOT NULL,
    volume_cm3 DECIMAL(10, 2) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_dimensions_product FOREIGN KEY (product_id)
        REFERENCES products (product_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 5. Child Entity: Product Reviews (1:N Relationship)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    reviewer_name VARCHAR(150) NOT NULL,
    reviewer_email VARCHAR(255) NOT NULL,
    rating INT NOT NULL,
    comment TEXT NOT NULL,
    review_date DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_review_product FOREIGN KEY (product_id)
        REFERENCES products (product_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
        
    INDEX idx_review_prod (product_id),
    INDEX idx_review_date (review_date),
    INDEX idx_review_rating (rating),
    UNIQUE KEY uq_prod_review (product_id, reviewer_email, review_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 6. Operational Metadata: ETL Pipeline Audit Log
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etl_audit_log (
    audit_id INT AUTO_INCREMENT PRIMARY KEY,
    pipeline_name VARCHAR(100) NOT NULL,
    run_id VARCHAR(64) NOT NULL UNIQUE,
    status ENUM('RUNNING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    records_extracted INT NOT NULL DEFAULT 0,
    records_validated INT NOT NULL DEFAULT 0,
    records_transformed INT NOT NULL DEFAULT 0,
    records_inserted INT NOT NULL DEFAULT 0,
    records_updated INT NOT NULL DEFAULT 0,
    dq_passed_count INT NOT NULL DEFAULT 0,
    dq_failed_count INT NOT NULL DEFAULT 0,
    execution_duration_sec DECIMAL(8, 3) NULL,
    error_message TEXT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    INDEX idx_audit_run (run_id),
    INDEX idx_audit_status (status),
    INDEX idx_audit_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
