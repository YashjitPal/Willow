/**
 * The grouped list of what Willow remembers.
 *
 * Its own file rather than more of `MemoryTab.tsx`: the page around it is a
 * header, three buttons and a status line, and the list is four sections of rows
 * each with a menu, a provenance line and its own empty state. Kept together
 * they would be one 500-line component where the interesting part — a row —
 * is buried.
 *
 * `groupBulletsBySection` returns an entry for all four sections including empty
 * ones, because the prompt block needs stable headings. A settings page does
 * not: an empty "Relationships" heading with nothing under it reads as a bug.
 * So empties are filtered here, not there.
 */

import React, { useEffect, useRef, useState } from 'react';
import { groupBulletsBySection, type ProfileBullet } from '@willow/personal';

export interface MemoryListProps {
  bullets: ProfileBullet[];
  onEdit: (bullet: ProfileBullet) => void;
  onDelete: (id: string) => void;
}

/** `2026-08-11` → `11 Aug 2026`, and anything unparseable back to itself. */
const formatDate = (value: string): string => {
  const at = Date.parse(`${value}T00:00:00`);
  if (!Number.isFinite(at)) return value;
  return new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const MemoryRow: React.FC<{
  bullet: ProfileBullet;
  borderClass: string;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ bullet, borderClass, isMenuOpen, onToggleMenu, onEdit, onDelete }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Same arrangement as Saved Info: mousedown rather than click, so the menu is
  // already gone by the time the click lands on whatever is underneath it.
  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onToggleMenu();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen, onToggleMenu]);

  return (
    <div className={`mem-row ${borderClass}`}>
      <div className="mem-row-body">
        <div className="mem-row-text mem-body-l">{bullet.text}</div>
        <div className="mem-row-meta mem-label-s">
          <span className="mem-row-source">{bullet.source}</span>
          {bullet.date ? <span className="mem-row-date">{formatDate(bullet.date)}</span> : null}
          {bullet.origin === 'user' ? <span className="mem-row-badge">Yours</span> : null}
        </div>
        {/* The receipt. Without it the list is a set of assertions the user has
            no way to check, and "why does it think that?" has no answer. */}
        {bullet.evidence ? <div className="mem-row-evidence mem-label-s">{bullet.evidence}</div> : null}
      </div>

      <button
        type="button"
        className="mem-row-actions"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        onClick={(event) => {
          event.stopPropagation();
          onToggleMenu();
        }}
      >
        <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color">more_vert</span>
      </button>

      {isMenuOpen && (
        <div ref={menuRef} className="mem-row-menu" role="menu">
          <button type="button" role="menuitem" className="mem-menu-item" onClick={onEdit}>
            <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color">edit</span>
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            className="mem-menu-item mem-menu-item-danger"
            onClick={onDelete}
          >
            <span className="mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color">delete</span>
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export const MemoryList: React.FC<MemoryListProps> = ({ bullets, onEdit, onDelete }) => {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const groups = groupBulletsBySection(bullets).filter((group) => group.bullets.length > 0);

  if (groups.length === 0) return null;

  return (
    <div className="mem-groups">
      {groups.map(({ section, bullets: sectionBullets }) => (
        <section className="mem-group" key={section.id}>
          <header className="mem-group-header">
            <h3 className="mem-group-heading mem-title-l">{section.heading}</h3>
            <span className="mem-group-count mem-label-s">
              {sectionBullets.length} of {section.cap}
            </span>
          </header>
          <p className="mem-group-guidance mem-body-m">{section.guidance}</p>

          <div className="mem-rows">
            {sectionBullets.map((bullet, index) => {
              let borderClass = 'mem-middle-item';
              if (sectionBullets.length === 1) borderClass = 'mem-single-item';
              else if (index === 0) borderClass = 'mem-first-item';
              else if (index === sectionBullets.length - 1) borderClass = 'mem-last-item';

              return (
                <MemoryRow
                  key={bullet.id}
                  bullet={bullet}
                  borderClass={borderClass}
                  isMenuOpen={activeMenuId === bullet.id}
                  onToggleMenu={() => setActiveMenuId((current) => (current === bullet.id ? null : bullet.id))}
                  onEdit={() => {
                    setActiveMenuId(null);
                    onEdit(bullet);
                  }}
                  onDelete={() => {
                    setActiveMenuId(null);
                    onDelete(bullet.id);
                  }}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
