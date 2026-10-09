import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Button, Input, Kbd, Spinner, useListNavigation } from "../../codex/ui";
import { PageIcon } from "../components/space-icon";
import type { PageMetadata } from "../state";
import { formatMessages, linkMessages, pageMessages } from "./messages";
import { linkedPageId, usePageLinkSearch } from "./page-links";

/** `ar` (`R0`): the trimmed value when it is an http(s) URL without whitespace. */
export function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /\s/u.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

/** `CN`: a bare host such as `example.com/path`, as an https URL. */
function bareHostUrl(value: string) {
  const host = value.split(/[/?#]/u, 1)[0];
  if (!host || /[@\\]/u.test(host) || (!host.startsWith("[") && (!/[.\u3002\uff0e\uff61]/u.test(host) || !/^[^:]+(?::\d+)?$/u.test(host)))) return null;
  const href = normalizeUrl(`https://${value}`);
  if (href == null) return null;
  const hostname = new URL(href).hostname.replace(/\.$/u, "");
  if (/^[\d.]+$/u.test(hostname) && host.replace(/:\d+$/u, "").replace(/[\u3002\uff0e\uff61]/gu, ".").replace(/\.$/u, "") !== hostname) return null;
  const labels = hostname.split(".");
  return hostname.startsWith("[") || (hostname.length <= 253 && labels.length > 1 && labels.every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/iu.test(label))) ? href : null;
}

/** `DN` */
function onFormKeyDown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
}

/** `ON` */
function pageKey(page: PageMetadata) {
  return page.page_id;
}

/** `kN` */
function optionId(listId: string, pageId: string) {
  return `${listId}-${pageId.replaceAll(/[^A-Za-z0-9_-]/gu, "-")}`;
}

interface LinkFormProps {
  /** Destination of the link being edited. */
  initialHref: string | null;
  /** Text of the link being edited; shows the Title field. */
  initialTitle?: string;
  autoFocusTitle?: boolean;
  /** Page the link is in; the page search leaves it out. */
  sourcePageId: string;
  onCancel: () => void;
  onRemove?: () => void;
  onSave: (href: string, title?: string) => void;
  onSelectPage: (pageId: string) => void;
}

/**
 * `TN` as `PN` mounts it: the destination and title form that replaces the selection toolbar in its "link" mode. Text
 * that is not a URL searches Pages; picking one and saving links the Page instead of a URL.
 */
