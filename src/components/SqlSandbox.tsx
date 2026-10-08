import React, { useState } from 'react';
import { Database, Play, Copy, Check, Terminal, FileText } from 'lucide-react';
import { PipelineExecutionResult } from '../services/pipelineEngine';

interface SqlSandboxProps {
  data: PipelineExecutionResult | null;
}

interface PresetQuery {
  id: string;
  title: string;
  description: string;
  sql: string;
}

export const SqlSandbox: React.FC<SqlSandboxProps> = ({ data }) => {
  const presetQueries: PresetQuery[] = [
    {
      id: 'query-valuation',
      title: 'Category Inventory & Valuation Summary',
      description: 'Aggregates stock units, average pricing, total potential retail inventory vs discounted value per category.',
      sql: `SELECT 
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
ORDER BY discounted_inventory_value DESC;`,
    },
    {
      id: 'query-lowstock',
      title: 'Low-Stock High-Rating Replenishment Alert',
      description: 'Identifies high-performing items (Rating >= 3.8) currently running out of stock (Stock <= 15).',
      sql: `SELECT 
    p.product_id,
    p.sku,
    p.title,
    p.category_code,
    p.stock,
    p.stock_status,
    p.rating,
    p.price,
    p.discount_percentage
FROM products p
WHERE p.rating >= 3.80 AND p.stock <= 15
ORDER BY p.rating DESC, p.stock ASC;`,
    },
    {
      id: 'query-dimensions',
      title: 'Average Volumetric Density per Category',
      description: 'Analyzes spatial packaging metrics by computing average box volume and package weight.',
      sql: `SELECT 
    p.category_code,
    ROUND(AVG(d.width_cm), 1) AS avg_width_cm,
    ROUND(AVG(d.height_cm), 1) AS avg_height_cm,
    ROUND(AVG(d.depth_cm), 1) AS avg_depth_cm,
    ROUND(AVG(d.volume_cm3), 1) AS avg_volume_cm3,
    ROUND(AVG(p.weight_grams), 1) AS avg_weight_grams
FROM products p
JOIN product_dimensions d ON p.product_id = d.product_id
GROUP BY p.category_code
ORDER BY avg_volume_cm3 DESC;`,
    },
    {
      id: 'query-audit',
      title: 'ETL Pipeline Run Audit Log Telemetry',
      description: 'Inspects operational logs to monitor execution durations and record counts across runs.',
      sql: `SELECT 
    run_id,
    pipeline_name,
    status,
    records_extracted,
    records_transformed,
    records_inserted,
    dq_passed_count,
    execution_duration_sec,
    started_at
FROM etl_audit_log
ORDER BY started_at DESC
LIMIT 5;`,
    },
  ];

  const [selectedQueryId, setSelectedQueryId] = useState<string>(presetQueries[0].id);
  const [activeSql, setActiveSql] = useState<string>(presetQueries[0].sql);
  const [copiedSql, setCopiedSql] = useState(false);
  const [queryOutput, setQueryOutput] = useState<{ columns: string[]; rows: any[] } | null>(null);

  const handleSelectQuery = (q: PresetQuery) => {
    setSelectedQueryId(q.id);
    setActiveSql(q.sql);
    executeClientSql(q.id);
  };

  const executeClientSql = (queryId: string = selectedQueryId) => {
    if (!data) return;

    if (queryId === 'query-valuation') {
      const categoryMap = new Map<string, { name: string; skus: number; stock: number; priceSum: number; discSum: number; discVal: number; retailVal: number; discPctSum: number }>();

      data.categories.forEach((c) => {
        categoryMap.set(c.category_code, {
          name: c.category_name,
          skus: 0,
          stock: 0,
          priceSum: 0,
          discSum: 0,
          discVal: 0,
          retailVal: 0,
          discPctSum: 0,
        });
      });

      data.transformedProducts.forEach((p) => {
        let entry = categoryMap.get(p.category_code);
        if (!entry) {
          entry = {
            name: p.category_code,
            skus: 0,
            stock: 0,
            priceSum: 0,
            discSum: 0,
            discVal: 0,
            retailVal: 0,
            discPctSum: 0,
          };
          categoryMap.set(p.category_code, entry);
        }
        entry.skus++;
        entry.stock += p.stock;
        entry.priceSum += p.price;
        entry.discPctSum += p.discount_percentage;
        entry.retailVal += p.price * p.stock;
        entry.discVal += p.discounted_price * p.stock;
      });

      const rows: any[] = [];
      categoryMap.forEach((val) => {
        if (val.skus > 0) {
          rows.push({
            category_name: val.name,
            sku_count: val.skus,
            total_inventory_units: val.stock,
            avg_retail_price: `$${(val.priceSum / val.skus).toFixed(2)}`,
            avg_discount_pct: `${(val.discPctSum / val.skus).toFixed(1)}%`,
            total_potential_inventory_value: `$${val.retailVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            discounted_inventory_value: `$${val.discVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          });
        }
      });

      rows.sort((a, b) => {
        const valA = parseFloat(a.discounted_inventory_value.replace(/[^0-9.-]+/g, ''));
        const valB = parseFloat(b.discounted_inventory_value.replace(/[^0-9.-]+/g, ''));
        return valB - valA;
      });

      setQueryOutput({
        columns: [
          'category_name',
          'sku_count',
          'total_inventory_units',
          'avg_retail_price',
          'avg_discount_pct',
          'total_potential_inventory_value',
          'discounted_inventory_value',
        ],
        rows,
      });
    } else if (queryId === 'query-lowstock') {
      const filtered = data.transformedProducts
        .filter((p) => p.rating >= 3.8 && p.stock <= 15)
        .sort((a, b) => b.rating - a.rating);

      setQueryOutput({
        columns: ['product_id', 'sku', 'title', 'category_code', 'stock', 'stock_status', 'rating', 'price', 'discount_percentage'],
        rows: filtered.map((p) => ({
          product_id: p.product_id,
          sku: p.sku,
          title: p.title,
          category_code: p.category_code,
          stock: p.stock,
          stock_status: p.stock_status,
          rating: `★ ${p.rating.toFixed(2)}`,
          price: `$${p.price.toFixed(2)}`,
          discount_percentage: `${p.discount_percentage}%`,
        })),
      });
    } else if (queryId === 'query-dimensions') {
      const dimMap = new Map<number, any>();
      data.dimensions.forEach((d) => dimMap.set(d.product_id, d));

      const catMap = new Map<string, { count: number; w: number; h: number; dp: number; vol: number; wt: number }>();
      data.transformedProducts.forEach((p) => {
        const d = dimMap.get(p.product_id);
        if (d) {
          const c = catMap.get(p.category_code) || { count: 0, w: 0, h: 0, dp: 0, vol: 0, wt: 0 };
          c.count++;
          c.w += d.width_cm;
          c.h += d.height_cm;
          c.dp += d.depth_cm;
          c.vol += d.volume_cm3;
          c.wt += p.weight_grams || 0;
          catMap.set(p.category_code, c);
        }
      });

      const rows: any[] = [];
      catMap.forEach((v, cat) => {
        rows.push({
          category_code: cat,
          avg_width_cm: (v.w / v.count).toFixed(1),
          avg_height_cm: (v.h / v.count).toFixed(1),
          avg_depth_cm: (v.dp / v.count).toFixed(1),
          avg_volume_cm3: (v.vol / v.count).toFixed(1),
          avg_weight_grams: (v.wt / v.count).toFixed(1),
        });
      });
      rows.sort((a, b) => parseFloat(b.avg_volume_cm3) - parseFloat(a.avg_volume_cm3));

      setQueryOutput({
        columns: ['category_code', 'avg_width_cm', 'avg_height_cm', 'avg_depth_cm', 'avg_volume_cm3', 'avg_weight_grams'],
        rows,
      });
    } else if (queryId === 'query-audit') {
      const a = data.auditRecord;
      setQueryOutput({
        columns: ['run_id', 'pipeline_name', 'status', 'records_extracted', 'records_transformed', 'records_inserted', 'dq_passed_count', 'execution_duration_sec', 'started_at'],
        rows: [
          {
            run_id: a.run_id,
            pipeline_name: a.pipeline_name,
            status: a.status,
            records_extracted: a.records_extracted,
            records_transformed: a.records_transformed,
            records_inserted: a.records_inserted,
            dq_passed_count: a.dq_passed_count,
            execution_duration_sec: `${a.execution_duration_sec}s`,
            started_at: a.started_at,
          },
        ],
      });
    }
  };

  React.useEffect(() => {
    if (data && !queryOutput) {
      executeClientSql(selectedQueryId);
    }
  }, [data]);

  const handleCopy = () => {
    navigator.clipboard.writeText(activeSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div className="space-y-6">
      
      {/* Sandbox Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xs">
        <h1 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <Database className="w-5 h-5 text-cyan-400" />
          <span>SQL Analytics & Post-Load Verification Sandbox</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Execute realistic business intelligence and post-load validation queries directly against the ingested dataset.
          Demonstrates how data engineers verify relational accuracy and empower business analysts.
        </p>
      </div>

      {/* Preset Query Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {presetQueries.map((q) => {
          const isSelected = selectedQueryId === q.id;
          return (
            <button
              key={q.id}
              onClick={() => handleSelectQuery(q)}
              className={`p-3.5 rounded-lg border text-left transition-all ${
                isSelected
                  ? 'border-cyan-500 bg-cyan-950/40 text-slate-100 shadow-sm'
                  : 'border-slate-800 bg-slate-900 hover:border-slate-700 text-slate-300'
              }`}
            >
              <div className="text-xs font-semibold">{q.title}</div>
              <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">{q.description}</div>
            </button>
          );
        })}
      </div>

      {/* SQL Editor / Code View */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-mono text-slate-300 font-medium">sql/analytical_queries.sql</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-300 hover:text-white rounded border border-slate-800 hover:border-slate-700 bg-slate-900 transition-colors"
            >
              {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              <span>{copiedSql ? 'Copied' : 'Copy SQL'}</span>
            </button>

            <button
              onClick={() => executeClientSql(selectedQueryId)}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded shadow-xs transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-slate-950" />
              <span>Execute SQL</span>
            </button>
          </div>
        </div>

        <div className="p-4 font-mono text-xs text-slate-200 overflow-x-auto bg-slate-950/90">
          <pre className="text-cyan-300/90">{activeSql}</pre>
        </div>
      </div>

      {/* Query Result Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="border-b border-slate-800 bg-slate-950 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <FileText className="w-4 h-4 text-emerald-400" />
            <span>Query Results</span>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {queryOutput ? `${queryOutput.rows.length} rows returned` : 'Ready to run'}
          </span>
        </div>

        <div className="overflow-x-auto max-h-[380px] p-2 bg-slate-900/40">
          {queryOutput && queryOutput.rows.length > 0 ? (
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  {queryOutput.columns.map((col) => (
                    <th key={col} className="p-2.5 font-semibold whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {queryOutput.rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                    {queryOutput.columns.map((col) => (
                      <td key={col} className="p-2.5 whitespace-nowrap">
                        {row[col] !== undefined ? String(row[col]) : 'NULL'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-12 text-center text-xs text-slate-400 font-mono">
              Execute a query above to inspect tabular outputs.
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
