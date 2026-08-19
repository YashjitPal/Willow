/**
 * A minimal section model for the vendored Codex prompt.
 *
 * The overlay needs to rewrite parts of a document it does not own and must not
 * edit. Doing that with string search-and-replace would break on the first
 * upstream reword; addressing *headings* instead is stable, because upstream
 * reorganises prose far more often than it renames a section.
 *
 * Sections are addressed by their heading path, e.g.
 * `['Tool Guidelines', 'Shell commands']`, which disambiguates the several
 * `### Examples` headings that appear under different parents.
 */

export interface Section {
  /** Heading depth, 1–6. The preamble before any heading is depth 0. */
  level: number;
  /** Heading text without the leading hashes. Empty for the preamble. */
  title: string;
  /** Ancestor titles, outermost first, excluding this section's own title. */
  path: string[];
  /** Body lines, excluding the heading line itself. */
  lines: string[];
}

const HEADING = /^(#{1,6})\s+(.*)$/;

export function parseSections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];

  // Titles of the currently open ancestors, indexed by level.
  const open: string[] = [];
  let current: Section = { level: 0, title: '', path: [], lines: [] };

  for (const line of lines) {
    const match = HEADING.exec(line);
    if (!match) {
      current.lines.push(line);
      continue;
    }

    sections.push(current);

    const level = match[1]!.length;
    const title = match[2]!.trim();

    open.length = level - 1;
    const path = open.filter((entry) => entry !== undefined);
    open[level - 1] = title;

    current = { level, title, path, lines: [] };
  }

  sections.push(current);
  return sections;
}

export function serializeSections(sections: Section[]): string {
  const out: string[] = [];
  for (const section of sections) {
    if (section.level > 0) {
      out.push(`${'#'.repeat(section.level)} ${section.title}`);
    }
    out.push(...section.lines);
  }
  return out.join('\n');
}

/** True when `section` is the one addressed by `selector`. */
export function matchesSelector(section: Section, selector: string[]): boolean {
  if (selector.length === 0) return section.level === 0;
  const full = [...section.path, section.title];
  if (full.length < selector.length) return false;
  // Compare from the end so a selector may be a suffix of the full path.
  for (let i = 1; i <= selector.length; i += 1) {
    if (full[full.length - i] !== selector[selector.length - i]) return false;
  }
  return true;
}

/** True when `section` sits underneath the section addressed by `selector`. */
export function isDescendantOf(section: Section, selector: string[]): boolean {
  if (selector.length === 0) return section.level > 0;
  const parent = selector[selector.length - 1];
  return section.path.includes(parent as string);
}