export function LinkForm({ initialHref, initialTitle, autoFocusTitle = false, sourcePageId, onCancel, onRemove, onSave, onSelectPage }: LinkFormProps) {
  const intl = useIntl();
  const urlId = useId();
  const titleId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() => (linkedPageId(initialHref ?? "") == null ? (initialHref ?? "") : ""));
  const [title, setTitle] = useState(initialTitle ?? "");
  const [selectedPage, setSelectedPage] = useState<PageMetadata | null>(null);
  const query = value.trim();
  const url = normalizeUrl(query);
  const destination = url ?? bareHostUrl(query);
  const { items, isFetching } = usePageLinkSearch({ enabled: url == null && selectedPage == null, query: value, sourcePageId });
  const selectPage = (page: PageMetadata) => {
    setSelectedPage(page);
    setValue(page.title?.trim() || intl.formatMessage(pageMessages.untitled));
    inputRef.current?.focus({ preventScroll: true });
  };
  const { getInputProps, getItemProps, highlightedIndex, listRef } = useListNavigation({
    autoHighlightFirst: destination == null,
    getItemKey: pageKey,
    isActive: selectedPage == null && (items?.length ?? 0) > 0,
    items,
    onSelect: selectPage,
  });
  const highlighted = items?.[highlightedIndex];
  const noMatches = !isFetching && items?.length === 0 && query.length > 0;
  const expanded = selectedPage == null && url == null && (noMatches || (items?.length ?? 0) > 0);
  const canSave =
    selectedPage == null
      ? destination != null && (destination !== normalizeUrl(initialHref ?? "") || (initialTitle != null && title.trim().length > 0 && title.trim() !== initialTitle))
      : selectedPage.page_id !== linkedPageId(initialHref ?? "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    if (selectedPage != null) onSelectPage(selectedPage.page_id);
    else if (destination != null) onSave(destination, initialTitle == null ? undefined : title.trim() || initialTitle);
  };
  return (
    <form
      className="pointer-events-auto flex w-96 max-w-full flex-col gap-3 overflow-hidden rounded-xl border border-default bg-surface p-3 font-sans shadow-lg outline-none"
      tabIndex={-1}
      onKeyDown={onFormKeyDown}
      onSubmit={submit}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={urlId} className="text-sm font-medium select-none">
          <FormattedMessage {...linkMessages.field} />
        </label>
        <div className="flex items-center gap-2">
          <Input
            id={urlId}
            ref={inputRef}
            {...getInputProps<HTMLInputElement>()}
            aria-activedescendant={expanded && highlighted != null ? optionId(listId, highlighted.page_id) : undefined}
            aria-autocomplete="list"
            aria-controls={expanded ? listId : undefined}
            aria-expanded={expanded}
            aria-label={intl.formatMessage(linkMessages.input)}
            autoComplete="off"
            autoFocus={!autoFocusTitle}
            name="page-link"
            placeholder={intl.formatMessage(linkMessages.placeholder)}
            role="combobox"
            value={value}
            onChange={(event) => {
              setSelectedPage(null);
              setValue(event.currentTarget.value);
            }}
          />
          {isFetching ? <Spinner className="icon-xs" /> : null}
        </div>
      </div>
      {initialTitle == null || selectedPage != null ? null : (
        <div className="flex flex-col gap-2">
          <label htmlFor={titleId} className="text-sm font-medium select-none">
            <FormattedMessage {...linkMessages.title} />
          </label>
          <Input
            id={titleId}
            aria-label={intl.formatMessage(linkMessages.titleInput)}
            autoFocus={autoFocusTitle}
            autoComplete="off"
            value={title}
            onFocus={(event) => {
              if (autoFocusTitle) event.currentTarget.select();
            }}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </div>
      )}
      {expanded ? (
        <div ref={listRef} id={listId} className="flex max-h-64 flex-col overflow-y-auto" role="listbox">
          {(items ?? []).map((page, index) => {
            const pageTitle = page.title?.trim() || intl.formatMessage(pageMessages.untitled);
            return (
              <Button
                key={page.page_id}
                id={optionId(listId, page.page_id)}
                className="min-w-0 justify-start gap-2 px-2 py-1.5 text-start"
                {...getItemProps<HTMLButtonElement>(index)}
                aria-label={pageTitle}
                aria-selected={highlightedIndex === index}
                color={highlightedIndex === index ? "ghostActive" : "ghost"}
                role="option"
                type="button"
              >
                <PageIcon title={pageTitle} iconClassName="text-secondary">
                  {({ icon }) => icon}
                </PageIcon>
                <span className="min-w-0 flex-1 truncate">{pageTitle}</span>
              </Button>
            );
          })}
          {noMatches ? (
            <div className="px-2 py-1.5 text-sm text-tertiary">
              <FormattedMessage {...formatMessages.noMatchingPages} />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        {onRemove == null ? null : (
          <Button className="me-auto" color="ghost" size="compact" type="button" onClick={onRemove}>
            <FormattedMessage {...linkMessages.remove} />
          </Button>
        )}
        <Button color="secondary" size="compact" type="button" onClick={onCancel}>
          <FormattedMessage {...linkMessages.cancel} />
        </Button>
        <Button type="submit" size="compact" disabled={!canSave}>
          <FormattedMessage {...linkMessages.save} />
          <span aria-hidden>
            <Kbd keysLabel="↵" variant="button" />
          </span>
        </Button>
      </div>
    </form>
  );
}
