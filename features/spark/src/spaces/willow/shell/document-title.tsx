import { useEffect } from 'react';

/** Updates the existing `<title>` text node when possible instead of replacing it. */
function setDocumentTitle(title: string) {
  const node = document.head.querySelector('title')?.firstChild;
  if (node instanceof Text && node.nextSibling == null) node.data = title;
  else document.title = title;
}

/** `document-title`: sets the window title while mounted; restores it unless something else changed it since. */
export function DocumentTitle({ title }: { title: string | null | undefined }) {
  useEffect(() => {
    if (title == null) return;
    const previous = document.title;
    setDocumentTitle(title);
    const applied = document.title;
    return () => {
      if (document.title === applied) setDocumentTitle(previous);
    };
  }, [title]);
  return null;
}
