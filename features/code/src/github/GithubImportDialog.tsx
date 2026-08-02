import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { importGitHubRepository, parseGitHubRepositoryUrl } from './repository';
import type { ComposerAttachment } from '@willow/core/attachments';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

interface GithubImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: (attachment: ComposerAttachment) => void;
  onFolderSelected: (files: File[]) => void;
}

export const GithubImportDialog: React.FC<GithubImportDialogProps> = ({
  open,
  onClose,
  onImported,
  onFolderSelected,
}) => {
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [error, setError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isImporting) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isImporting, onClose, open]);

  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setRepositoryUrl('');
    setError('');
    setIsImporting(false);
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!open) return null;

  const handleImport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isImporting) return;
    if (!parseGitHubRepositoryUrl(repositoryUrl)) {
      setError('Enter a GitHub repository or branch URL.');
      inputRef.current?.focus();
      return;
    }

    setError('');
    setIsImporting(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const attachment = await importGitHubRepository(repositoryUrl, controller.signal);
      if (controller.signal.aborted) return;
      onImported(attachment);
      onClose();
    } catch (importError: any) {
      if (controller.signal.aborted) return;
      setError(importError?.message || 'Unable to import this repository.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) setIsImporting(false);
    }
  };

  return createPortal(
    <div
      className="willow-github-dialog-backdrop fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 px-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isImporting) onClose();
      }}
    >
      <section
        className="willow-github-dialog-surface w-[512px] max-w-full overflow-hidden rounded-[28px] bg-[#1e1f20] text-[#e3e3e3] shadow-[0_0_20px_rgba(0,0,0,0.28)] font-['Google_Sans_Flex','Google_Sans_Text','Google_Sans',sans-serif]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="willow-import-code-title"
      >
        <header className="flex h-[76px] items-center justify-between px-5 pb-4 pt-5">
          <h2
            id="willow-import-code-title"
            className="text-[20px] font-normal leading-6"
            style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 100, "wght" 470' }}
          >
            Import code
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#c4c7c5] transition-colors hover:bg-[#333537] hover:text-[#e3e3e3] disabled:cursor-default disabled:opacity-50"
            aria-label="Cancel code import"
          >
            <MaterialSymbol family="luminous" name="close" size={24} weight={320} roundness={100} opticalSize={24} />
          </button>
        </header>

        <div className="px-5 py-4">
          <form onSubmit={handleImport} className="flex items-center gap-4 max-sm:flex-col max-sm:items-stretch">
            <div className="min-w-0 flex-1">
              <label
                className={`relative block h-14 rounded-[4px] border px-4 transition-colors ${
                  error
                    ? 'border-[#f2b8b5]'
                    : 'border-[#8e918f] focus-within:border-2 focus-within:border-[#a8d9b4] focus-within:px-[15px]'
                }`}
              >
                <span
                  className={`pointer-events-none absolute -top-[8px] left-3 bg-[#1e1f20] px-1 text-[12px] leading-4 ${error ? 'text-[#f2b8b5]' : 'text-[#a8d9b4]'}`}
                >
                  GitHub repository or branch URL
                </span>
                <input
                  ref={inputRef}
                  value={repositoryUrl}
                  onChange={(event) => {
                    setRepositoryUrl(event.target.value);
                    if (error) setError('');
                  }}
                  placeholder="e.g: https://github.com/user/repo"
                  className="h-full w-full bg-transparent text-[16px] font-normal leading-6 text-[#e6e6e6] outline-none placeholder:text-[#8e918f]"
                  aria-label="GitHub repository or branch URL"
                  aria-invalid={!!error}
                  disabled={isImporting}
                />
              </label>
              {error && <p className="mt-1 px-4 text-[12px] leading-4 text-[#f2b8b5]">{error}</p>}
            </div>

            <button
              type="submit"
              disabled={isImporting || !repositoryUrl.trim()}
              className="flex h-10 min-w-[85px] shrink-0 items-center justify-center gap-2 rounded-full bg-[#a8d9b4] px-6 text-[14px] font-medium text-[#17351f] transition-colors hover:bg-[#b8e7c2] disabled:bg-[#3f4c42] disabled:text-[#8e9c91]"
              style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 100, "wght" 500' }}
            >
              {isImporting && <MaterialSymbol name="progress_activity" size={18} weight={400} className="animate-spin" />}
              <span>{isImporting ? 'Importing' : 'Import'}</span>
            </button>
          </form>
        </div>

        <footer className="flex min-h-[73px] items-center px-6 py-4">
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              if (files.length) {
                onFolderSelected(files);
                onClose();
              }
              event.target.value = '';
            }}
            {...({ webkitdirectory: '', directory: '' } as any)}
          />
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={isImporting}
            className="h-10 rounded-full px-3 text-[14px] font-medium text-[#a8d9b4] transition-colors hover:bg-[#333537] disabled:opacity-50"
            style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 100, "wght" 500' }}
          >
            Upload folder
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
};
