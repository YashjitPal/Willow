import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '@nanostores/react';
import JSZip from 'jszip';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileCode2,
  FileJson2,
  Files,
  Loader2,
  Package,
  Terminal,
  Upload,
  X,
} from 'lucide-react';
import { codeModal } from '../../lib/stores/agent-builder-store';
import type { AgentBuilderBackend } from '../../hooks/useAgentBuilderBackend';

type ExportLanguage = 'typescript' | 'python';
type ExportMode = 'single' | 'sdk';

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const CodeExportModal: React.FC<{ backend: AgentBuilderBackend }> = ({ backend }) => {
  const state = useStore(codeModal);
  const [copied, setCopied] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [language, setLanguage] = React.useState<ExportLanguage>('typescript');
  const [mode, setMode] = React.useState<ExportMode>('single');
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!state.open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        codeModal.setKey('open', false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleDialogKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [state.open]);

  React.useEffect(() => {
    if (state.format === 'typescript' || state.format === 'typescript-sdk') setLanguage('typescript');
    if (state.format === 'python' || state.format === 'python-sdk') setLanguage('python');
    if (state.format === 'typescript-sdk' || state.format === 'python-sdk') setMode('sdk');
    if (state.format === 'typescript' || state.format === 'python') setMode('single');
  }, [state.format]);

  React.useEffect(() => {
    if (state.bundle) setSelectedFile(state.bundle.entrypoint);
    else setSelectedFile(null);
  }, [state.bundle]);

  if (!state.open) return null;

  const isJson = state.format === 'json';
  const bundleFiles = state.bundle
    ? Object.keys(state.bundle.files).sort((a, b) => {
        if (a === state.bundle?.entrypoint) return -1;
        if (b === state.bundle?.entrypoint) return 1;
        return a.localeCompare(b);
      })
    : [];
  const activeFile = selectedFile && state.bundle?.files[selectedFile] !== undefined
    ? selectedFile
    : state.bundle?.entrypoint;
  const displayedCode = activeFile && state.bundle ? state.bundle.files[activeFile] : state.code;
  const manifest = state.bundle?.manifest;

  const requestCode = (nextLanguage: ExportLanguage, nextMode: ExportMode) => {
    setLanguage(nextLanguage);
    setMode(nextMode);
    const format = nextMode === 'sdk' ? `${nextLanguage}-sdk` as const : nextLanguage;
    void backend.exportCode(format);
  };

  const copy = async () => {
    if (!displayedCode) return;
    try {
      await navigator.clipboard.writeText(displayedCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked by browser permissions.
    }
  };

  const download = async () => {
    if (!displayedCode) return;
    setDownloading(true);
    try {
      if (state.bundle) {
        const zip = new JSZip();
        Object.entries(state.bundle.files).forEach(([path, contents]) => zip.file(path, contents));
        const blob = await zip.generateAsync({ type: 'blob' });
        saveBlob(blob, `agent-workflow-${state.bundle.language}-sdk.zip`);
        return;
      }
      const extension = state.format === 'typescript' ? 'ts' : state.format === 'python' ? 'py' : 'json';
      const mimeType = state.format === 'json' ? 'application/json' : 'text/plain';
      saveBlob(new Blob([displayedCode], { type: mimeType }), `agent-workflow.${extension}`);
    } finally {
      setDownloading(false);
    }
  };

  const canUseOutput = !state.loading && !state.error && Boolean(displayedCode);

  return createPortal(
    <AnimatePresence>
      {state.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60"
            onClick={() => codeModal.setKey('open', false)}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="code-export-dialog-title"
            tabIndex={-1}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="relative flex h-[78vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[#2b2b2b] bg-[#171717] shadow-2xl"
          >
            <div className="flex min-h-14 items-center justify-between gap-4 border-b border-[#2b2b2b] px-5">
              <div className="flex min-w-0 items-center gap-4">
                <h2 id="code-export-dialog-title" className="shrink-0 text-[15px] font-semibold text-white">Export workflow</h2>
                <div className="flex items-center rounded-md bg-[#262626] p-0.5">
                  <button
                    onClick={() => requestCode(language, mode)}
                    className={`flex h-8 items-center gap-1.5 rounded px-3 text-[12px] font-medium transition-colors ${!isJson ? 'bg-[#404040] text-white' : 'text-[#a1a1aa] hover:text-white'}`}
                  >
                    <FileCode2 size={14} /> Code
                  </button>
                  <button
                    onClick={() => void backend.exportWorkflowJson()}
                    className={`flex h-8 items-center gap-1.5 rounded px-3 text-[12px] font-medium transition-colors ${isJson ? 'bg-[#404040] text-white' : 'text-[#a1a1aa] hover:text-white'}`}
                  >
                    <FileJson2 size={14} /> Workflow JSON
                  </button>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-[#a1a1aa]">
                {isJson && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        void file.text()
                          .then((text) => backend.importWorkflowJson(text))
                          .catch((error: unknown) => {
                            const message = error instanceof Error ? error.message : 'Unable to read the selected workflow file.';
                            codeModal.set({
                              open: true,
                              loading: false,
                              format: 'json',
                              code: '',
                              bundle: null,
                              error: message,
                            });
                          });
                      }}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      title="Import workflow JSON"
                      className="flex h-8 items-center gap-1.5 rounded px-2 text-[12px] transition-colors hover:bg-[#262626] hover:text-white"
                    >
                      <Upload size={15} /> Import
                    </button>
                  </>
                )}
                <button
                  onClick={() => void download()}
                  disabled={!canUseOutput || downloading}
                  title={state.bundle ? 'Download SDK project ZIP' : 'Download export'}
                  className="flex h-8 items-center gap-1.5 rounded px-2 text-[12px] transition-colors hover:bg-[#262626] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  {state.bundle ? 'Download ZIP' : 'Download'}
                </button>
                <button
                  onClick={() => void copy()}
                  disabled={!canUseOutput}
                  title={activeFile ? `Copy ${activeFile}` : 'Copy export'}
                  className="flex h-8 items-center gap-1.5 rounded px-2 text-[12px] transition-colors hover:bg-[#262626] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {copied ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  ref={closeButtonRef}
                  onClick={() => codeModal.setKey('open', false)}
                  title="Close"
                  aria-label="Close export dialog"
                  className="grid h-8 w-8 place-items-center rounded transition-colors hover:bg-[#262626] hover:text-white"
                >
                  <X size={16} strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {!isJson && (
              <div className="flex min-h-14 flex-wrap items-center gap-5 border-b border-[#2b2b2b] px-5 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium uppercase text-[#737373]">Language</span>
                  <div className="flex items-center rounded-md border border-[#303030] p-0.5">
                    {(['typescript', 'python'] as const).map((item) => (
                      <button
                        key={item}
                        onClick={() => requestCode(item, mode)}
                        className={`h-7 rounded px-2.5 text-[12px] transition-colors ${language === item ? 'bg-[#333] text-white' : 'text-[#999] hover:text-white'}`}
                      >
                        {item === 'typescript' ? 'TypeScript' : 'Python'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium uppercase text-[#737373]">Format</span>
                  <div className="flex items-center rounded-md border border-[#303030] p-0.5">
                    <button
                      onClick={() => requestCode(language, 'single')}
                      className={`flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] transition-colors ${mode === 'single' ? 'bg-[#333] text-white' : 'text-[#999] hover:text-white'}`}
                    >
                      <FileCode2 size={13} /> Single file
                    </button>
                    <button
                      onClick={() => requestCode(language, 'sdk')}
                      className={`flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] transition-colors ${mode === 'sdk' ? 'bg-[#333] text-white' : 'text-[#999] hover:text-white'}`}
                    >
                      <Package size={13} /> Agents SDK project
                    </button>
                  </div>
                </div>
                {state.bundle && !state.loading && (
                  <div className="ml-auto flex min-w-0 items-center gap-4 text-[11px] text-[#8b8b8b]">
                    <span className="flex min-w-0 items-center gap-1.5" title="Project entrypoint">
                      <Terminal size={13} className="shrink-0" />
                      <code className="truncate text-[#c4c4c4]">{state.bundle.entrypoint}</code>
                    </span>
                    <span className="flex items-center gap-1.5" title="Generated files">
                      <Files size={13} /> {bundleFiles.length} files
                    </span>
                  </div>
                )}
              </div>
            )}

            {manifest && !state.loading && !state.error && (
              <div className="border-b border-[#2b2b2b] bg-[#151515] px-5 py-3">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[#a3a3a3]">
                  <span><span className="text-[#666]">Compatibility</span> <span className="ml-1 font-medium text-[#d4d4d4]">Hybrid fidelity</span></span>
                  <span><span className="text-[#666]">Target</span> <code className="ml-1 text-[#d4d4d4]">{manifest.target.package}@{manifest.target.version}</code></span>
                  <span><span className="text-[#666]">Manifest</span> <span className="ml-1 text-[#d4d4d4]">v{manifest.formatVersion}</span></span>
                  <span><span className="text-[#666]">Generator</span> <span className="ml-1 text-[#d4d4d4]">v{manifest.generator.version}</span></span>
                </div>
                {manifest.compatibility.warnings.length > 0 && (
                  <div className="mt-2.5 space-y-1.5 border-l-2 border-amber-700/70 pl-3">
                    {manifest.compatibility.warnings.map((warning) => (
                      <div key={warning} className="flex items-start gap-2 text-[10.5px] leading-relaxed text-amber-200/80">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-300" />
                        <span>{warning}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex min-h-0 flex-1">
              {state.bundle && !state.loading && !state.error && (
                <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-[#2b2b2b] bg-[#141414]">
                  <div className="border-b border-[#292929] px-3 py-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase text-[#666]">Project files</div>
                    <div className="space-y-0.5">
                      {bundleFiles.map((file) => (
                        <button
                          key={file}
                          onClick={() => setSelectedFile(file)}
                          title={file}
                          className={`flex h-7 w-full min-w-0 items-center gap-2 rounded px-2 text-left text-[11.5px] transition-colors ${activeFile === file ? 'bg-[#303030] text-white' : 'text-[#9a9a9a] hover:bg-[#222] hover:text-white'}`}
                        >
                          <FileCode2 size={13} className="shrink-0" />
                          <span className="truncate">{file}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase text-[#666]">Dependencies</div>
                    <div className="space-y-2">
                      {(state.bundle.dependencies ?? []).map((dependency) => (
                        <div key={`${dependency.kind}:${dependency.name}`} className="min-w-0">
                          <div className="truncate text-[11.5px] text-[#c3c3c3]">{dependency.name}</div>
                          <div className="text-[10px] text-[#666]">{dependency.version} · {dependency.kind}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-[#292929] px-3 py-3 text-[10.5px]">
                    <div>
                      <div className="mb-1 text-[#666]">Install</div>
                      <code className="block break-all text-[#a9a9a9]">{state.bundle.installCommand}</code>
                    </div>
                    <div>
                      <div className="mb-1 text-[#666]">Run</div>
                      <code className="block break-all text-[#a9a9a9]">{state.bundle.runCommand}</code>
                    </div>
                  </div>
                </aside>
              )}
              <div className="min-w-0 flex-1 overflow-auto bg-[#191919]">
                {state.loading ? (
                  <div className="flex h-full items-center justify-center text-[#6a6a6a]">
                    <Loader2 size={20} className="animate-spin" />
                  </div>
                ) : state.error ? (
                  <div className="p-5 text-[13px] text-red-300">{state.error}</div>
                ) : (
                  <pre className="min-w-max whitespace-pre p-5 font-mono text-[12.5px] leading-relaxed text-[#d4d4d4]">{displayedCode}</pre>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default CodeExportModal;
