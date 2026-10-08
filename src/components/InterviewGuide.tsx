import React, { useState } from 'react';
import { BookOpen, Copy, Check, MessageSquare, Shield, CheckCircle2, Award, Sparkles } from 'lucide-react';

export const InterviewGuide: React.FC = () => {
  const [copiedBullets, setCopiedBullets] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(0);

  const resumeBullets = [
    "Engineered an automated REST API to MySQL ETL pipeline in Python and pandas, extracting nested JSON data across paginated endpoints with exponential backoff retries, request session pooling, and rate-limit handling.",
    "Architected a 3NF relational database schema in MySQL with idempotent upsert loading (ON DUPLICATE KEY UPDATE), guaranteeing duplicate-free incremental syncs and maintaining referential integrity across 5 parent and child entities.",
    "Implemented an automated pre-load data quality validation framework and structured rotating logging, enforcing primary key uniqueness, non-null constraints, and range bounds to safely quarantine anomalous records before database ingestion.",
  ];

  const handleCopyBullets = () => {
    navigator.clipboard.writeText(resumeBullets.map((b) => `• ${b}`).join('\n\n'));
    setCopiedBullets(true);
    setTimeout(() => setCopiedBullets(false), 2000);
  };

  const interviewQuestions = [
    {
      question: "How did you ensure that re-running this pipeline does not create duplicate records?",
      answer:
        "I enforced idempotency at two key layers. First, during the pandas transformation phase, I deduplicate incoming batches on the business primary key (`id`) and the unique `sku` identifier, retaining the latest record. Second, at the MySQL database load layer, I utilize `INSERT INTO products ... ON DUPLICATE KEY UPDATE` instead of naive appends or blind deletes. If a product record already exists, MySQL safely updates the mutable attributes (e.g. current stock, price, discount percentage, rating, updated timestamp) in place without raising key collision errors. For the child `product_reviews` table, I implemented `INSERT IGNORE` anchored on a composite unique constraint `(product_id, reviewer_email, review_date)`. As a result, the pipeline can be executed on any schedule without generating duplicate rows.",
    },
    {
      question: "Why did you choose pandas for data transformation instead of PySpark?",
      answer:
        "I evaluated the tool against data velocity and volume. This e-commerce catalog API yields thousands to tens of thousands of records per sync cycle. For datasets under several million records, running pandas in-memory on a single Python worker is orders of magnitude faster and significantly more cost-effective: it eliminates JVM overhead, cluster spin-up latency, distributed network shuffling, and cluster node costs. If the workload scaled to hundreds of gigabytes per hour across streaming transaction streams, I would refactor the extraction and transformation stages into Apache Spark or PySpark running on Databricks or Amazon EMR. Choosing the right tool for the actual scale demonstrates pragmatic engineering.",
    },
    {
      question: "How does the pipeline handle API rate limiting and upstream network instability?",
      answer:
        "The HTTP client uses `requests.Session` wrapped with an `HTTPAdapter` configured with `urllib3.util.Retry`. It applies exponential backoff with a 1.5 factor across transient status codes (429, 500, 502, 503, 504) for up to 3 automated retries. If the upstream API returns an HTTP 429 Too Many Requests response with a `Retry-After` header, the client extracts the header value and pauses execution accordingly before retrying. Additionally, a strict 15-second per-request timeout prevents thread blockage in the event of upstream socket hangs.",
    },
    {
      question: "What happens if MySQL fails midway through a 1,000-record batch load?",
      answer:
        "The loader uses SQLAlchemy 2.0 with context-managed transactions (`with engine.begin() as conn:`). If a network disconnect, disk quota error, or deadlock occurs on record 500, SQLAlchemy triggers an automatic rollback of the uncommitted transaction block, ensuring the database is not left in an inconsistent partial state. Furthermore, the engine is configured with `pool_pre_ping=True` and `pool_recycle=3600`, which validates connection liveness before checking out a connection from the pool, preventing broken-pipe errors.",
    },
    {
      question: "How do you detect and guard against API schema drift?",
      answer:
        "I designed a two-stage validation barrier. Stage 1 is the `RawDataValidator`, which validates incoming JSON payloads directly before DataFrame initialization, confirming that required contract fields (`id`, `title`, `price`, `category`) exist and conform to expected primitive datatypes. Malformed records are diverted into a quarantine structure rather than crashing the pipeline. Stage 2 is the `DataQualityChecker`, which runs 8 automated pre-load assertions covering primary key uniqueness, numerical boundaries (price > 0), domain bounds (rating between 0 and 5), and cross-table foreign key referential integrity. If any CRITICAL check fails, the pipeline aborts immediately before any database mutations occur.",
    },
  ];

  return (
    <div className="space-y-6">
      
      {/* Intro Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xs">
        <h1 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-cyan-400" />
          <span>Junior Data Engineer: Resume Bullets & Interview Defense</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Everything you need to showcase this project on your resume and confidently defend its architecture, trade-offs, and failure handling in technical interviews.
        </p>
      </div>

      {/* Section 1: Exact Resume Bullets */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <span className="text-xs font-mono text-cyan-400 uppercase font-semibold">Resume Content</span>
            <h2 className="text-base font-bold text-slate-100 mt-0.5">
              Production-Grade Resume Bullet Points (Ready to Paste)
            </h2>
          </div>

          <button
            onClick={handleCopyBullets}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors shadow-xs self-start sm:self-auto"
          >
            {copiedBullets ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedBullets ? 'Copied to Clipboard' : 'Copy All Bullets'}</span>
          </button>
        </div>

        <div className="space-y-3">
          {resumeBullets.map((bullet, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/80 text-xs text-slate-200 leading-relaxed font-sans flex items-start gap-3"
            >
              <div className="w-5 h-5 rounded bg-cyan-950 text-cyan-400 flex items-center justify-center shrink-0 border border-cyan-800/80 text-[11px] font-bold mt-0.5">
                {idx + 1}
              </div>
              <p className="flex-1">{bullet}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Section 2: 60-Second Interview Elevator Pitch */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-slate-100">
            60-Second Elevator Pitch: "Walk me through this project"
          </h2>
        </div>

        <div className="p-4 rounded-lg border border-cyan-900/40 bg-cyan-950/20 text-xs text-slate-300 leading-relaxed space-y-2.5 font-sans">
          <p>
            "I built an end-to-end data pipeline in Python that extracts nested e-commerce catalog records from an external REST API, cleans and validates the data with pandas, and idempotently syncs it into a normalized MySQL relational database."
          </p>
          <p>
            "Because real-world third-party APIs often fail or throttle, I designed the client with connection pooling, configurable timeouts, and exponential backoff retry logic that handles 429 rate limits and 5xx transient server drops. I implemented contract validation to quarantine corrupt payloads, followed by pandas transformations that flatten nested dimensions, standardize field names to snake_case, and compute derived financial metrics like discounted pricing and inventory risk statuses."
          </p>
          <p>
            "Before writing anything to MySQL, an automated suite of 8 data quality checks evaluates non-null constraints, price boundaries, and referential integrity, safely aborting if critical rules fail. Finally, using SQLAlchemy and MySQL upsert semantics (<code>ON DUPLICATE KEY UPDATE</code>), the pipeline is fully idempotent—meaning it can run repeatedly on schedule without creating duplicates or unique constraint conflicts."
          </p>
        </div>
      </div>

      {/* Section 3: Technical Interview Q&A Deep Dive */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
        <div>
          <span className="text-xs font-mono text-cyan-400 uppercase font-semibold">Technical Deep Dive</span>
          <h2 className="text-base font-bold text-slate-100 mt-0.5">
            Key Interview Questions & Senior-Level Answers
          </h2>
        </div>

        <div className="space-y-3">
          {interviewQuestions.map((item, idx) => {
            const isOpen = activeFaq === idx;
            return (
              <div
                key={idx}
                className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950 transition-colors"
              >
                <button
                  onClick={() => setActiveFaq(isOpen ? null : idx)}
                  className="w-full p-3.5 text-left text-xs font-semibold text-slate-200 flex items-center justify-between hover:bg-slate-900/60 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-cyan-400 font-mono">Q{idx + 1}:</span>
                    <span>{item.question}</span>
                  </span>
                  <span className="text-slate-400 font-mono text-sm ml-2">{isOpen ? '−' : '+'}</span>
                </button>

                {isOpen && (
                  <div className="p-4 pt-1 text-xs text-slate-300 leading-relaxed border-t border-slate-800/80 font-sans bg-slate-900/30">
                    <p>{item.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};
