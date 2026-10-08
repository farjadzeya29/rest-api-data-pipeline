import React, { useState } from 'react';
import { 
  Folder, FileCode, Copy, Check, Download, ExternalLink, 
  ChevronRight, Terminal, Sparkles, BookOpen
} from 'lucide-react';
import JSZip from 'jszip';
import { REPOSITORY_FILES, RepoFile } from '../data/repositoryFiles';

export const RepoBrowser: React.FC = () => {
  const [selectedFilePath, setSelectedFilePath] = useState<string>('src/api_client.py');
  const [copied, setCopied] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const selectedFile = REPOSITORY_FILES.find((f) => f.path === selectedFilePath) || REPOSITORY_FILES[0];

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadZip = async () => {
    try {
      setDownloadingZip(true);
      const zip = new JSZip();

      REPOSITORY_FILES.forEach((file) => {
        zip.file(file.path, file.content);
      });

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

  const filesByFolder = {
    src: REPOSITORY_FILES.filter((f) => f.category === 'src'),
    sql: REPOSITORY_FILES.filter((f) => f.category === 'sql'),
    config: REPOSITORY_FILES.filter((f) => f.category === 'config'),
    root: REPOSITORY_FILES.filter((f) => f.category === 'root'),
  };

  const lines = selectedFile.content.split('\n');

  return (
    <div className="space-y-6">
      
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <FileCode className="w-5 h-5 text-cyan-400" />
            <span>Project Repository Source Explorer</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Browse genuine, runnable Python scripts, SQL schemas, YAML configs, and tests.
            Ready to be pushed directly to your personal GitHub portfolio.
          </p>
        </div>

        <button
          onClick={handleDownloadZip}
          disabled={downloadingZip}
          className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all shadow-sm"
        >
          <Download className="w-4 h-4" />
          <span>{downloadingZip ? 'Packaging Repo...' : 'Download Full Repo (.ZIP)'}</span>
        </button>
      </div>

      {/* Main File Tree + Code Viewer Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: File Tree Explorer (4 cols) */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
          <div className="text-xs font-mono font-semibold text-slate-300 pb-2 border-b border-slate-800 flex items-center justify-between">
            <span>REPOSITORY FILES</span>
            <span className="text-[11px] text-cyan-400 font-normal">{REPOSITORY_FILES.length} Files</span>
          </div>

          <div className="space-y-4 text-xs font-mono">
            
            {/* src/ folder */}
            <div>
              <div className="flex items-center gap-1.5 text-slate-400 font-semibold mb-1">
                <Folder className="w-4 h-4 text-cyan-500" />
                <span>src/</span>
              </div>
              <div className="pl-5 space-y-0.5 border-l border-slate-800 ml-2">
                {filesByFolder.src.map((file) => {
                  const isSelected = selectedFilePath === file.path;
                  return (
                    <button
                      key={file.path}
                      onClick={() => setSelectedFilePath(file.path)}
                      className={`w-full text-left px-2 py-1 rounded transition-colors flex items-center justify-between ${
                        isSelected
                          ? 'bg-cyan-950/80 text-cyan-300 font-medium border border-cyan-800/60'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <span className="truncate">{file.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* sql/ folder */}
            <div>
              <div className="flex items-center gap-1.5 text-slate-400 font-semibold mb-1">
                <Folder className="w-4 h-4 text-amber-500" />
                <span>sql/</span>
              </div>
              <div className="pl-5 space-y-0.5 border-l border-slate-800 ml-2">
                {filesByFolder.sql.map((file) => {
                  const isSelected = selectedFilePath === file.path;
                  return (
                    <button
                      key={file.path}
                      onClick={() => setSelectedFilePath(file.path)}
                      className={`w-full text-left px-2 py-1 rounded transition-colors flex items-center justify-between ${
                        isSelected
                          ? 'bg-amber-950/80 text-amber-300 font-medium border border-amber-800/60'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <span className="truncate">{file.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* config/ folder */}
            <div>
              <div className="flex items-center gap-1.5 text-slate-400 font-semibold mb-1">
                <Folder className="w-4 h-4 text-emerald-500" />
                <span>config/</span>
              </div>
              <div className="pl-5 space-y-0.5 border-l border-slate-800 ml-2">
                {filesByFolder.config.map((file) => {
                  const isSelected = selectedFilePath === file.path;
                  return (
                    <button
                      key={file.path}
                      onClick={() => setSelectedFilePath(file.path)}
                      className={`w-full text-left px-2 py-1 rounded transition-colors flex items-center justify-between ${
                        isSelected
                          ? 'bg-emerald-950/80 text-emerald-300 font-medium border border-emerald-800/60'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <span className="truncate">{file.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* root folder */}
            <div>
              <div className="flex items-center gap-1.5 text-slate-400 font-semibold mb-1">
                <Folder className="w-4 h-4 text-slate-500" />
                <span>root /</span>
              </div>
              <div className="pl-5 space-y-0.5 border-l border-slate-800 ml-2">
                {filesByFolder.root.map((file) => {
                  const isSelected = selectedFilePath === file.path;
                  return (
                    <button
                      key={file.path}
                      onClick={() => setSelectedFilePath(file.path)}
                      className={`w-full text-left px-2 py-1 rounded transition-colors flex items-center justify-between ${
                        isSelected
                          ? 'bg-slate-800 text-slate-200 font-medium border border-slate-700'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <span className="truncate">{file.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>
        </div>

        {/* Right: Code Inspector (8 cols) */}
        <div className="lg:col-span-8 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm h-[650px]">
          
          {/* File Top Bar */}
          <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-slate-100">{selectedFile.path}</span>
                <span className="text-[10px] font-mono text-cyan-400 uppercase">{selectedFile.language}</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{selectedFile.description}</p>
            </div>

            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-300 hover:text-white rounded border border-slate-800 hover:border-slate-700 bg-slate-900 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          {/* Code Viewer with Line Numbers */}
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-slate-200 bg-slate-950 scrollbar-thin">
            <table className="w-full text-left border-collapse">
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="hover:bg-slate-900/60 leading-relaxed">
                    <td className="w-12 text-slate-400 select-none pr-4 text-right align-top font-mono text-[11px]">
                      {idx + 1}
                    </td>
                    <td className="whitespace-pre overflow-x-auto text-slate-300 font-mono">
                      {line || '\n'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer Bar */}
          <div className="bg-slate-900/90 border-t border-slate-800 px-4 py-2 flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>{lines.length} lines</span>
            <span>UTF-8 · LF</span>
          </div>

        </div>

      </div>

    </div>
  );
};
