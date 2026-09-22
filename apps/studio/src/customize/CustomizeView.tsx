import React, { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CustomizeIcon } from './CustomizeIcon';
import { CustomizeCard } from './CustomizeCard';
import { CustomizeCardMenu } from './CustomizeCardMenu';
import { CustomizeDetailView } from './CustomizeDetailView';
import { CustomizeCategoryView } from './CustomizeCategoryView';
import { CustomizeSkeletonGrid } from './CustomizeSkeletonGrid';
import { GeminiDialog, GeminiDialogPill } from '@willow/ui/GeminiDialog';
import {
  CONNECTORS_DATA,
  SKILLS_DATA,
  DISCOVER_CATEGORIES,
  type CustomizeItem,
} from './customize-data';
import './CustomizeView.css';

type CustomizeTab = 'discover' | 'connectors' | 'skills';

const TAB_HEADERS: Record<CustomizeTab, { title: string; subtitle: string }> = {
  discover: {
    title: 'Customize your chats',
    subtitle: 'Tailor Gemini to work the way you do',
  },
  connectors: {
    title: 'Connected Apps',
    subtitle: 'Connect your tools to get more done',
  },
  skills: {
    title: 'Skills',
    subtitle: 'Tell Gemini how you like things done',
  },
};

export const CustomizeView: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<CustomizeTab>('discover');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<CustomizeItem | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<{
    title: string;
    items: CustomizeItem[];
  } | null>(null);
  const [loadedTabs, setLoadedTabs] = useState<Record<CustomizeTab, boolean>>({
    discover: false,
    connectors: false,
    skills: false,
  });
  const [createMenuState, setCreateMenuState] = useState<'closed' | 'open' | 'closing'>('closed');
  const createDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const pageRootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (pageRootRef.current) {
      pageRootRef.current.scrollTop = 0;
    }
  }, [selectedItem, selectedCategory, activeTab]);

  const [disconnectedConnectors, setDisconnectedConnectors] = useState<Set<string>>(new Set());
  const [activeSkillIds, setActiveSkillIds] = useState<Set<string>>(new Set(['apple-music-playlist']));
  const [inactiveSkillIds, setInactiveSkillIds] = useState<Set<string>>(new Set());
  const [customSkills, setCustomSkills] = useState<CustomizeItem[]>([]);
  const [savedSkillsData, setSavedSkillsData] = useState<Record<string, { title: string; description: string; instructions: string }>>({});

  const [cardMenu, setCardMenu] = useState<{
    item: CustomizeItem;
    triggerRect: DOMRect;
    isClosing: boolean;
    isInactive?: boolean;
  } | null>(null);
  const cardMenuTimeoutRef = useRef<number | null>(null);

  const [disconnectDialog, setDisconnectDialog] = useState<{
    item: CustomizeItem;
    isClosing: boolean;
  } | null>(null);
  const disconnectDialogTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!loadedTabs[activeTab]) {
      const timer = setTimeout(() => {
        setLoadedTabs((prev) => ({ ...prev, [activeTab]: true }));
      }, 750);
      return () => clearTimeout(timer);
    }
  }, [activeTab, loadedTabs]);

  const closeCreateMenu = () => {
    if (createMenuState !== 'open') return;
    setCreateMenuState('closing');
    closeTimeoutRef.current = window.setTimeout(() => {
      setCreateMenuState('closed');
      closeTimeoutRef.current = null;
    }, 130);
  };

  const openCreateMenu = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setCreateMenuState('open');
  };

  const toggleCreateMenu = () => {
    if (createMenuState === 'open') {
      closeCreateMenu();
    } else {
      openCreateMenu();
    }
  };

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
      if (cardMenuTimeoutRef.current) {
        clearTimeout(cardMenuTimeoutRef.current);
      }
      if (disconnectDialogTimeoutRef.current) {
        clearTimeout(disconnectDialogTimeoutRef.current);
      }
    };
  }, []);

  const openCardMenu = (item: CustomizeItem, rect: DOMRect, isInactive = false) => {
    if (cardMenuTimeoutRef.current) {
      clearTimeout(cardMenuTimeoutRef.current);
      cardMenuTimeoutRef.current = null;
    }
    setCardMenu({ item, triggerRect: rect, isClosing: false, isInactive });
  };

  const closeCardMenu = () => {
    if (!cardMenu || cardMenu.isClosing) return;
    setCardMenu((prev) => (prev ? { ...prev, isClosing: true } : null));
    cardMenuTimeoutRef.current = window.setTimeout(() => {
      setCardMenu(null);
      cardMenuTimeoutRef.current = null;
    }, 125);
  };

  const handleUseNow = (item: CustomizeItem) => {
    const slug = item.slug || item.id;
    const prompt = `/${slug} `;
    try {
      sessionStorage.setItem('pending-chat-draft', prompt);
    } catch {}
    window.dispatchEvent(new CustomEvent('willow:set-chat-draft', { detail: prompt }));
    navigate('/');
  };

  const handleEditWithGemini = (item: CustomizeItem) => {
    const name = item.slug || item.title;
    const prompt = `Help me edit the ${name} skill`;
    try {
      sessionStorage.setItem('pending-chat-draft', prompt);
    } catch {}
    window.dispatchEvent(new CustomEvent('willow:set-chat-draft', { detail: prompt }));
    navigate('/');
  };

  const handleEditManually = (item: CustomizeItem) => {
    setSelectedItem(item);
  };

  const handleDownloadSkill = (item: CustomizeItem) => {
    const edits = savedSkillsData[item.id];
    const data = {
      id: item.id,
      slug: item.slug || item.id,
      title: edits?.title || item.slug || item.title,
      description: edits?.description ?? item.description ?? '',
      instructions: edits?.instructions ?? item.instructions ?? '',
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.slug || item.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReplaceSkill = (item: CustomizeItem, content?: string) => {
    if (!content) return;
    let title = item.title;
    let description = item.description || '';
    let instructions = item.instructions || '';
    try {
      const parsed = JSON.parse(content);
      if (parsed.title) title = parsed.title;
      if (parsed.description) description = parsed.description;
      if (parsed.instructions) instructions = parsed.instructions;
    } catch {
      instructions = content;
    }
    handleSaveSkill(item, { title, description, instructions }, false);
  };

  const handleToggleActiveSkill = (item: CustomizeItem) => {
    if (inactiveSkillIds.has(item.id)) {
      setInactiveSkillIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setActiveSkillIds((prev) => new Set(prev).add(item.id));
    } else {
      setActiveSkillIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setInactiveSkillIds((prev) => new Set(prev).add(item.id));
    }
  };

  const handleDisconnectClick = (item: CustomizeItem) => {
    closeCardMenu();
    setDisconnectDialog({ item, isClosing: false });
  };

  const closeDisconnectDialog = () => {
    if (!disconnectDialog || disconnectDialog.isClosing) return;
    setDisconnectDialog((prev) => (prev ? { ...prev, isClosing: true } : null));
    disconnectDialogTimeoutRef.current = window.setTimeout(() => {
      setDisconnectDialog(null);
      disconnectDialogTimeoutRef.current = null;
    }, 125);
  };

  const handleConfirmDisconnect = () => {
    if (!disconnectDialog || disconnectDialog.isClosing) return;
    const itemId = disconnectDialog.item.id;
    setDisconnectedConnectors((prev) => new Set(prev).add(itemId));
    closeDisconnectDialog();
  };

  const handleReconnect = (itemId: string) => {
    setDisconnectedConnectors((prev) => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  };

  const formatItem = (item: CustomizeItem): CustomizeItem => {
    if (item.type === 'skill') {
      const isActive = activeSkillIds.has(item.id);
      const isInactive = inactiveSkillIds.has(item.id);
      const edits = savedSkillsData[item.id];
      const isSkillsView =
        activeTab === 'skills' ||
        selectedCategory?.title === 'Active' ||
        selectedCategory?.title === 'Inactive' ||
        selectedCategory?.title === 'All';
      return {
        ...item,
        title: edits?.title || (isActive || isInactive ? (item.slug || item.title) : item.title),
        description: edits?.description ?? item.description,
        instructions: edits?.instructions ?? item.instructions,
        hasAddButton: !isActive && !isInactive,
        hasMoreButton: isActive || isInactive,
        ...(isSkillsView ? { symbol: 'edit_note' } : {}),
      };
    }
    if (disconnectedConnectors.has(item.id)) {
      return { ...item, hasAddButton: true, hasMoreButton: false };
    }
    return item;
  };

  const handleSaveSkill = (
    savedItem: CustomizeItem,
    data: { title: string; description: string; instructions: string },
    isNew: boolean,
  ) => {
    setSavedSkillsData((prev) => ({
      ...prev,
      [savedItem.id]: data,
    }));
    setActiveSkillIds((prev) => new Set(prev).add(savedItem.id));
    if (isNew && !SKILLS_DATA.some((s) => s.id === savedItem.id)) {
      setCustomSkills((prev) => [
        ...prev,
        {
          ...savedItem,
          title: data.title,
          description: data.description,
          instructions: data.instructions,
          hasMoreButton: true,
          hasAddButton: false,
        },
      ]);
    }
    setSelectedItem(null);
  };

  const handleDeleteSkill = (skillId: string) => {
    setActiveSkillIds((prev) => {
      const next = new Set(prev);
      next.delete(skillId);
      return next;
    });
    setInactiveSkillIds((prev) => {
      const next = new Set(prev);
      next.delete(skillId);
      return next;
    });
    setCustomSkills((prev) => prev.filter((s) => s.id !== skillId));
    if (selectedItem?.id === skillId) {
      setSelectedItem(null);
    }
    if (cardMenu?.item.id === skillId) {
      closeCardMenu();
    }
  };

  const handleActionClick = (e: React.MouseEvent, item: CustomizeItem) => {
    if (item.type === 'skill') {
      if (item.hasAddButton) {
        setSelectedItem(item);
        return;
      }
      if (item.hasMoreButton) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const isInactive = inactiveSkillIds.has(item.id);
        openCardMenu(item, rect, isInactive);
        return;
      }
    }
    if (item.hasAddButton || disconnectedConnectors.has(item.id)) {
      handleReconnect(item.id);
      return;
    }
    if (item.hasMoreButton) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openCardMenu(item, rect);
    }
  };

  useEffect(() => {
    if (createMenuState !== 'open') return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        createDropdownRef.current &&
        !createDropdownRef.current.contains(e.target as Node)
      ) {
        closeCreateMenu();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeCreateMenu();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [createMenuState]);

  const activeSkills = useMemo(() => {
    const list: CustomizeItem[] = [];
    for (const item of SKILLS_DATA) {
      if (activeSkillIds.has(item.id)) {
        const edits = savedSkillsData[item.id];
        list.push({
          ...item,
          title: edits?.title || item.slug || item.title,
          description: edits?.description ?? item.description,
          instructions: edits?.instructions ?? item.instructions,
          hasMoreButton: true,
          hasAddButton: false,
          symbol: 'edit_note',
        });
      }
    }
    for (const item of customSkills) {
      if (activeSkillIds.has(item.id)) {
        const edits = savedSkillsData[item.id];
        list.push({
          ...item,
          title: edits?.title || item.title,
          description: edits?.description ?? item.description,
          instructions: edits?.instructions ?? item.instructions,
          hasMoreButton: true,
          hasAddButton: false,
          symbol: 'edit_note',
        });
      }
    }
    return list;
  }, [activeSkillIds, customSkills, savedSkillsData]);

  const inactiveSkills = useMemo(() => {
    const list: CustomizeItem[] = [];
    for (const item of SKILLS_DATA) {
      if (inactiveSkillIds.has(item.id)) {
        const edits = savedSkillsData[item.id];
        list.push({
          ...item,
          title: edits?.title || item.slug || item.title,
          description: edits?.description ?? item.description,
          instructions: edits?.instructions ?? item.instructions,
          hasMoreButton: true,
          hasAddButton: false,
          symbol: 'edit_note',
        });
      }
    }
    for (const item of customSkills) {
      if (inactiveSkillIds.has(item.id)) {
        const edits = savedSkillsData[item.id];
        list.push({
          ...item,
          title: edits?.title || item.title,
          description: edits?.description ?? item.description,
          instructions: edits?.instructions ?? item.instructions,
          hasMoreButton: true,
          hasAddButton: false,
          symbol: 'edit_note',
        });
      }
    }
    return list;
  }, [inactiveSkillIds, customSkills, savedSkillsData]);

  const allSkills = useMemo(() => {
    return SKILLS_DATA.filter(
      (item) => !activeSkillIds.has(item.id) && !inactiveSkillIds.has(item.id),
    ).map((item) => ({
      ...item,
      hasAddButton: true,
      hasMoreButton: false,
      symbol: 'edit_note',
    }));
  }, [activeSkillIds, inactiveSkillIds]);

  const activeConnectors = useMemo(
    () => CONNECTORS_DATA.filter((item) => item.id !== 'contacts' && item.hasMoreButton && !disconnectedConnectors.has(item.id)),
    [disconnectedConnectors],
  );

  const allConnectors = useMemo(() => {
    const list = CONNECTORS_DATA.filter((item) => item.id === 'contacts' || item.hasAddButton || disconnectedConnectors.has(item.id));
    return list.map((item) => {
      if (disconnectedConnectors.has(item.id)) {
        return { ...item, hasAddButton: true, hasMoreButton: false };
      }
      return item;
    });
  }, [disconnectedConnectors]);

  const matchesSearch = (item: CustomizeItem, query: string) => {
    if (!query) return true;
    return (
      item.title.toLowerCase().includes(query) ||
      item.subtitle.toLowerCase().includes(query) ||
      (item.description && item.description.toLowerCase().includes(query)) ||
      (item.category && item.category.toLowerCase().includes(query))
    );
  };

  const filteredDiscoverCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return DISCOVER_CATEGORIES.map((category) => ({
      ...category,
      items: category.items.filter((item) => matchesSearch(item, query)),
    })).filter((category) => category.items.length > 0);
  }, [searchQuery]);

  const filteredActiveConnectors = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return activeConnectors;
    return activeConnectors.filter((item) => matchesSearch(item, query));
  }, [activeConnectors, searchQuery]);

  const filteredAllConnectors = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return allConnectors;
    return allConnectors.filter((item) => matchesSearch(item, query));
  }, [allConnectors, searchQuery]);

  const filteredActiveSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return activeSkills;
    return activeSkills.filter((item) => matchesSearch(item, query));
  }, [activeSkills, searchQuery]);

  const filteredInactiveSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return inactiveSkills;
    return inactiveSkills.filter((item) => matchesSearch(item, query));
  }, [inactiveSkills, searchQuery]);

  const filteredAllSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return allSkills;
    return allSkills.filter((item) => matchesSearch(item, query));
  }, [allSkills, searchQuery]);

  const handleClearSearch = () => {
    setSearchQuery('');
  };

  if (selectedItem) {
    const currentItem = formatItem(selectedItem);
    const isDisconnected = disconnectedConnectors.has(currentItem.id) || currentItem.hasAddButton;
    return (
      <div
        key={`detail-${currentItem.id}`}
        ref={pageRootRef}
        className="customize-page-root gemini-chat-scrollbar"
      >
        <CustomizeDetailView
          item={currentItem}
          fromTab={selectedCategory ? selectedCategory.title : activeTab}
          onBack={() => setSelectedItem(null)}
          onSelect={(item) => setSelectedItem(item)}
          isDisconnected={isDisconnected}
          onDisconnect={(item) => {
            setDisconnectedConnectors((prev) => new Set(prev).add(item.id));
            setSelectedItem(null);
          }}
          onReconnect={(item) => {
            handleReconnect(item.id);
          }}
          onSaveSkill={handleSaveSkill}
          onDeleteSkill={handleDeleteSkill}
          onUseNow={handleUseNow}
          onEditWithGemini={handleEditWithGemini}
          onDownloadSkill={handleDownloadSkill}
          onReplaceSkill={handleReplaceSkill}
          onToggleActiveSkill={handleToggleActiveSkill}
          isInactive={inactiveSkillIds.has(currentItem.id)}
        />
      </div>
    );
  }

  const renderModals = () => (
    <>
      {cardMenu && (
        <CustomizeCardMenu
          item={cardMenu.item}
          triggerRect={cardMenu.triggerRect}
          isOpen={!cardMenu.isClosing}
          isClosing={cardMenu.isClosing}
          onClose={closeCardMenu}
          onDisconnect={handleDisconnectClick}
          onDeleteSkill={(item) => handleDeleteSkill(item.id)}
          onUseNow={handleUseNow}
          onEditWithGemini={handleEditWithGemini}
          onEditManually={handleEditManually}
          onDownloadSkill={handleDownloadSkill}
          onReplaceSkill={handleReplaceSkill}
          onToggleActiveSkill={handleToggleActiveSkill}
          isInactive={cardMenu.isInactive}
        />
      )}

      {disconnectDialog && (
        <GeminiDialog
          headingAs="h2"
          title={`Disconnect ${disconnectDialog.item.title} from Willow?`}
          width={512}
          closing={disconnectDialog.isClosing}
          onDismiss={closeDisconnectDialog}
          actions={(
            <>
              <GeminiDialogPill
                className="willow-gdlg-pill--text"
                disabled={disconnectDialog.isClosing}
                onClick={closeDisconnectDialog}
              >
                Cancel
              </GeminiDialogPill>
              <GeminiDialogPill
                disabled={disconnectDialog.isClosing}
                onClick={handleConfirmDisconnect}
              >
                Disconnect
              </GeminiDialogPill>
            </>
          )}
        >
          <div className="customize-disconnect-dialog-content">
            <div className="customize-disconnect-section">
              <h3 className="customize-disconnect-section-title">
                Disconnecting apps and deleting data
              </h3>
              <p className="customize-disconnect-section-text">
                Disconnecting an app or deleting data in a Connected App doesn&apos;t delete any data from Willow Activity. You can manage and delete your Willow activity anytime. Deleting Willow activity also doesn&apos;t delete data in other services.
              </p>
            </div>
            <div className="customize-disconnect-section">
              <h3 className="customize-disconnect-section-title">
                What&apos;s not changing
              </h3>
              <p className="customize-disconnect-section-text">
                Your choices here don&apos;t change other personalization settings. For example, if your memory setting is on, Willow still uses your past chats to personalize your experience. Also, your choices here don&apos;t change whether other services exchange data and whether Connected Apps use data to improve their own services. Other services continue personalizing and sharing data according to their own settings.
              </p>
              <p className="customize-disconnect-section-text" style={{ marginTop: '12px' }}>
                Your choices here don&apos;t change Willow&apos;s ability to use public data to respond to you. For example, if Search services and YouTube aren&apos;t connected, Willow can still use public websites and videos in Google Search and YouTube to respond to you.
              </p>
            </div>
          </div>
        </GeminiDialog>
      )}
    </>
  );

  if (selectedCategory) {
    const categoryItems = selectedCategory.title === 'Active'
      ? (activeTab === 'skills' ? activeSkills : activeConnectors)
      : selectedCategory.title === 'Inactive'
        ? inactiveSkills
        : selectedCategory.title === 'All'
          ? (activeTab === 'skills' ? allSkills : allConnectors)
          : selectedCategory.items.map(formatItem);
    return (
      <>
        <CustomizeCategoryView
          categoryTitle={selectedCategory.title}
          items={categoryItems}
          fromTab={activeTab}
          onBack={() => setSelectedCategory(null)}
          onSelect={(item) => setSelectedItem(item)}
          onActionClick={handleActionClick}
        />
        {renderModals()}
      </>
    );
  }

  return (
    <div
      key={`main-${activeTab}`}
      ref={pageRootRef}
      className="customize-page-root gemini-chat-scrollbar"
    >
      <div className="customize-window">
        {/* Top Category Tabs */}
        <div
          className="customize-nav-buttons"
          role="tablist"
          aria-label="Customize categories"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'discover'}
            className={`customize-nav-button ${activeTab === 'discover' ? 'selected' : ''}`}
            onClick={() => {
              setActiveTab('discover');
              setSelectedCategory(null);
              setSearchQuery('');
              if (closeTimeoutRef.current) {
                clearTimeout(closeTimeoutRef.current);
                closeTimeoutRef.current = null;
              }
              setCreateMenuState('closed');
            }}
          >
            Discover
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'connectors'}
            className={`customize-nav-button ${activeTab === 'connectors' ? 'selected' : ''}`}
            onClick={() => {
              setActiveTab('connectors');
              setSelectedCategory(null);
              setSearchQuery('');
              if (closeTimeoutRef.current) {
                clearTimeout(closeTimeoutRef.current);
                closeTimeoutRef.current = null;
              }
              setCreateMenuState('closed');
            }}
          >
            Connectors
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'skills'}
            className={`customize-nav-button ${activeTab === 'skills' ? 'selected' : ''}`}
            onClick={() => {
              setActiveTab('skills');
              setSelectedCategory(null);
              setSearchQuery('');
              if (closeTimeoutRef.current) {
                clearTimeout(closeTimeoutRef.current);
                closeTimeoutRef.current = null;
              }
              setCreateMenuState('closed');
            }}
          >
            Skills
          </button>
        </div>

        {/* Page Header with Title and Search / Actions */}
        <header className="customize-page-header">
          <div className="customize-header-text">
            <h1 className="customize-header-title">{TAB_HEADERS[activeTab].title}</h1>
            <p className="customize-header-subtitle">
              {TAB_HEADERS[activeTab].subtitle}
            </p>
          </div>

          <div className="customize-header-actions">
            <div className="customize-search-container" role="search">
              <CustomizeIcon
                name="search"
                size={20}
                className="customize-search-icon"
              />
              <input
                type="text"
                className="customize-search-input"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="customize-search-clear"
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                >
                  <CustomizeIcon name="close" size={16} />
                </button>
              )}
            </div>

            {activeTab === 'skills' && (
              <div
                className="customize-create-dropdown-container"
                ref={createDropdownRef}
              >
                <button
                  type="button"
                  className={`customize-create-button ${createMenuState === 'open' ? 'open' : ''}`}
                  onClick={toggleCreateMenu}
                  aria-haspopup="menu"
                  aria-expanded={createMenuState === 'open'}
                  aria-label="Create"
                >
                  <span className="customize-create-button-label">Create</span>
                  <CustomizeIcon
                    name="arrow_drop_down"
                    size={24}
                    className="customize-create-arrow-icon"
                  />
                </button>

                {createMenuState !== 'closed' && (
                  <div
                    role="menu"
                    className={`customize-create-menu-panel ${createMenuState === 'closing' ? 'closing' : ''}`}
                    aria-label="Create options"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="customize-create-menu-item"
                      onClick={() => {
                        closeCreateMenu();
                      }}
                    >
                      <span className="customize-create-menu-icon">
                        <CustomizeIcon name="chat_bubble" size={16} />
                      </span>
                      <span className="customize-create-menu-text">
                        Create with Gemini
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="customize-create-menu-item"
                      onClick={() => {
                        closeCreateMenu();
                        setSelectedItem({
                          id: `new-skill-${Date.now()}`,
                          type: 'skill',
                          title: '',
                          subtitle: '',
                          hasAddButton: true,
                          description: '',
                          instructions: '',
                        });
                      }}
                    >
                      <span className="customize-create-menu-icon">
                        <CustomizeIcon name="edit" size={16} />
                      </span>
                      <span className="customize-create-menu-text">
                        Create manually
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="customize-create-menu-item"
                      onClick={() => {
                        closeCreateMenu();
                        fileInputRef.current?.click();
                      }}
                    >
                      <span className="customize-create-menu-icon">
                        <CustomizeIcon name="upload" size={16} />
                      </span>
                      <span className="customize-create-menu-text">
                        Upload
                      </span>
                    </button>
                  </div>
                )}
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={() => {
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                />
              </div>
            )}
          </div>
        </header>

        {/* Content Section */}
        {!loadedTabs[activeTab] ? (
          <CustomizeSkeletonGrid tab={activeTab} />
        ) : activeTab === 'discover' ? (
          filteredDiscoverCategories.length === 0 ? (
            <div className="customize-no-results">No results found</div>
          ) : (
            <div className="customize-discover-content">
              {filteredDiscoverCategories.map((category) => (
                <section
                  key={category.id}
                  className="customize-category-section"
                >
                  <div
                    role="button"
                    tabIndex={0}
                    className="customize-category-header"
                    onClick={() => {
                      setSelectedCategory({
                        title: category.title,
                        items: category.items,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedCategory({
                          title: category.title,
                          items: category.items,
                        });
                      }
                    }}
                  >
                    <h2 className="customize-category-title">
                      {category.title}
                    </h2>
                    <CustomizeIcon
                      name="keyboard_arrow_right"
                      size={28}
                      className="customize-category-chevron"
                    />
                  </div>

                  <div className="discover-grid">
                    {category.items.map(formatItem).map((item) => (
                      <CustomizeCard
                        key={`${category.id}-${item.id}`}
                        item={item}
                        onSelect={(selected) => setSelectedItem(selected)}
                        onActionClick={handleActionClick}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : activeTab === 'connectors' ? (
          filteredActiveConnectors.length === 0 && filteredAllConnectors.length === 0 ? (
            <div className="customize-no-results">No results found</div>
          ) : (
            <div className="customize-connectors-content">
              {/* Active Section */}
              {filteredActiveConnectors.length > 0 && (
                <section className="customize-category-section">
                  <div
                    role="button"
                    tabIndex={0}
                    className="customize-category-header"
                    onClick={() => {
                      setSelectedCategory({
                        title: 'Active',
                        items: filteredActiveConnectors,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedCategory({
                          title: 'Active',
                          items: filteredActiveConnectors,
                        });
                      }
                    }}
                  >
                    <h2 className="customize-category-title">Active</h2>
                    <CustomizeIcon
                      name="keyboard_arrow_right"
                      size={28}
                      className="customize-category-chevron"
                    />
                  </div>
                  <div className="connectors-grid">
                    {filteredActiveConnectors.map((item) => (
                      <CustomizeCard
                        key={item.id}
                        item={item}
                        onSelect={(selected) => setSelectedItem(selected)}
                        onActionClick={handleActionClick}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* All Section */}
              {filteredAllConnectors.length > 0 && (
                <section className="customize-category-section">
                  <div
                    role="button"
                    tabIndex={0}
                    className="customize-category-header"
                    onClick={() => {
                      setSelectedCategory({
                        title: 'All',
                        items: filteredAllConnectors,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedCategory({
                          title: 'All',
                          items: filteredAllConnectors,
                        });
                      }
                    }}
                  >
                    <h2 className="customize-category-title">All</h2>
                    <CustomizeIcon
                      name="keyboard_arrow_right"
                      size={28}
                      className="customize-category-chevron"
                    />
                  </div>
                  <div className="connectors-grid">
                    {filteredAllConnectors.map((item) => (
                      <CustomizeCard
                        key={item.id}
                        item={item}
                        onSelect={(selected) => setSelectedItem(selected)}
                        onActionClick={handleActionClick}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )
        ) : (
          filteredActiveSkills.length === 0 &&
          filteredInactiveSkills.length === 0 &&
          filteredAllSkills.length === 0 ? (
            <div className="customize-no-results">No results found</div>
          ) : (
            <div className="customize-skills-content">
              {/* Active Section */}
              {filteredActiveSkills.length > 0 && (
                <section className="customize-category-section">
                  <div
                    role="button"
                    tabIndex={0}
                    className="customize-category-header"
                    onClick={() => {
                      setSelectedCategory({
                        title: 'Active',
                        items: filteredActiveSkills,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedCategory({
                          title: 'Active',
                          items: filteredActiveSkills,
                        });
                      }
                    }}
                  >
                    <h2 className="customize-category-title">Active</h2>
                    <CustomizeIcon
                      name="keyboard_arrow_right"
                      size={28}
                      className="customize-category-chevron"
                    />
                  </div>
                  <div className="skills-grid">
                    {filteredActiveSkills.map((item) => (
                      <CustomizeCard
                        key={item.id}
                        item={item}
                        onSelect={(selected) => setSelectedItem(selected)}
                        onActionClick={handleActionClick}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Inactive Section */}
              {filteredInactiveSkills.length > 0 && (
                <section className="customize-category-section">
                  <div
                    role="button"
                    tabIndex={0}
                    className="customize-category-header"
                    onClick={() => {
                      setSelectedCategory({
                        title: 'Inactive',
                        items: filteredInactiveSkills,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedCategory({
                          title: 'Inactive',
                          items: filteredInactiveSkills,
                        });
                      }
                    }}
                  >
                    <h2 className="customize-category-title">Inactive</h2>
                    <CustomizeIcon
                      name="keyboard_arrow_right"
                      size={28}
                      className="customize-category-chevron"
                    />
                  </div>
                  <div className="skills-grid">
                    {filteredInactiveSkills.map((item) => (
                      <CustomizeCard
                        key={item.id}
                        item={item}
                        onSelect={(selected) => setSelectedItem(selected)}
                        onActionClick={handleActionClick}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* All Section */}
              {filteredAllSkills.length > 0 && (
                <section className="customize-category-section">
                  <div
                    role="button"
                    tabIndex={0}
                    className="customize-category-header"
                    onClick={() => {
                      setSelectedCategory({
                        title: 'All',
                        items: filteredAllSkills,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedCategory({
                          title: 'All',
                          items: filteredAllSkills,
                        });
                      }
                    }}
                  >
                    <h2 className="customize-category-title">All</h2>
                    <CustomizeIcon
                      name="keyboard_arrow_right"
                      size={28}
                      className="customize-category-chevron"
                    />
                  </div>
                  <div className="skills-grid">
                    {filteredAllSkills.map((item) => (
                      <CustomizeCard
                        key={item.id}
                        item={item}
                        onSelect={(selected) => setSelectedItem(selected)}
                        onActionClick={handleActionClick}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )
        )}
      </div>

      {renderModals()}
    </div>
  );
};

export default CustomizeView;
