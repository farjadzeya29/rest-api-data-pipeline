import React, { useState } from 'react';
import { 
  Network, ArrowRight, ShieldCheck, Database, Server, RefreshCw, 
  FileCode, Layers, AlertCircle, CheckCircle2, ChevronRight, HelpCircle
} from 'lucide-react';

interface StageDetail {
  id: string;
  name: string;
  badge: string;
  tech: string;
  description: string;
  keyMechanics: string[];
  failureModes: string[];
  interviewDefense: string;
}

export const ArchitectureView: React.FC = () => {
  const [selectedStageId, setSelectedStageId] = useState<string>('stage-client');

  const stages: StageDetail[] = [
    {
      id: 'stage-api',
      name: 'External REST API',
      badge: 'Source Tier',
      tech: 'DummyJSON /products (HTTP GET)',
      description: 'Public e-commerce product catalog providing rich nested JSON objects, paginated with skip and limit query parameters.',
      keyMechanics: [
        'Endpoint: https://dummyjson.com/products?limit=30&skip=0',
        'Complex response payload including scalar attributes, nested 1:1 dimensions, and 1:N customer review arrays.',
        'Meta headers returning catalog total, current skip offset, and limit ceiling.',
      ],
      failureModes: [
        'Upstream HTTP 429 Too Many Requests due to burst querying.',
        'Transient HTTP 500/502/503 server or gateway outages.',
        'Unexpected schema drift (missing fields, unexpected data types).',
      ],
      interviewDefense: 'In production, third-party APIs are external dependencies outside your control. You cannot assume high availability or stable schema contracts. Designing extraction requires deterministic pagination, idempotency keys, and boundary checks.',
    },
    {
      id: 'stage-client',
      name: 'Python API Client & Extractor',
      badge: 'Ingestion Tier',
      tech: 'requests.Session, urllib3.util.Retry, Extractor',
      description: 'Production-ready HTTP client maintaining persistent TCP session pools, exponential backoff with jitter, configurable timeouts, and pagination loop.',
      keyMechanics: [
        'Session pooling with HTTPAdapter avoids repeatedly opening TLS/TCP handshakes.',
        'Configured Retry strategy on status codes [429, 500, 502, 503, 504] with 1.5 backoff factor.',
        'Automatic extraction of Retry-After headers when encountering rate limits.',
        'Strict 15-second per-request timeout prevents hung worker threads.',
      ],
      failureModes: [
        'Socket timeout on slow responses (caught via APITimeoutError).',
        'Malformed non-JSON responses e.g. HTML error pages (caught via APIMalformedJSONError).',
        'Infinite loops caused by broken upstream pagination counters.',
      ],
      interviewDefense: 'I decoupled the low-level HTTP transport client (api_client.py) from the high-level pagination traversal (extract.py). This separation of concerns allows swapping APIs or authentication mechanisms (OAuth, API Keys, MTLS) without touching business logic.',
    },
    {
      id: 'stage-validator',
      name: 'Raw Contract Validation',
      badge: 'Gatekeeper Tier',
      tech: 'RawDataValidator (Python)',
      description: 'Inspects raw JSON dictionary payloads before DataFrame instantiation to catch severe contract violations early and isolate corrupt items.',
      keyMechanics: [
        'Enforces non-nullable required schema attributes: id, title, price, category.',
        'Validates primitive types and sanity constraints (id > 0, price >= 0).',
        'Quarantine pattern: segregrates bad records into a quarantine structure rather than terminating ingestion completely.',
      ],
      failureModes: [
        'API returns empty body or missing products envelope.',
        'Records with missing primary business keys (id is null).',
      ],
      interviewDefense: 'Validating data before passing it into pandas prevents expensive memory bloat from corrupt records and gives exact line-level traceability of where contract drift occurred.',
    },
    {
      id: 'stage-transform',
      name: 'Pandas Normalization & Transformation',
      badge: 'Processing Tier',
      tech: 'pandas 2.2, numpy, regex',
      description: 'Flattens nested objects, standardizes column nomenclature to snake_case, calculates derived financial metrics, and decomposes payload into 5 relational tables.',
      keyMechanics: [
        'Decomposes single JSON record into 5 distinct DataFrames: products, categories, brands, product_dimensions, product_reviews.',
        'Calculates derived business fields: discounted_price = price * (1 - discount/100) and stock_status (OUT_OF_STOCK, LOW_STOCK, IN_STOCK).',
        'Flattens nested dimensions object into width_cm, height_cm, depth_cm and calculates volume_cm3.',
        'Deduplicates records on business primary key keeping latest occurrence.',
      ],
      failureModes: [
        'Type coercion errors on numeric strings (handled with pd.to_numeric(errors="coerce")).',
        'Missing keys in nested sub-dictionaries (handled with safe .get() defaults).',
      ],
      interviewDefense: 'Why pandas over PySpark? For datasets under several million records, pandas executes in-memory on a single node without cluster spin-up latency, JVM overhead, or distributed shuffle costs. It is the optimal tool for mid-sized batch ingestion.',
    },
    {
      id: 'stage-dq',
      name: 'Automated Data Quality Suite',
      badge: 'Governance Tier',
      tech: 'DataQualityChecker (CRITICAL vs WARNING)',
      description: 'Comprehensive pre-load test assertions verifying uniqueness, foreign key consistency, null tolerances, and numerical value boundaries.',
      keyMechanics: [
        'Evaluates 8 pre-load automated assertions across all transformed DataFrames.',
        'Severity classification: CRITICAL halts pipeline safely before any database mutation; WARNING logs diagnostics.',
        'Verifies referential integrity: ensures every product category code exists in the category dimension DataFrame before loading.',
      ],
      failureModes: [
        'Duplicate primary keys or SKUs generated during ingestion.',
        'Negative prices or ratings outside valid domain bounds [0, 5].',
      ],
      interviewDefense: 'The golden rule of data engineering is "Never corrupt downstream systems with bad data." Failing fast at the data quality layer protects business analytics and dashboards from reporting incorrect numbers.',
    },
    {
      id: 'stage-load',
      name: 'Idempotent MySQL Loader',
      badge: 'Persistence Tier',
      tech: 'MySQL 8.0, SQLAlchemy 2.0, PyMySQL',
      description: 'Executes idempotent relational upserts using INSERT ... ON DUPLICATE KEY UPDATE, resolves foreign keys, and logs run metadata in etl_audit_log.',
      keyMechanics: [
        'Idempotent upsert logic guarantees pipeline can be re-run indefinitely without duplicating rows.',
        'Ordered loading: syncs categories and brands first, maps generated surrogate IDs, then loads products, dimensions, and reviews.',
        'Transaction management via engine.begin() ensures atomic commit or automatic rollback on exception.',
        'Audit logging writes execution telemetry, row counts, and duration to etl_audit_log.',
      ],
      failureModes: [
        'Database connection drop during long batch (handled by connection pool pre-ping and retry).',
        'Foreign key constraint violations (mitigated by strict dependency sequencing).',
      ],
      interviewDefense: 'Idempotency is paramount. If an airflow scheduler or cron job triggers twice by mistake, or if a pipeline retries after a partial network failure, ON DUPLICATE KEY UPDATE guarantees that existing rows are safely updated rather than rejected with duplicate key errors.',
    },
  ];

  const selectedStage = stages.find((s) => s.id === selectedStageId) || stages[0];

  return (
    <div className="space-y-6">
      
      {/* Intro Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xs">
        <h1 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <Network className="w-5 h-5 text-cyan-400" />
          <span>End-to-End Pipeline Architecture & Stage Deep Dive</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Visual representation of data progression from public REST endpoints to relational 3NF MySQL schemas.
          Click any pipeline node to inspect technical implementation, failure mitigations, and interview defense strategies.
        </p>
      </div>

      {/* Visual Pipeline Flowchart */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 overflow-x-auto shadow-xs">
        <div className="flex items-center justify-between min-w-[760px] gap-2">
          {stages.map((stage, idx) => {
            const isSelected = stage.id === selectedStageId;
            return (
              <React.Fragment key={stage.id}>
                <button
                  onClick={() => setSelectedStageId(stage.id)}
                  className={`flex-1 p-3.5 rounded-lg border text-left transition-all relative ${
                    isSelected
                      ? 'border-cyan-500 bg-cyan-950/40 text-slate-100 shadow-md ring-1 ring-cyan-500/50'
                      : 'border-slate-800 bg-slate-950 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-cyan-400 uppercase font-semibold">
                      {stage.badge}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      0{idx + 1}
                    </span>
                  </div>

                  <div className="text-xs font-semibold mt-1.5 text-slate-100 leading-snug">
                    {stage.name}
                  </div>

                  <div className="text-[11px] text-slate-400 mt-1 truncate font-mono">
                    {stage.tech.split(',')[0]}
                  </div>

                  {isSelected && (
                    <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-cyan-500" />
                  )}
                </button>

                {idx < stages.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-slate-600 shrink-0 mx-1" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Selected Stage Deep Dive Panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-6">
        
        {/* Stage Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider font-semibold">
                {selectedStage.badge}
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-xs text-slate-400 font-mono">{selectedStage.tech}</span>
            </div>
            <h2 className="text-xl font-bold text-slate-100 mt-1">
              {selectedStage.name}
            </h2>
          </div>
          <div className="text-xs text-slate-400 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-md font-mono self-start sm:self-auto">
            Design Decision Reference
          </div>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed">
          {selectedStage.description}
        </p>

        {/* 3 Column Deep Dive Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          
          {/* Card 1: Implementation Mechanics */}
          <div className="p-4 rounded-lg border border-slate-800 bg-slate-950 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
              <CheckCircle2 className="w-4 h-4 text-cyan-400" />
              <span>Core Mechanics</span>
            </div>
            <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside marker:text-cyan-500">
              {selectedStage.keyMechanics.map((mech, i) => (
                <li key={i} className="leading-relaxed">{mech}</li>
              ))}
            </ul>
          </div>

          {/* Card 2: Failure Modes & Mitigations */}
          <div className="p-4 rounded-lg border border-slate-800 bg-slate-950 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400" />
              <span>Failure Modes & Mitigations</span>
            </div>
            <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside marker:text-rose-500">
              {selectedStage.failureModes.map((mode, i) => (
                <li key={i} className="leading-relaxed">{mode}</li>
              ))}
            </ul>
          </div>

          {/* Card 3: Interview Talking Point */}
          <div className="p-4 rounded-lg border border-cyan-900/60 bg-cyan-950/20 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
              <HelpCircle className="w-4 h-4 text-cyan-400" />
              <span>Interview Defense & Rationale</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed italic">
              "{selectedStage.interviewDefense}"
            </p>
          </div>

        </div>

      </div>

    </div>
  );
};
