/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Header } from './components/Header';
import { LiveConsole } from './components/LiveConsole';
import { ArchitectureView } from './components/ArchitectureView';
import { SchemaErdView } from './components/SchemaErdView';
import { SqlSandbox } from './components/SqlSandbox';
import { RepoBrowser } from './components/RepoBrowser';
import { InterviewGuide } from './components/InterviewGuide';
import { PipelineExecutionResult } from './services/pipelineEngine';
import { PipelineStage } from './types/pipeline';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('console');
  const [executionResult, setExecutionResult] = useState<PipelineExecutionResult | null>(null);
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [isRunning, setIsRunning] = useState<boolean>(false);

  // Trigger from Header button
  const handleTriggerRun = () => {
    setActiveTab('console');
    const runBtn = document.querySelector('button[aria-label="run-pipeline-trigger"]') as HTMLButtonElement | null;
    if (runBtn) {
      runBtn.click();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/20 selection:text-cyan-200">
      
      {/* Top Header & Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        stage={stage}
        onRunPipeline={handleTriggerRun}
        isRunning={isRunning}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'console' && (
          <LiveConsole
            onRunFinished={(res) => {
              setExecutionResult(res);
              setIsRunning(false);
              setStage('completed');
            }}
            initialResult={executionResult}
          />
        )}

        {activeTab === 'architecture' && <ArchitectureView />}

        {activeTab === 'schema' && <SchemaErdView />}

        {activeTab === 'sql' && <SqlSandbox data={executionResult} />}

        {activeTab === 'repo' && <RepoBrowser />}

        {activeTab === 'interview' && <InterviewGuide />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-mono">
          <div className="flex items-center gap-2">
            <span>REST API to MySQL Data Pipeline</span>
            <span aria-hidden="true">·</span>
            <span>Junior Data Engineer Portfolio</span>
          </div>
          <div>
            Built with Python 3.10+, pandas, SQLAlchemy, MySQL 8.0 & Git
          </div>
        </div>
      </footer>

    </div>
  );
}
