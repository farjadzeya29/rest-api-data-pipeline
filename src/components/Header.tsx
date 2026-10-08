import React from 'react';
import { Database, Play, Download, Terminal, Network, Table, Code2, BookOpen, CheckCircle2, AlertCircle } from 'lucide-react';
import JSZip from 'jszip';
import { REPOSITORY_FILES } from '../data/repositoryFiles';
import { PipelineStage } from '../types/pipeline';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  stage: PipelineStage;
  onRunPipeline: () => void;
  isRunning: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  stage,
  onRunPipeline,
  isRunning,
}) => {
  const [downloadingZip, setDownloadingZip] = React.useState(false);

  const handleDownloadZip = async () => {
    try {
      setDownloadingZip(true);
      const zip = new JSZip();

      // Bundle repository files
      REPOSITORY_FILES.forEach((file) => {
        zip.file(file.path, file.content);
      });

      // Add extra repo files
      zip.file('requirements.txt', 'requests>=2.31.0\nurllib3>=2.0.7\npandas>=2.2.0\nnumpy>=1.26.0\nPyYAML>=6.0.1\npython-dotenv>=1.0.1\nSQLAlchemy>=2.0.25\nPyMySQL>=1.1.0\ncryptography>=42.0.0\npytest>=8.0.0\npytest-mock>=3.12.0\n');
      zip.file('.gitignore', '__pycache__/\n*.pyc\n.env\nlogs/*.log\n!logs/.gitkeep\n.pytest_cache/\nvenv/\n');
      zip.file('logs/.gitkeep', '# Track logs dir\n');
      zip.file('docker-compose.yml', `services:
  mysql:
    image: mysql:8.0.36
    container_name: ecommerce_dw_mysql
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: root_secure_password
      MYSQL_DATABASE: ecommerce_dw
      MYSQL_USER: etl_runner
      MYSQL_PASSWORD: etl_secure_password
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
      - ./sql/schema.sql:/docker-entrypoint-initdb.d/01_schema.sql:ro
volumes:
  mysql_data:
`);

      const content = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'api-data-pipeline.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to create ZIP', err);
    } finally {
      setDownloadingZip(false);
    }
  };

  const navItems = [
    { id: 'console', label: 'Live Pipeline Console', icon: Terminal },
    { id: 'architecture', label: 'Architecture & Stages', icon: Network },
    { id: 'schema', label: 'Relational Schema (ERD)', icon: Table },
    { id: 'sql', label: 'SQL Analytics Sandbox', icon: Database },
    { id: 'repo', label: 'Repository Code (9 Files)', icon: Code2 },
    { id: 'interview', label: 'Resume & Interview Prep', icon: BookOpen },
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-900/95 sticky top-0 z-40 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* Brand & Project Identity */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-950 border border-cyan-800/60 flex items-center justify-center text-cyan-400 shadow-inner">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-100 text-base tracking-tight">
                  REST API to MySQL Data Pipeline
                </span>
                <span className="text-xs text-cyan-400 font-mono font-medium border border-cyan-800/80 bg-cyan-950/60 px-1.5 py-0.5 rounded">
                  v1.2.0
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span>Junior Data Engineer Portfolio</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span>Python & pandas</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span>MySQL 8.0</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span>Idempotent Upsert</span>
              </div>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={onRunPipeline}
              disabled={isRunning}
              className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md transition-all shadow-sm ${
                isRunning
                  ? 'bg-cyan-900/50 text-cyan-300 border border-cyan-700/50 cursor-not-allowed animate-pulse'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold'
              }`}
            >
              <Play className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : 'fill-slate-950'}`} />
              <span>{isRunning ? 'Pipeline Running...' : 'Run Pipeline Live'}</span>
            </button>

            <button
              onClick={handleDownloadZip}
              disabled={downloadingZip}
              title="Download entire Python repository with docker-compose and SQL as a zip file"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>{downloadingZip ? 'Packaging...' : 'Download Repo (.ZIP)'}</span>
            </button>
          </div>

        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center space-x-1 overflow-x-auto py-1 scrollbar-none border-t border-slate-800/70">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-800 text-cyan-300 border border-slate-700/80 shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
