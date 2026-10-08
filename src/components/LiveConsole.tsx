import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Terminal, RotateCcw, AlertTriangle, CheckCircle, ShieldAlert,
  Layers, ArrowRight, Table, FileJson, CheckSquare, Search, Copy, Check
} from 'lucide-react';
import { 
  LogEntry, PipelineStage, RawProduct, TransformedProduct, 
  TransformedCategory, TransformedDimension, TransformedReview, 
  DQCheckResult, AuditRunRecord 
} from '../types/pipeline';
import { PipelineEngine, SimulationScenario, PipelineExecutionResult } from '../services/pipelineEngine';

interface LiveConsoleProps {
  onRunFinished?: (result: PipelineExecutionResult) => void;
  initialResult?: PipelineExecutionResult | null;
}

export const LiveConsole: React.FC<LiveConsoleProps> = ({ onRunFinished, initialResult }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentStage, setCurrentStage] = useState<PipelineStage>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const [scenario, setScenario] = useState<SimulationScenario>('standard');
  const [batchLimit, setBatchLimit] = useState<number>(30);
  const [logFilter, setLogFilter] = useState<'ALL' | 'INFO' | 'WARNING' | 'ERROR'>('ALL');
  
  // Data Inspector Tab
  const [inspectorTab, setInspectorTab] = useState<'dataframe' | 'raw_json' | 'dq_report' | 'mysql_tables'>('dataframe');
  const [tableSubTab, setTableSubTab] = useState<'products' | 'categories' | 'dimensions' | 'reviews' | 'audit_log'>('products');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedRaw, setCopiedRaw] = useState(false);

  // Execution Results
  const [executionResult, setExecutionResult] = useState<PipelineExecutionResult | null>(initialResult || null);

  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Execute pipeline
  const handleExecute = async (chosenScenario: SimulationScenario = scenario) => {
    setIsRunning(true);
    setLogs([]);
    setCurrentStage('extracting');

    const engine = new PipelineEngine(
      (log) => setLogs((prev) => [...prev, log]),
      (stg) => setCurrentStage(stg)
    );

    try {
      const result = await engine.execute(chosenScenario, batchLimit);
      setExecutionResult(result);
      if (onRunFinished) {
        onRunFinished(result);
      }
    } catch (err: any) {
      console.warn('Execution halted:', err);
    } finally {
      setIsRunning(false);
    }
  };

  // Run on mount if no initial result
  useEffect(() => {
    if (!executionResult && logs.length === 0) {
      handleExecute('standard');
    }
  }, []);

  const filteredLogs = logs.filter((l) => {
    if (logFilter === 'ALL') return true;
    if (logFilter === 'INFO') return l.level === 'INFO';
    if (logFilter === 'WARNING') return l.level === 'WARNING';
    if (logFilter === 'ERROR') return l.level === 'ERROR' || l.level === 'CRITICAL';
    return true;
  });

  const stagesList: { id: PipelineStage; label: string; number: string }[] = [
    { id: 'extracting', label: '1. REST Extraction', number: '01' },
    { id: 'validating', label: '2. Contract Check', number: '02' },
    { id: 'transforming', label: '3. pandas Transform', number: '03' },
    { id: 'checking_dq', label: '4. Data Quality', number: '04' },
    { id: 'loading_db', label: '5. MySQL Upsert', number: '05' },
  ];

  const handleCopyRaw = () => {
    if (executionResult?.rawProducts) {
      navigator.clipboard.writeText(JSON.stringify(executionResult.rawProducts, null, 2));
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Control Banner & Scenario Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <Terminal className="w-5 h-5 text-cyan-400" />
              <span>Pipeline Execution Console & Sandbox</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Trigger extraction from the public REST API, simulate edge conditions, and inspect data state changes across the 5 ETL stages.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Scenario Selector */}
            <div className="flex items-center gap-2">
              <label htmlFor="scenario-select" className="text-xs text-slate-400 font-medium">Scenario:</label>
              <select
                id="scenario-select"
                aria-label="Pipeline test scenario"
                value={scenario}
                onChange={(e) => setScenario(e.target.value as SimulationScenario)}
                disabled={isRunning}
                className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-md px-3 py-1.5 focus:outline-hidden focus:border-cyan-500 font-mono"
              >
                <option value="standard">Standard Run (Live API)</option>
                <option value="rate_limit_retry">Simulate HTTP 429 & Retry Backoff</option>
                <option value="dq_critical_halt">Simulate Data Quality Critical Halt</option>
                <option value="corrupt_json">Simulate Malformed JSON Error</option>
              </select>
            </div>

            {/* Record limit selector */}
            <div className="flex items-center gap-1.5">
              <label htmlFor="records-select" className="text-xs text-slate-400">Records:</label>
              <select
                id="records-select"
                aria-label="Extraction record limit"
                value={batchLimit}
                onChange={(e) => setBatchLimit(Number(e.target.value))}
                disabled={isRunning}
                className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-md px-2 py-1.5 focus:outline-hidden focus:border-cyan-500 font-mono"
              >
                <option value={10}>10</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </div>

            {/* Trigger Button */}
            <button
              onClick={() => handleExecute(scenario)}
              disabled={isRunning}
              className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-md transition-all shadow-sm ${
                isRunning
                  ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed'
                  : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
              }`}
            >
              <Play className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : 'fill-slate-950'}`} />
              <span>{isRunning ? 'Executing...' : 'Run Pipeline'}</span>
            </button>
          </div>
        </div>

        {/* Real-time Stage Progression Tracker */}
        <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-5 gap-2">
          {stagesList.map((stg, idx) => {
            const isCurrent = currentStage === stg.id;
            const isPassed =
              (currentStage === 'completed' && true) ||
              (currentStage === 'loading_db' && idx < 4) ||
              (currentStage === 'checking_dq' && idx < 3) ||
              (currentStage === 'transforming' && idx < 2) ||
              (currentStage === 'validating' && idx < 1);
            const isFailed = currentStage === 'failed' && (
              (scenario === 'corrupt_json' && idx === 0) ||
              (scenario === 'dq_critical_halt' && idx === 3)
            );

            return (
              <div
                key={stg.id}
                className={`flex items-center gap-2 p-2 rounded-lg border text-xs transition-colors ${
                  isFailed
                    ? 'border-rose-800/80 bg-rose-950/40 text-rose-300'
                    : isCurrent
                    ? 'border-cyan-500 bg-cyan-950/40 text-cyan-200 shadow-sm'
                    : isPassed
                    ? 'border-slate-800 bg-slate-950/60 text-slate-300'
                    : 'border-slate-800/60 bg-slate-950/20 text-slate-400'
                }`}
              >
                <div className={`w-5 h-5 rounded flex items-center justify-center font-mono text-[10px] font-bold ${
                  isFailed
                    ? 'bg-rose-900 text-rose-200'
                    : isCurrent
                    ? 'bg-cyan-500 text-slate-950 animate-pulse'
                    : isPassed
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  {isPassed ? '✓' : stg.number}
                </div>
                <div className="truncate font-medium">{stg.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Split Grid: Terminal Stream + Data Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (5 cols): Live Structured Terminal */}
        <div className="lg:col-span-5 flex flex-col bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-sm h-[600px]">
          
          {/* Terminal Title Bar */}
          <div className="bg-slate-900/90 border-b border-slate-800 px-3.5 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
              </div>
              <span className="text-xs font-mono text-slate-300 font-medium ml-1">
                logs/pipeline.log
              </span>
            </div>

            {/* Filter buttons */}
            <div className="flex items-center gap-1 text-[11px] font-mono">
              {(['ALL', 'INFO', 'WARNING', 'ERROR'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setLogFilter(filter)}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    logFilter === filter
                      ? 'bg-slate-800 text-cyan-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-300'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {/* Terminal Body */}
          <div className="flex-1 p-3 font-mono text-xs overflow-y-auto space-y-1.5 bg-slate-950/95 scrollbar-thin">
            {filteredLogs.length === 0 ? (
              <div className="text-slate-400 py-8 text-center">
                Waiting for pipeline initialization...
              </div>
            ) : (
              filteredLogs.map((log) => {
                let badgeColor = 'text-slate-400';
                if (log.level === 'INFO') badgeColor = 'text-emerald-400';
                if (log.level === 'WARNING') badgeColor = 'text-amber-400';
                if (log.level === 'ERROR' || log.level === 'CRITICAL') badgeColor = 'text-rose-400 font-bold';

                return (
                  <div key={log.id} className="leading-relaxed hover:bg-slate-900/50 rounded px-1 -mx-1 py-0.5 transition-colors">
                    <span className="text-slate-400 select-none">{log.timestamp.slice(11)} </span>
                    <span className={`${badgeColor} select-none font-semibold`}>[{log.level.padEnd(8)}] </span>
                    <span className="text-cyan-500/80 select-none">[{log.logger}] </span>
                    <span className="text-slate-200">{log.message}</span>
                  </div>
                );
              })
            )}
            <div ref={terminalEndRef} />
          </div>

          {/* Terminal Footer */}
          <div className="bg-slate-900/80 border-t border-slate-800 px-3 py-2 flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>Rotated file handler · 10MB threshold</span>
            <span>{logs.length} entries emitted</span>
          </div>
        </div>

        {/* Right Column (7 cols): Data Inspector & Stage Outputs */}
        <div className="lg:col-span-7 flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm h-[600px]">
          
          {/* Inspector Header & View Switcher */}
          <div className="border-b border-slate-800 bg-slate-900 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
              <button
                onClick={() => setInspectorTab('dataframe')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  inspectorTab === 'dataframe' ? 'bg-slate-800 text-cyan-300 shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Table className="w-3.5 h-3.5" />
                <span>pandas DataFrame</span>
              </button>
              <button
                onClick={() => setInspectorTab('mysql_tables')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  inspectorTab === 'mysql_tables' ? 'bg-slate-800 text-cyan-300 shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>MySQL Tables ({executionResult?.transformedProducts.length || 0})</span>
              </button>
              <button
                onClick={() => setInspectorTab('dq_report')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  inspectorTab === 'dq_report' ? 'bg-slate-800 text-cyan-300 shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>DQ Suite (8 Checks)</span>
              </button>
              <button
                onClick={() => setInspectorTab('raw_json')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  inspectorTab === 'raw_json' ? 'bg-slate-800 text-cyan-300 shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileJson className="w-3.5 h-3.5" />
                <span>Raw JSON</span>
              </button>
            </div>

            {/* Quick search input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
              <input
                type="text"
                placeholder="Filter titles/SKU..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-md pl-8 pr-2.5 py-1 w-36 sm:w-44 focus:outline-hidden focus:border-cyan-500 font-mono"
              />
            </div>
          </div>

          {/* Inspector Body Content */}
          <div className="flex-1 overflow-y-auto p-4 bg-slate-900/60 scrollbar-thin">
            
            {/* VIEW 1: Pandas DataFrame Tabular View */}
            {inspectorTab === 'dataframe' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Standardized to snake_case · Derived fields: discounted_price, stock_status</span>
                  <span className="font-mono">{executionResult?.transformedProducts.length || 0} rows</span>
                </div>

                <div className="border border-slate-800 rounded-lg overflow-x-auto bg-slate-950">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="p-2.5 font-semibold">product_id</th>
                        <th className="p-2.5 font-semibold">sku</th>
                        <th className="p-2.5 font-semibold">title</th>
                        <th className="p-2.5 font-semibold">category</th>
                        <th className="p-2.5 font-semibold text-right">price ($)</th>
                        <th className="p-2.5 font-semibold text-right">disc_price ($)</th>
                        <th className="p-2.5 font-semibold text-center">stock</th>
                        <th className="p-2.5 font-semibold">stock_status</th>
                        <th className="p-2.5 font-semibold text-center">rating</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-200">
                      {executionResult?.transformedProducts
                        ?.filter(
                          (p) =>
                            p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            p.sku.toLowerCase().includes(searchTerm.toLowerCase())
                        )
                        .slice(0, 50)
                        .map((prod) => (
                          <tr key={prod.product_id} className="hover:bg-slate-900/40 transition-colors">
                            <td className="p-2.5 text-cyan-400">{prod.product_id}</td>
                            <td className="p-2.5 text-slate-400">{prod.sku}</td>
                            <td className="p-2.5 font-sans font-medium text-slate-100 max-w-[180px] truncate" title={prod.title}>
                              {prod.title}
                            </td>
                            <td className="p-2.5 text-slate-400">{prod.category_code}</td>
                            <td className="p-2.5 text-right font-medium">${prod.price.toFixed(2)}</td>
                            <td className="p-2.5 text-right font-semibold text-emerald-400">
                              ${prod.discounted_price.toFixed(2)}
                            </td>
                            <td className="p-2.5 text-center">{prod.stock}</td>
                            <td className="p-2.5">
                              <span className={`text-[11px] ${
                                prod.stock_status === 'OUT_OF_STOCK'
                                  ? 'text-rose-400 font-semibold'
                                  : prod.stock_status === 'LOW_STOCK'
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                              }`}>
                                {prod.stock_status}
                              </span>
                            </td>
                            <td className="p-2.5 text-center text-amber-300">★ {prod.rating.toFixed(2)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* VIEW 2: MySQL Relational Normalized Tables */}
            {inspectorTab === 'mysql_tables' && (
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 border-b border-slate-800 pb-2">
                  <span className="text-xs text-slate-400 mr-2">Target Table:</span>
                  {(['products', 'categories', 'dimensions', 'reviews', 'audit_log'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTableSubTab(t)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                        tableSubTab === t ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {tableSubTab === 'products' && (
                  <div className="text-xs space-y-2">
                    <div className="text-slate-400">Core fact table loaded via <code>ON DUPLICATE KEY UPDATE</code></div>
                    <div className="border border-slate-800 rounded-lg overflow-x-auto bg-slate-950 p-2 font-mono text-slate-300">
                      {executionResult?.transformedProducts.slice(0, 5).map((p) => (
                        <div key={p.product_id} className="py-1 border-b border-slate-800/50 flex items-center justify-between">
                          <span className="text-cyan-400">PK {p.product_id} | {p.sku}</span>
                          <span className="text-slate-200 truncate max-w-[200px]">{p.title}</span>
                          <span className="text-emerald-400">${p.price} (Disc: ${p.discounted_price})</span>
                          <span className="text-slate-400">stock: {p.stock}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {tableSubTab === 'categories' && (
                  <div className="text-xs space-y-2">
                    <div className="text-slate-400">Normalized category dimension table (1:N relationship)</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {executionResult?.categories.map((c) => (
                        <div key={c.category_code} className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 font-mono">
                          <div className="text-cyan-400 font-semibold">ID: {c.category_id}</div>
                          <div className="text-slate-200 font-sans mt-0.5">{c.category_name}</div>
                          <div className="text-slate-400 text-[11px]">{c.category_code}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {tableSubTab === 'dimensions' && (
                  <div className="text-xs space-y-2">
                    <div className="text-slate-400">1:1 Product Dimensions extension table with computed volume</div>
                    <div className="border border-slate-800 rounded-lg overflow-x-auto bg-slate-950">
                      <table className="w-full text-left font-mono">
                        <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                          <tr>
                            <th className="p-2">product_id (FK)</th>
                            <th className="p-2 text-right">width (cm)</th>
                            <th className="p-2 text-right">height (cm)</th>
                            <th className="p-2 text-right">depth (cm)</th>
                            <th className="p-2 text-right">volume (cm³)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {executionResult?.dimensions.slice(0, 10).map((d) => (
                            <tr key={d.product_id}>
                              <td className="p-2 text-cyan-400">{d.product_id}</td>
                              <td className="p-2 text-right">{d.width_cm}</td>
                              <td className="p-2 text-right">{d.height_cm}</td>
                              <td className="p-2 text-right">{d.depth_cm}</td>
                              <td className="p-2 text-right text-emerald-400 font-semibold">{d.volume_cm3}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {tableSubTab === 'reviews' && (
                  <div className="text-xs space-y-2">
                    <div className="text-slate-400">1:N Normalized Product Reviews loaded via INSERT IGNORE</div>
                    <div className="space-y-2">
                      {executionResult?.reviews.slice(0, 6).map((r, i) => (
                        <div key={i} className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 flex flex-col gap-1">
                          <div className="flex items-center justify-between text-slate-400 font-mono text-[11px]">
                            <span>Product #{r.product_id} · {r.reviewer_name} ({r.reviewer_email})</span>
                            <span className="text-amber-400">★ {r.rating}/5</span>
                          </div>
                          <div className="text-slate-200 italic font-sans">"{r.comment}"</div>
                          <div className="text-slate-400 text-[10px] font-mono">{r.review_date}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {tableSubTab === 'audit_log' && (
                  <div className="text-xs space-y-2">
                    <div className="text-slate-400">Operational metadata stored in <code>etl_audit_log</code> table</div>
                    {executionResult?.auditRecord ? (
                      <div className="p-4 rounded-lg border border-slate-800 bg-slate-950 font-mono space-y-2 text-slate-300">
                        <div className="flex justify-between border-b border-slate-800/80 pb-2">
                          <span className="text-slate-400">run_id</span>
                          <span className="text-cyan-400 font-bold">{executionResult.auditRecord.run_id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">status</span>
                          <span className="text-emerald-400 font-bold">{executionResult.auditRecord.status}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">records_extracted</span>
                          <span>{executionResult.auditRecord.records_extracted}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">records_transformed</span>
                          <span>{executionResult.auditRecord.records_transformed}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">execution_duration_sec</span>
                          <span>{executionResult.auditRecord.execution_duration_sec}s</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">started_at / completed_at</span>
                          <span>{executionResult.auditRecord.started_at}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-slate-400">No audit run record generated yet.</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* VIEW 3: Data Quality Check Report */}
            {inspectorTab === 'dq_report' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2">
                  <span>Pre-load validation rules: Critical halts vs Warning diagnostics</span>
                  <span className="text-emerald-400 font-mono font-medium">
                    {executionResult?.dqResults.filter((c) => c.status === 'PASSED').length || 0} / {executionResult?.dqResults.length || 8} PASSED
                  </span>
                </div>

                <div className="space-y-2">
                  {executionResult?.dqResults.map((check, idx) => {
                    const isPassed = check.status === 'PASSED';
                    return (
                      <div
                        key={idx}
                        className={`p-3 rounded-lg border text-xs transition-colors ${
                          isPassed
                            ? 'border-slate-800 bg-slate-950 text-slate-200'
                            : check.severity === 'CRITICAL'
                            ? 'border-rose-800 bg-rose-950/40 text-rose-200'
                            : 'border-amber-800 bg-amber-950/40 text-amber-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isPassed ? (
                              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : check.severity === 'CRITICAL' ? (
                              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                            )}
                            <span className="font-mono font-semibold text-slate-100">{check.check_name}</span>
                          </div>

                          <div className="flex items-center gap-2 font-mono text-[11px]">
                            <span className="text-slate-400">table: {check.target_table}</span>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                            <span className={check.severity === 'CRITICAL' ? 'text-rose-400 font-semibold' : 'text-amber-400'}>
                              {check.severity}
                            </span>
                          </div>
                        </div>

                        <p className="mt-1.5 text-xs text-slate-300 font-sans pl-6">
                          {check.message}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* VIEW 4: Raw JSON Response Inspector */}
            {inspectorTab === 'raw_json' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Direct payload from <code>https://dummyjson.com/products</code></span>
                  <button
                    onClick={handleCopyRaw}
                    className="flex items-center gap-1 text-slate-300 hover:text-cyan-400 text-xs transition-colors"
                  >
                    {copiedRaw ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedRaw ? 'Copied JSON' : 'Copy Payload'}</span>
                  </button>
                </div>

                <div className="border border-slate-800 rounded-lg p-3 bg-slate-950 font-mono text-xs text-slate-300 overflow-x-auto max-h-[480px]">
                  <pre>{JSON.stringify(executionResult?.rawProducts.slice(0, 2) || [], null, 2)}</pre>
                  {executionResult?.rawProducts && executionResult.rawProducts.length > 2 && (
                    <div className="text-slate-400 mt-2 italic">
                      ... [{executionResult.rawProducts.length - 2} additional records omitted for preview display]
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* Inspector Footer */}
          <div className="border-t border-slate-800 bg-slate-900/90 px-4 py-2 flex items-center justify-between text-xs text-slate-400">
            <span>Audit Check: Safe to load = {executionResult?.auditRecord.status === 'SUCCESS' ? 'TRUE' : 'FALSE'}</span>
            <span className="font-mono text-cyan-400">Duration: {executionResult?.auditRecord.execution_duration_sec || 0}s</span>
          </div>
        </div>

      </div>

    </div>
  );
};
