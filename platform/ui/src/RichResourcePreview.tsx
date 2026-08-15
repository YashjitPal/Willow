import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { MaterialSymbol } from './MaterialSymbol';

export type RichResourceKind = 'youtube' | 'pdf' | 'document';

export interface RichResource {
  kind: RichResourceKind;
  url: string;
  title: string;
  subtitle?: string;
  description?: string;
  thumbnailUrl?: string;
  youtubeId?: string;
}

const DOCUMENT_EXTENSIONS = new Set([
  'csv', 'doc', 'docx', 'json', 'md', 'odt', 'ppt', 'pptx', 'rtf', 'txt', 'xls', 'xlsx', 'xml',
]);

function readableLabel(label: string | undefined, fallback: string): string {
  const trimmed = label?.trim() || '';
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return fallback;
  return trimmed;
}

function fileNameFromUrl(url: URL): string {
  const pathName = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'Document');
  return pathName || 'Document';
}

function youtubeIdFromUrl(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com') return null;
  if (url.pathname === '/watch') return url.searchParams.get('v');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') return parts[1] || null;
  return null;
}

export function resourceFromUrl(rawUrl: string, label?: string): RichResource | null {
  try {
    const baseUrl = typeof window !== 'undefined' ? window.location.href : 'https://willow.local/';
    const parsed = new URL(rawUrl, baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    const youtubeId = youtubeIdFromUrl(parsed);
    if (youtubeId && /^[A-Za-z0-9_-]{6,}$/.test(youtubeId)) {
      const canonicalUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
      return {
        kind: 'youtube',
        url: canonicalUrl,
        youtubeId,
        title: readableLabel(label, 'YouTube video'),
        subtitle: 'YouTube',
        thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
      };
    }

    const fileName = fileNameFromUrl(parsed);
    const extension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
    const contentType = parsed.searchParams.get('contentType')?.toLowerCase() || '';
    const queryFileName = [
      parsed.searchParams.get('filename'),
      parsed.searchParams.get('file'),
      parsed.searchParams.get('name'),
    ].filter(Boolean).join(' ').toLowerCase();
    const isPdf =
      extension === 'pdf' ||
      contentType === 'application/pdf' ||
      parsed.searchParams.get('format')?.toLowerCase() === 'pdf' ||
      /\.pdf(?:$|[?#/])/i.test(parsed.href) ||
      /\.pdf$/i.test(queryFileName);
    if (isPdf) {
      return {
        kind: 'pdf',
        url: parsed.href,
        title: readableLabel(label, fileName),
        subtitle: parsed.hostname.replace(/^www\./, ''),
      };
    }

    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const isHostedDocument =
      host === 'docs.google.com' ||
      host === 'drive.google.com' ||
      host === 'dropbox.com';
    if (DOCUMENT_EXTENSIONS.has(extension) || isHostedDocument) {
      return {
        kind: 'document',
        url: parsed.href,
        title: readableLabel(label, fileName),
        subtitle: parsed.hostname.replace(/^www\./, ''),
      };
    }
  } catch {
    return null;
  }
  return null;
}

function youtubeEmbedUrl(resource: RichResource, autoplay = false): string {
  let id = resource.youtubeId;
  if (!id) {
    try {
      id = youtubeIdFromUrl(new URL(resource.url)) || undefined;
    } catch {
      id = undefined;
    }
  }
  if (!id) return resource.url;
  return `https://www.youtube.com/embed/${id}?rel=0&showinfo=0&enablejsapi=1${autoplay ? '&autoplay=1' : ''}`;
}

function useResolvedYouTube(resource: RichResource): RichResource {
  const [resolved, setResolved] = useState(resource);

  useEffect(() => {
    setResolved(resource);
    if (resource.kind !== 'youtube') return;
    const controller = new AbortController();
    const endpoint = `https://noembed.com/embed?url=${encodeURIComponent(resource.url)}`;
    void fetch(endpoint, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((metadata) => {
        if (!metadata || controller.signal.aborted) return;
        setResolved((current) => ({
          ...current,
          title: metadata.title || current.title,
          subtitle: metadata.author_name || current.subtitle || 'YouTube',
          thumbnailUrl: metadata.thumbnail_url || current.thumbnailUrl,
          description: current.description || metadata.title,
        }));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [resource]);

  return resolved;
}

const YouTubeResourceCard: React.FC<{
  resource: RichResource;
  onOpen: (resource: RichResource) => void;
}> = ({ resource, onOpen }) => {
  const resolved = useResolvedYouTube(resource);
  return (
    <div className="relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-[4px] bg-[#1e1f20] p-4 min-[768px]:flex-row">
      <div className="pointer-events-none min-w-0 overflow-hidden min-[768px]:w-1/2 min-[768px]:shrink-0">
        <iframe
          className="block aspect-video w-full border-0"
          src={youtubeEmbedUrl(resolved)}
          title={resolved.title}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <div className="min-w-0 flex-1 py-0.5 text-left font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]">
        <div className="line-clamp-2 text-[17px] font-[540] leading-6 text-[#e3e3e3]">{resolved.title}</div>
        <div className="mt-0.5 truncate text-[14px] leading-5 text-[#c4c7c5]">{resolved.subtitle || 'YouTube'}</div>
        <div className="mt-5 line-clamp-4 text-[15px] leading-5 text-[#e3e3e3]">
          {resolved.description || `Watch ${resolved.title} on YouTube.`}
        </div>
      </div>
      <button
        type="button"
        className="absolute inset-0 z-10 cursor-pointer rounded-[4px] bg-transparent text-left outline-none before:absolute before:inset-0 before:bg-[#e3e3e3] before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-[0.08] focus-visible:ring-2 focus-visible:ring-[#a8c7fa]/80"
        aria-label={`Play ${resolved.title}`}
        onClick={() => onOpen(resolved)}
      />
    </div>
  );
};

const DocumentResourceCard: React.FC<{
  resource: RichResource;
  onOpen: (resource: RichResource) => void;
}> = ({ resource, onOpen }) => (
  <button
    type="button"
    onClick={() => onOpen(resource)}
    className="relative flex min-h-[112px] w-full items-center gap-4 overflow-hidden rounded-[4px] bg-[#1e1f20] p-4 text-left outline-none before:absolute before:inset-0 before:bg-[#e3e3e3] before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-[0.08] focus-visible:ring-2 focus-visible:ring-[#a8c7fa]/80"
  >
    <span className="relative z-[1] flex h-20 w-28 shrink-0 items-center justify-center rounded-[4px] bg-[#28292a] text-[#c4c7c5]">
      <MaterialSymbol family="luminous" name={resource.kind === 'pdf' ? 'picture_as_pdf' : 'draft'} size={36} weight={300} roundness={100} />
    </span>
    <span className="relative z-[1] min-w-0 flex-1">
      <span className="line-clamp-2 block text-[17px] font-[540] leading-6 text-[#e3e3e3]">{resource.title}</span>
      <span className="mt-1 block truncate text-[14px] leading-5 text-[#c4c7c5]">{resource.subtitle || 'Document'}</span>
    </span>
  </button>
);

export const RichResourceGroup: React.FC<{
  resources: RichResource[];
  onOpen: (resource: RichResource) => void;
  settled?: boolean;
  style?: React.CSSProperties;
}> = ({ resources, onOpen, settled, style }) => {
  if (!resources.length) return null;
  const isYouTube = resources.every((resource) => resource.kind === 'youtube');
  return (
    <div
      className={'smd-rich-resource-group' + (settled ? ' smd-settled' : '')}
      style={style}
    >
      <div className="mb-4 flex items-start gap-2">
        {isYouTube ? (
          <img
            src="https://www.gstatic.com/images/branding/productlogos/youtube/v9/192px.svg"
            alt=""
            className="mt-0.5 h-[18px] w-[18px] shrink-0"
          />
        ) : (
          <MaterialSymbol family="luminous" name="draft" size={18} weight={300} roundness={100} className="mt-0.5 shrink-0 text-[#c4c7c5]" />
        )}
        <div className="min-w-0">
          <div className="text-[14px] leading-5 text-[#c4c7c5]">{isYouTube ? 'YouTube' : 'Files'}</div>
          <div className="text-[17px] leading-6 text-[#c4c7c5]">{isYouTube ? 'Video' : 'Preview'}</div>
        </div>
      </div>
      <div className="flex flex-col gap-[2px]">
        {resources.map((resource) => resource.kind === 'youtube' ? (
          <YouTubeResourceCard key={`${resource.kind}:${resource.url}`} resource={resource} onOpen={onOpen} />
        ) : (
          <DocumentResourceCard key={`${resource.kind}:${resource.url}`} resource={resource} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
};

export const RichResourcePanel: React.FC<{
  resource: RichResource;
  onClose: () => void;
}> = ({ resource, onClose }) => {
  const resolved = useResolvedYouTube(resource);
  const [copied, setCopied] = useState(false);
  const externalLabel = resolved.kind === 'youtube' ? 'Open in YouTube' : 'Open file';
  const panelTitle = resolved.title || (resolved.kind === 'youtube' ? 'YouTube video' : 'Document');
  const viewerUrl = useMemo(() => {
    if (resolved.kind === 'youtube') return youtubeEmbedUrl(resolved, true);
    if (resolved.kind === 'document') {
      try {
        const url = new URL(resolved.url);
        const host = url.hostname.replace(/^www\./, '').toLowerCase();
        if (host === 'docs.google.com') {
          if (/\/(document|spreadsheets|presentation)\/d\//.test(url.pathname)) {
            return resolved.url.replace(/\/(edit|view)(?:\?.*)?$/, '/preview');
          }
          return resolved.url;
        }
        if (host === 'drive.google.com') {
          return resolved.url.replace(/\/view(?:\?.*)?$/, '/preview');
        }
      } catch {
        // Fall through to the public document viewer.
      }
      return `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(resolved.url)}`;
    }
    return resolved.url;
  }, [resolved]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: panelTitle, url: resolved.url });
      } else {
        await navigator.clipboard.writeText(resolved.url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }
    } catch {
      // The native share sheet can be dismissed without changing panel state.
    }
  };

  return (
    <motion.aside
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
      className="fixed inset-0 z-50 flex min-h-0 min-w-0 origin-center flex-col overflow-hidden bg-[#1f1f1f] text-[#e3e3e3] will-change-[transform,opacity] transform-gpu min-[960px]:relative min-[960px]:inset-auto min-[960px]:z-auto min-[960px]:mb-12 min-[960px]:ml-2 min-[960px]:mr-8 min-[960px]:mt-6 min-[960px]:rounded-[40px] min-[960px]:border min-[960px]:border-white/[0.12]"
      aria-label={`${panelTitle} preview`}
    >
      <div className="flex h-[60px] shrink-0 items-center justify-between gap-2 px-4 min-[960px]:px-8">
        <div className="min-w-0 flex-1 truncate text-[13px] font-normal leading-[18px] text-[#e3e3e3]">{panelTitle}</div>
        <div className="flex h-10 shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void share()}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#c4c7c5] outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/25"
            aria-label={copied ? 'Link copied' : 'Share preview'}
            title={copied ? 'Copied' : 'Share'}
          >
            <MaterialSymbol family="google-symbols" name={copied ? 'check' : 'share'} size={18} weight={400} roundness={0} />
          </button>
          <a
            href={resolved.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 items-center justify-center rounded-full bg-[#141414] px-4 text-[13px] font-[540] leading-[18px] text-[#e3e3e3] no-underline outline-none hover:bg-[#292929] focus-visible:ring-2 focus-visible:ring-white/25"
          >
            {externalLabel}
          </a>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#c4c7c5] outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/25"
            aria-label="Close panel"
            title="Close"
          >
            <MaterialSymbol family="luminous" name="close" size={20} weight={300} roundness={100} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {resolved.kind === 'youtube' ? (
          <div className="flex h-full w-full items-center justify-center overflow-hidden">
            <iframe
              className="block aspect-video max-h-full w-full border-0"
              src={viewerUrl}
              title={panelTitle}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : (
          <iframe
            className="h-full w-full border-0 bg-[#131314]"
            src={viewerUrl}
            title={panelTitle}
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
    </motion.aside>
  );
};
