import React, { useState } from 'react';
import { Table, Key, Copy, Check, Link2, Database, Shield } from 'lucide-react';

interface ColumnDef {
  name: string;
  type: string;
  isPk?: boolean;
  isFk?: boolean;
  fkTarget?: string;
  isIndexed?: boolean;
  isNullable?: boolean;
  description?: string;
}

interface TableDef {
  name: string;
  category: 'core' | 'dimension' | 'extension' | 'child' | 'audit';
  description: string;
  columns: ColumnDef[];
}

export const SchemaErdView: React.FC = () => {
  const [copiedDdl, setCopiedDdl] = useState(false);
  const [activeTableFilter, setActiveTableFilter] = useState<string>('all');

  const tables: TableDef[] = [
    {
      name: 'categories',
      category: 'dimension',
      description: 'Normalized lookup table for product categories (1:N with products)',
      columns: [
        { name: 'category_id', type: 'INT AUTO_INCREMENT', isPk: true, description: 'Surrogate primary key' },
        { name: 'category_code', type: 'VARCHAR(100) UNIQUE', isIndexed: true, description: 'Slugified business key (e.g. beauty, groceries)' },
        { name: 'category_name', type: 'VARCHAR(150)', description: 'Human-readable title case name' },
        { name: 'created_at', type: 'TIMESTAMP', description: 'Record creation timestamp' },
        { name: 'updated_at', type: 'TIMESTAMP', description: 'Record update timestamp' },
      ],
    },
    {
      name: 'brands',
      category: 'dimension',
      description: 'Normalized lookup table for brand entities (1:N with products)',
      columns: [
        { name: 'brand_id', type: 'INT AUTO_INCREMENT', isPk: true, description: 'Surrogate primary key' },
        { name: 'brand_name', type: 'VARCHAR(150) UNIQUE', isIndexed: true, description: 'Unique brand nomenclature' },
        { name: 'created_at', type: 'TIMESTAMP', description: 'Record creation timestamp' },
      ],
    },
    {
      name: 'products',
      category: 'core',
      description: 'Core central entity/fact table containing product catalog specifications and calculated metrics',
      columns: [
        { name: 'product_id', type: 'INT', isPk: true, description: 'Business primary key preserved from API' },
        { name: 'sku', type: 'VARCHAR(100) UNIQUE', isIndexed: true, description: 'Stock keeping unit identifier' },
        { name: 'title', type: 'VARCHAR(255)', description: 'Product title string' },
        { name: 'description', type: 'TEXT', isNullable: true, description: 'Product detailed description' },
        { name: 'category_id', type: 'INT', isFk: true, fkTarget: 'categories.category_id', isIndexed: true, description: 'Foreign key to categories' },
        { name: 'brand_id', type: 'INT', isFk: true, fkTarget: 'brands.brand_id', isIndexed: true, isNullable: true, description: 'Foreign key to brands' },
        { name: 'price', type: 'DECIMAL(10, 2)', isIndexed: true, description: 'Base retail price in USD' },
        { name: 'discount_percentage', type: 'DECIMAL(5, 2)', description: 'Upstream discount percentage' },
        { name: 'discounted_price', type: 'DECIMAL(10, 2)', description: 'Derived metric: price * (1 - discount/100)' },
        { name: 'rating', type: 'DECIMAL(3, 2)', isIndexed: true, description: 'Average customer rating (0.00-5.00)' },
        { name: 'stock', type: 'INT', description: 'Available warehouse inventory count' },
        { name: 'stock_status', type: 'VARCHAR(30)', isIndexed: true, description: 'Derived: OUT_OF_STOCK, LOW_STOCK, IN_STOCK' },
        { name: 'weight_grams', type: 'DECIMAL(8, 2)', isNullable: true, description: 'Package weight in grams' },
        { name: 'created_at', type: 'TIMESTAMP', description: 'Initial insert timestamp' },
        { name: 'updated_at', type: 'TIMESTAMP', description: 'Updated on duplicate key timestamp' },
        { name: 'last_synced_at', type: 'TIMESTAMP', isIndexed: true, description: 'Most recent ETL run timestamp' },
      ],
    },
    {
      name: 'product_dimensions',
      category: 'extension',
      description: '1:1 Extension table storing decomposed physical measurements and derived volume',
      columns: [
        { name: 'product_id', type: 'INT', isPk: true, isFk: true, fkTarget: 'products.product_id (ON DELETE CASCADE)', description: '1:1 Foreign primary key' },
        { name: 'width_cm', type: 'DECIMAL(6, 2)', description: 'Physical width in centimeters' },
        { name: 'height_cm', type: 'DECIMAL(6, 2)', description: 'Physical height in centimeters' },
        { name: 'depth_cm', type: 'DECIMAL(6, 2)', description: 'Physical depth in centimeters' },
        { name: 'volume_cm3', type: 'DECIMAL(10, 2)', description: 'Derived spatial metric: width * height * depth' },
        { name: 'updated_at', type: 'TIMESTAMP', description: 'Timestamp of last modification' },
      ],
    },
    {
      name: 'product_reviews',
      category: 'child',
      description: '1:N Child table storing individual customer product ratings and reviews',
      columns: [
        { name: 'review_id', type: 'INT AUTO_INCREMENT', isPk: true, description: 'Auto-increment primary key' },
        { name: 'product_id', type: 'INT', isFk: true, fkTarget: 'products.product_id (ON DELETE CASCADE)', isIndexed: true, description: 'Parent product foreign key' },
        { name: 'reviewer_name', type: 'VARCHAR(150)', description: 'Reviewer display name' },
        { name: 'reviewer_email', type: 'VARCHAR(255)', description: 'Reviewer email address' },
        { name: 'rating', type: 'INT', isIndexed: true, description: 'Star rating (1-5)' },
        { name: 'comment', type: 'TEXT', description: 'Feedback review text' },
        { name: 'review_date', type: 'DATETIME', isIndexed: true, description: 'Original post date and time' },
      ],
    },
    {
      name: 'etl_audit_log',
      category: 'audit',
      description: 'Operational telemetry log tracking ETL executions, row counts, and health',
      columns: [
        { name: 'audit_id', type: 'INT AUTO_INCREMENT', isPk: true, description: 'Log entry sequential ID' },
        { name: 'run_id', type: 'VARCHAR(64) UNIQUE', isIndexed: true, description: 'Deterministic run execution identifier' },
        { name: 'pipeline_name', type: 'VARCHAR(100)', description: 'Name of pipeline execution process' },
        { name: 'status', type: "ENUM('RUNNING','SUCCESS','FAILED')", isIndexed: true, description: 'Run completion status' },
        { name: 'records_extracted', type: 'INT', description: 'Number of items pulled from API' },
        { name: 'records_transformed', type: 'INT', description: 'Number of rows prepared for loading' },
        { name: 'records_inserted', type: 'INT', description: 'Count of new records persisted' },
        { name: 'execution_duration_sec', type: 'DECIMAL(8, 3)', description: 'Total wall clock seconds' },
        { name: 'started_at', type: 'TIMESTAMP', isIndexed: true, description: 'Execution start time' },
        { name: 'completed_at', type: 'TIMESTAMP', isNullable: true, description: 'Execution finish time' },
      ],
    },
  ];

  const filteredTables = tables.filter((t) => {
    if (activeTableFilter === 'all') return true;
    return t.category === activeTableFilter;
  });

  const handleCopyDdl = () => {
    const ddl = `-- MySQL 8.0 DDL Schema
CREATE DATABASE IF NOT EXISTS ecommerce_dw;
USE ecommerce_dw;

-- Categories (Dimension)
CREATE TABLE IF NOT EXISTS categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    category_code VARCHAR(100) NOT NULL UNIQUE,
    category_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cat_code (category_code)
);

-- Brands (Dimension)
CREATE TABLE IF NOT EXISTS brands (
    brand_id INT AUTO_INCREMENT PRIMARY KEY,
    brand_name VARCHAR(150) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products (Core Fact)
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

-- Product Dimensions (1:1 Extension)
CREATE TABLE IF NOT EXISTS product_dimensions (
    product_id INT PRIMARY KEY,
    width_cm DECIMAL(6, 2) NOT NULL,
    height_cm DECIMAL(6, 2) NOT NULL,
    depth_cm DECIMAL(6, 2) NOT NULL,
    volume_cm3 DECIMAL(10, 2) NOT NULL,
    CONSTRAINT fk_dim_prod FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);

-- Product Reviews (1:N Child)
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

-- ETL Audit Log
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
);`;
    navigator.clipboard.writeText(ddl);
    setCopiedDdl(true);
    setTimeout(() => setCopiedDdl(false), 2000);
  };

  return (
    <div className="space-y-6">
      
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Database className="w-5 h-5 text-cyan-400" />
            <span>Relational Schema (ERD) & 3NF Data Model</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Normalized 3rd Normal Form (3NF) relational architecture in MySQL 8.0 with foreign keys, indexes, and ON DELETE CASCADE constraints.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyDdl}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            {copiedDdl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
            <span>{copiedDdl ? 'DDL Copied' : 'Copy Schema DDL'}</span>
          </button>
        </div>
      </div>

      {/* Relational Table Filter */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-slate-400 font-medium">Filter Tables:</span>
        {[
          { id: 'all', label: 'All 6 Tables' },
          { id: 'core', label: 'Core Entity (products)' },
          { id: 'dimension', label: 'Lookup Dimensions (categories, brands)' },
          { id: 'extension', label: '1:1 Extension (dimensions)' },
          { id: 'child', label: '1:N Child (reviews)' },
          { id: 'audit', label: 'Operational (etl_audit_log)' },
        ].map((btn) => (
          <button
            key={btn.id}
            onClick={() => setActiveTableFilter(btn.id)}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
              activeTableFilter === btn.id
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800 font-medium'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Grid of Tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredTables.map((tbl) => (
          <div
            key={tbl.name}
            className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xs flex flex-col"
          >
            {/* Table Header Card */}
            <div className="bg-slate-950/80 border-b border-slate-800 p-3.5 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-slate-100">{tbl.name}</span>
                  <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider">
                    {tbl.category}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{tbl.description}</p>
              </div>
            </div>

            {/* Table Columns List */}
            <div className="p-3 divide-y divide-slate-800/50 flex-1 overflow-y-auto max-h-[380px] font-mono text-xs">
              {tbl.columns.map((col) => (
                <div key={col.name} className="py-2 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {col.isPk ? (
                        <span className="w-4 h-4 rounded bg-amber-950 text-amber-400 text-[9px] font-bold flex items-center justify-center border border-amber-800/80" title="Primary Key">
                          PK
                        </span>
                      ) : col.isFk ? (
                        <span className="w-4 h-4 rounded bg-cyan-950 text-cyan-400 text-[9px] font-bold flex items-center justify-center border border-cyan-800/80" title="Foreign Key">
                          FK
                        </span>
                      ) : (
                        <span className="w-4 h-4" />
                      )}
                      <span className={`font-medium ${col.isPk ? 'text-amber-300' : col.isFk ? 'text-cyan-300' : 'text-slate-200'}`}>
                        {col.name}
                      </span>
                    </div>

                    <span className="text-[11px] text-slate-400">{col.type}</span>
                  </div>

                  {col.description && (
                    <div className="text-[11px] text-slate-400 pl-5.5 font-sans">
                      {col.fkTarget ? (
                        <span className="text-cyan-400/90 font-mono text-[10px]">→ {col.fkTarget}</span>
                      ) : (
                        col.description
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Table Footer */}
            <div className="bg-slate-950/60 border-t border-slate-800 px-3 py-1.5 text-[11px] text-slate-400 flex items-center justify-between font-mono">
              <span>{tbl.columns.length} columns</span>
              <span>InnoDB · utf8mb4</span>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
};
