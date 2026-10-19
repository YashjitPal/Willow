import React, { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@nanostores/react';
import { mcpServers } from '@willow/ai/mcp/mcp-store';
import { requestSeededChat } from '@willow/core/shell-request';
import { ensureSkillsHydrated, skillLibrary } from '@willow/core/skill-library';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { SKILL_SEED_PROMPT, SKILL_SEED_REPLY } from '@willow/spark/spark-create-with';
import { useConnections } from '../settings/tabs/connected-apps/use-connections';
import { ConnectConsentDialog, type ConnectConsentRequest } from '../settings/tabs/connected-apps/ConnectConsentDialog';
import { GithubTokenRow } from '../settings/tabs/connected-apps/GithubTokenRow';
import { OAuthClientSetup } from '../settings/tabs/connected-apps/OAuthClientSetup';
import { GooglePermissions } from '../settings/tabs/connected-apps/ConnectedAppsTab';
import '../settings/tabs/connected-apps/ConnectedAppsTab.css';
import { $customizeTabRequest, type CustomizeTab } from './customize-nav';
import { connectorCardId, connectorMention } from './customize-connectors';
import {
  addMcpCard,
  mcpCardServer,
  mcpCardSignsIn,
  mcpCardSignsInToSite,
  mcpPresetFor,
  removeMcpCard,
  signInMcpCard,
  signInMcpSession,
} from './customize-mcp';
import { CustomizeMcpConnect, useMcpSignIn, useSiteSignIn } from './CustomizeMcpConnect';
import { useCompactViewport } from '@willow/chat/use-compact-viewport';
import { CustomizeIcon } from './CustomizeIcon';
import { CustomizeCard } from './CustomizeCard';
import { CustomizeCardMenu, cardMenuExitMs } from './CustomizeCardMenu';
import { CustomizeDetailView } from './CustomizeDetailView';
import { CustomizeCategoryView } from './CustomizeCategoryView';
import { CustomizeSkeletonGrid } from './CustomizeSkeletonGrid';
import { GeminiDialog, GeminiDialogPill } from '@willow/ui/GeminiDialog';
import { showCopyToast } from '@willow/ui/copy-toast-store';
import { CustomizeMobileActions } from './CustomizeMobileActions';
import { CustomAppDetail } from './custom-app/CustomAppDetail';
import { CustomAppFlow } from './custom-app/CustomAppDialogs';
import { LmIcon } from './custom-app/LmIcon';
import { customAppServerId, deleteCustomApp, disconnectCustomApp, isCustomAppItem, reconnectCustomApp } from './custom-app/custom-app';
import { useCustomApps } from './custom-app/use-custom-apps';
import {
  CONNECTORS_DATA,
  SKILLS_DATA,
  DISCOVER_CATEGORIES,
  type CustomizeItem,
} from './customize-data';
import { customizeSkillName, customizeSkills, parseSkillFile, toLibrarySkills, useCustomizeSkills } from './customize-skills';
import './CustomizeView.css';

/** Skills other surfaces put in the library (chat's "Create with Gemini", Spark), listed by id. */
const LIBRARY_ITEM_PREFIX = 'library:';
const isLibraryItem = (item: CustomizeItem): boolean => item.id.startsWith(LIBRARY_ITEM_PREFIX);

const TAB_HEADERS: Record<CustomizeTab, { title: string; subtitle: string }> = {
  discover: {
    title: 'Customize Willow',
    subtitle: 'Add apps and skills so that Willow can work smarter for you',
  },
  connectors: {
    title: 'Connected apps',
    subtitle: 'Find and connect apps to get more done',
  },
  skills: {
    title: 'Skills',
    subtitle: 'Add or create skills to extend what Willow can do',
  },
};

/**
 * Where the page was left: Customize is one of the rail's tabs, and each opens where it was — after a
 * reload too (an update, the agents starting), kept in `sessionStorage` as the rail's places are.
 */
const LEFT_KEY = 'willow:customize-left';
const TABS: readonly CustomizeTab[] = ['discover', 'connectors', 'skills'];
const isItem = (value: unknown): value is CustomizeItem =>
  Boolean(value) && typeof (value as CustomizeItem).id === 'string' && typeof (value as CustomizeItem).title === 'string';
/** A stored connector is re-read from the list, so a card since removed does not reopen. */
const current = (item: CustomizeItem): CustomizeItem | null =>
  item.type === 'connector' ? CONNECTORS_DATA.find((connector) => connector.id === item.id) ?? null : item;
const restore = (value: unknown): CustomizeItem | null => (isItem(value) ? current(value) : null);
const readLeft = (): {
  tab: CustomizeTab;
  item: CustomizeItem | null;
  category: { title: string; items: CustomizeItem[] } | null;
} => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(LEFT_KEY) || 'null');
    const category = stored?.category;
    return {
      tab: TABS.includes(stored?.tab) ? stored.tab : 'discover',
      item: restore(stored?.item),
      category: category && typeof category.title === 'string' && Array.isArray(category.items)
        ? { title: category.title, items: category.items.map(restore).filter(isItem) }
        : null,
    };
  } catch {
    return { tab: 'discover', item: null, category: null };
  }
};
const left = readLeft();

export const CustomizeView: React.FC = () => {
  const navigate = useNavigate();
  const isCompact = useCompactViewport();
  // Another surface asked for a tab (Settings → Connected Apps, the Skills menu row).
  const tabRequest = useStore($customizeTabRequest);
  if (tabRequest) {
    left.tab = tabRequest;
    left.item = null;
    left.category = null;
  }
  const [activeTab, setActiveTab] = useState<CustomizeTab>(() => left.tab);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<CustomizeItem | null>(() => left.item);
  const [selectedCategory, setSelectedCategory] = useState<{
    title: string;
    items: CustomizeItem[];
  } | null>(() => left.category);
  useEffect(() => {
    if (!tabRequest) return;
    setActiveTab(tabRequest);
    setSelectedItem(null);
    setSelectedCategory(null);
    setSearchQuery('');
    $customizeTabRequest.set(null);
  }, [tabRequest]);
  useEffect(() => {
    left.tab = activeTab;
    left.item = selectedItem;
    left.category = selectedCategory;
    try {
      sessionStorage.setItem(LEFT_KEY, JSON.stringify(left));
    } catch {}
  }, [activeTab, selectedItem, selectedCategory]);
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

  // Real grants, from the same hook the old Connected Apps page used.
  const {
    setup: connectorSetup,
    githubLogin,
    notice: connectorNotice,
    dismissNotice: dismissConnectorNotice,
    stateFor,
    toggleConnection,
    connectGithubToken,
  } = useConnections();
  const [connectNotice, setConnectNotice] = useState<string | null>(null);
  const [consent, setConsent] = useState<(ConnectConsentRequest & { confirm: () => void; cancel: () => void }) | null>(null);
  // The cards connected as their vendors' MCP servers (`customize-mcp.ts`).
  const mcpList = useStore(mcpServers);
  const canSignIn = useMcpSignIn();
  const canSignInToSites = useSiteSignIn();
  const [mcpFocus, setMcpFocus] = useState<{ id: string; at: number } | null>(null);
  const isConnected = (item: CustomizeItem): boolean => {
    if (isCustomAppItem(item)) return mcpList.some((server) => server.id === customAppServerId(item) && server.enabled);
    const preset = mcpPresetFor(item);
    return preset ? Boolean(mcpCardServer(preset, mcpList)) : stateFor(connectorCardId(item.id)).connected;
  };

  // Persisted, and published into the skill library the Code harness reads.
  const {
    activeSkillIds,
    setActiveSkillIds,
    inactiveSkillIds,
    setInactiveSkillIds,
    customSkills,
    setCustomSkills,
    savedSkillsData,
    setSavedSkillsData,
  } = useCustomizeSkills();

  // Skills made elsewhere — chat's "Create with Gemini" saves through Spark — listed read-only.
  const { chatScopeId } = useLocalFS();
  useEffect(() => {
    if (chatScopeId) ensureSkillsHydrated(chatScopeId);
  }, [chatScopeId]);
  const library = useStore(skillLibrary);
  const customizeState = useStore(customizeSkills);
  const librarySkills = useMemo<CustomizeItem[]>(() => {
    const own = new Set(toLibrarySkills(customizeState).map((skill) => skill.id));
    return library
      .filter((skill) => skill.enabled && !own.has(skill.id))
      .map((skill) => ({
        id: `${LIBRARY_ITEM_PREFIX}${skill.id}`,
        type: 'skill',
        title: skill.name,
        subtitle: skill.shortDescription || skill.description,
        description: skill.description,
        instructions: skill.instructions,
        hasMoreButton: true,
        symbol: 'edit_note',
      }));
  }, [library, customizeState]);

  const [cardMenu, setCardMenu] = useState<{
    item: CustomizeItem;
    triggerRect: DOMRect;
    isClosing: boolean;
    isInactive?: boolean;
    /** Opened on the item's own page, whose header already has Disconnect (app-details-overflow-menu). */
    onPage?: boolean;
  } | null>(null);
  const cardMenuTimeoutRef = useRef<number | null>(null);

  const [disconnectDialog, setDisconnectDialog] = useState<{
    item: CustomizeItem;
    isClosing: boolean;
  } | null>(null);
  const disconnectDialogTimeoutRef = useRef<number | null>(null);

  // "+ Custom": MCP servers added by address (`custom-app/`), listed under Connectors' "Custom apps".
  const customApps = useCustomApps();
  const [customFlowOpen, setCustomFlowOpen] = useState(false);
  const [removeDialog, setRemoveDialog] = useState<{ item: CustomizeItem; isClosing: boolean } | null>(null);
  /** The 768px-and-below pill's "+" when it opened the Create menu, whose panel then hangs from it instead. */
  const [createAnchor, setCreateAnchor] = useState<DOMRect | null>(null);

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

  const toggleCreateMenu = (anchor: DOMRect | null = null) => {
    if (createMenuState === 'open') {
      closeCreateMenu();
    } else {
      setCreateAnchor(anchor);
      openCreateMenu();
    }
  };

  const createSkillManually = () => {
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
  };

  const uploadSkill = () => {
    closeCreateMenu();
    fileInputRef.current?.click();
  };

  /** A new chat that opens on "Create a skill" and Gemini's question back, as Spark's Skills page does. */
  const createSkillWithGemini = () => {
    closeCreateMenu();
    requestSeededChat({ prompt: SKILL_SEED_PROMPT, reply: SKILL_SEED_REPLY });
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

  const openCardMenu = (item: CustomizeItem, rect: DOMRect, isInactive = false, onPage = false) => {
    if (cardMenuTimeoutRef.current) {
      clearTimeout(cardMenuTimeoutRef.current);
      cardMenuTimeoutRef.current = null;
    }
    setCardMenu({ item, triggerRect: rect, isClosing: false, isInactive, onPage });
  };

  const closeCardMenu = () => {
    if (!cardMenu || cardMenu.isClosing) return;
    setCardMenu((prev) => (prev ? { ...prev, isClosing: true } : null));
    cardMenuTimeoutRef.current = window.setTimeout(() => {
      setCardMenu(null);
      cardMenuTimeoutRef.current = null;
    }, cardMenuExitMs(isCompact));
  };

  const openChatWith = (prompt: string) => {
    if (prompt) {
      try {
        sessionStorage.setItem('pending-chat-draft', prompt);
      } catch {}
      window.dispatchEvent(new CustomEvent('willow:set-chat-draft', { detail: prompt }));
    }
    navigate('/');
  };

  /**
   * Into a chat with the skill's "/" mention (or the app's "@" one) typed, which is
   * what applies it on send. The token is the library name, so it must be enabled there.
   */
  const handleUseNow = (item: CustomizeItem) => {
    if (isCustomAppItem(item)) {
      openChatWith(`@${item.title} `);
      return;
    }
    if (item.type === 'connector') {
      const app = connectorMention(item.id);
      openChatWith(app ? `@${app} ` : '');
      return;
    }
    if (isLibraryItem(item)) {
      openChatWith(`/${item.title} `);
      return;
    }
    if (inactiveSkillIds.has(item.id)) handleToggleActiveSkill(item);
    else if (!activeSkillIds.has(item.id)) setActiveSkillIds((prev) => new Set(prev).add(item.id));
    openChatWith(`/${customizeSkillName(item, savedSkillsData[item.id])} `);
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
    const parsed = parseSkillFile(content, item.slug || item.title);
    handleSaveSkill(item, {
      title: parsed?.title || item.title,
      description: parsed?.description || item.description || '',
      instructions: parsed?.instructions || content,
    }, false);
  };

  /** Upload: a SKILL.md, this page's JSON export, or plain Markdown becomes a new active skill. */
  const handleUploadFile = async (file: File) => {
    const content = await file.text();
    const parsed = parseSkillFile(content, file.name);
    if (!parsed) return;
    const item: CustomizeItem = {
      id: `uploaded-skill-${Date.now()}`,
      type: 'skill',
      title: parsed.title,
      subtitle: parsed.description,
      description: parsed.description,
      instructions: parsed.instructions,
      hasMoreButton: true,
    };
    handleSaveSkill(item, parsed, true);
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

  const disconnect = (item: CustomizeItem) => {
    if (isCustomAppItem(item)) {
      void disconnectCustomApp(customAppServerId(item));
      return;
    }
    const preset = mcpPresetFor(item);
    if (preset) void removeMcpCard(preset);
    else if (isConnected(item)) void toggleConnection(connectorCardId(item.id), item.title);
  };

  const handleConfirmDisconnect = () => {
    if (!disconnectDialog || disconnectDialog.isClosing) return;
    disconnect(disconnectDialog.item);
    closeDisconnectDialog();
  };

  /** A custom app's Delete: asked first ("Remove …?"), then gone from every surface. */
  const openRemoveDialog = (item: CustomizeItem) => {
    closeCardMenu();
    setRemoveDialog({ item, isClosing: false });
  };

  const closeRemoveDialog = () => {
    if (!removeDialog || removeDialog.isClosing) return;
    setRemoveDialog((prev) => (prev ? { ...prev, isClosing: true } : null));
    window.setTimeout(() => setRemoveDialog(null), 125);
  };

  const handleConfirmRemove = () => {
    if (!removeDialog || removeDialog.isClosing) return;
    const { item } = removeDialog;
    if (selectedItem?.id === item.id) setSelectedItem(null);
    void deleteCustomApp(customAppServerId(item)).then(() => showCopyToast('Custom app removed'));
    closeRemoveDialog();
  };

  /**
   * An MCP card: asked first, then signed in to from the desktop app, which leaves the
   * card's page open on its progress. X Reader signs in to X the same way, in a window
   * the companion opens. One connected by what the user types — a token, a Zoho
   * server's address, X's cookies — or one this window cannot sign in to opens on its
   * page, where the field or the reason is.
   */
  const connectMcpCard = (item: CustomizeItem) => {
    const preset = mcpPresetFor(item);
    if (!preset || isConnected(item)) return;
    const toSite = mcpCardSignsInToSite(preset, canSignInToSites);
    if (preset.auth.kind === 'none' || toSite || mcpCardSignsIn(preset, canSignIn)) {
      setConsent({
        cardId: item.id,
        appName: item.title,
        appLogo: item.logoSrc ?? '',
        confirm: () => {
          setSelectedItem(current(item));
          if (preset.auth.kind === 'none') addMcpCard(preset, '');
          else if (toSite) void signInMcpSession(preset);
          else void signInMcpCard(preset);
        },
        cancel: () => {},
      });
      return;
    }
    setSelectedItem(current(item));
    setMcpFocus({ id: item.id, at: Date.now() });
  };

  /**
   * Asks first, as Gemini's Apps page does; Connect then runs the request straight
   * from its click, so a provider's sign-in popup is not blocked. GitHub has no
   * popup: it connects from the token field on its page.
   */
  const handleConnect = (item: CustomizeItem) => {
    setConnectNotice(null);
    if (isCustomAppItem(item)) {
      void reconnectCustomApp(customAppServerId(item));
      return;
    }
    if (item.mcp) {
      connectMcpCard(item);
      return;
    }
    const cardId = connectorCardId(item.id);
    const state = stateFor(cardId);
    if (state.connected) return;
    if (cardId === 'github' && !githubLogin) {
      setSelectedItem(item);
      return;
    }
    if (state.disabledReason) {
      setConnectNotice(`${item.title}: ${state.disabledReason}`);
      return;
    }
    setConsent({
      cardId,
      appName: item.title,
      appLogo: item.logoSrc ?? '',
      confirm: () => {
        void toggleConnection(cardId, item.title);
      },
      cancel: () => {},
    });
  };

  const connectGithubWithConsent = (token: string) => new Promise<boolean | null>((resolve) => {
    const github = CONNECTORS_DATA.find((item) => item.id === 'github');
    setConsent({
      cardId: 'github',
      appName: 'GitHub',
      appLogo: github?.logoSrc ?? '',
      confirm: () => {
        void connectGithubToken(token).then(resolve, () => resolve(false));
      },
      cancel: () => resolve(null),
    });
  });

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
    const connected = isConnected(item);
    return { ...item, hasAddButton: !connected, hasMoreButton: connected };
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

  const selectItem = (item: CustomizeItem) => {
    if (isLibraryItem(item)) handleUseNow(item);
    else setSelectedItem(item);
  };

  const handleActionClick = (e: React.MouseEvent, item: CustomizeItem) => {
    if (isLibraryItem(item)) {
      handleUseNow(item);
      return;
    }
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
    if (!isConnected(item)) {
      handleConnect(item);
      return;
    }
    if (item.hasMoreButton) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openCardMenu(item, rect);
    }
  };

  // A press outside lands on the menu's transparent backdrop (mat-menu's), which closes it.
  useEffect(() => {
    if (createMenuState !== 'open') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeCreateMenu();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [createMenuState]);

  // A custom app removed elsewhere (Spark, another tab) takes its page with it.
  useEffect(() => {
    if (selectedItem && isCustomAppItem(selectedItem) && !customApps.some((app) => app.id === selectedItem.id)) setSelectedItem(null);
  }, [customApps, selectedItem]);

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
    list.push(...librarySkills);
    return list;
  }, [activeSkillIds, customSkills, savedSkillsData, librarySkills]);

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

  const skillNames = useMemo(
    () => [...activeSkills, ...inactiveSkills].map((skill) => skill.title),
    [activeSkills, inactiveSkills],
  );

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
    () => CONNECTORS_DATA.filter((item) => isConnected(item))
      .map((item) => ({ ...item, hasAddButton: false, hasMoreButton: true })),
    // `isConnected` reads both.
    [stateFor, mcpList],
  );

  const allConnectors = useMemo(
    () => CONNECTORS_DATA.filter((item) => !isConnected(item))
      .map((item) => ({ ...item, hasAddButton: true, hasMoreButton: false })),
    [stateFor, mcpList],
  );

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

  const filteredCustomApps = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return customApps.filter((item) => matchesSearch(item, query));
  }, [customApps, searchQuery]);

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

  const consentDialog = consent ? (
    <ConnectConsentDialog
      appLogo={consent.appLogo}
      appName={consent.appName}
      cardId={consent.cardId}
      key={consent.cardId}
      onCancel={consent.cancel}
      onClosed={() => setConsent(null)}
      onConfirm={consent.confirm}
    />
  ) : null;

  // Build setup (client ids), and why the last connect did nothing. Styled by Connected Apps' sheet.
  // A Google token dies with the tab, so a stored connection can lapse; its card is then off.
  const expiredNames = CONNECTORS_DATA.filter((item) => stateFor(connectorCardId(item.id)).expired).map((item) => item.title);
  const expiredNotice = expiredNames.length
    ? `Your session expired for ${expiredNames.join(', ')}. Connect ${expiredNames.length > 1 ? 'them' : 'it'} again — you won’t have to grant permission again.`
    : null;
  const connectorNotices = [expiredNotice, connectNotice, connectorNotice].filter(Boolean) as string[];
  const connectorBanners = (
    <div className="connected-apps-container customize-connect-extras">
      <OAuthClientSetup setup={connectorSetup} />
      {connectorNotices.map((text) => (
        <div className="ca-banner" role="status" key={text}>
          <div className="ca-banner-text ca-body-m">{text}</div>
          <button
            className="ca-banner-dismiss"
            onClick={() => {
              setConnectNotice(null);
              dismissConnectorNotice();
            }}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );

  if (selectedItem && !isCustomAppItem(selectedItem)) {
    const currentItem = formatItem(selectedItem);
    const isConnector = currentItem.type === 'connector';
    const isDisconnected = isConnector ? !isConnected(currentItem) : Boolean(currentItem.hasAddButton);
    const mcpPreset = isConnector ? mcpPresetFor(currentItem) : null;
    return (
      <div
        key={`detail-${currentItem.id}`}
        ref={pageRootRef}
        className="customize-page-root gemini-chat-scrollbar"
      >
        <CustomizeDetailView
          item={currentItem}
          fromTab={selectedCategory ? selectedCategory.title : activeTab}
          onBack={() => {
            setSelectedItem(null);
            setMcpFocus(null);
          }}
          onSelect={selectItem}
          isDisconnected={isDisconnected}
          connectControl={mcpPreset ? (
            <div className="connected-apps-container customize-connect-extras">
              <CustomizeMcpConnect
                canSignIn={canSignIn}
                canSignInToSites={canSignInToSites}
                focusRequest={mcpFocus?.id === currentItem.id ? mcpFocus.at : 0}
                onConsent={(connect) => setConsent({
                  cardId: currentItem.id,
                  appName: currentItem.title,
                  appLogo: currentItem.logoSrc ?? '',
                  confirm: connect,
                  cancel: () => {},
                })}
                preset={mcpPreset}
                title={currentItem.title}
              />
            </div>
          ) : isConnector ? (
            <>
              {connectorBanners}
              {connectorCardId(currentItem.id) === 'github' && isDisconnected && (
                <div className="connected-apps-container customize-connect-extras">
                  <GithubTokenRow login={githubLogin} onConnect={connectGithubWithConsent} />
                </div>
              )}
              {connectorCardId(currentItem.id) === 'workspace' && !isDisconnected && (
                <div className="connected-apps-container customize-connect-extras">
                  <GooglePermissions />
                </div>
              )}
            </>
          ) : undefined}
          onUsePrompt={(item, prompt) => {
            const app = connectorMention(item.id);
            // Many of Gemini's suggestions already name their app ("@Canva generate …").
            const named = app ? prompt.toLowerCase().includes(`@${app.toLowerCase()}`) : true;
            openChatWith(named ? prompt : `@${app} ${prompt}`);
          }}
          onDisconnect={(item) => {
            disconnect(item);
            setSelectedItem(null);
          }}
          onReconnect={handleConnect}
          onSaveSkill={handleSaveSkill}
          onDeleteSkill={handleDeleteSkill}
          onUseNow={handleUseNow}
          onEditWithGemini={handleEditWithGemini}
          onDownloadSkill={handleDownloadSkill}
          onReplaceSkill={handleReplaceSkill}
          onToggleActiveSkill={handleToggleActiveSkill}
          isInactive={inactiveSkillIds.has(currentItem.id)}
          existingSkillNames={skillNames}
        />
        {consentDialog}
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
          onDisconnect={cardMenu.onPage ? undefined : handleDisconnectClick}
          onDeleteSkill={(item) => handleDeleteSkill(item.id)}
          onUseNow={cardMenu.onPage && !isConnected(cardMenu.item) ? undefined : handleUseNow}
          onEditWithGemini={handleEditWithGemini}
          onEditManually={handleEditManually}
          onDownloadSkill={handleDownloadSkill}
          onReplaceSkill={handleReplaceSkill}
          onToggleActiveSkill={handleToggleActiveSkill}
          onDeleteApp={isCustomAppItem(cardMenu.item) ? openRemoveDialog : undefined}
          isInactive={cardMenu.isInactive}
        />
      )}

      {removeDialog && (
        <GeminiDialog
          headingAs="h1"
          title={`Remove ${removeDialog.item.title}?`}
          width={512}
          message
          closing={removeDialog.isClosing}
          onDismiss={closeRemoveDialog}
          actions={(
            <>
              <GeminiDialogPill className="willow-gdlg-pill--text" disabled={removeDialog.isClosing} onClick={closeRemoveDialog}>
                Cancel
              </GeminiDialogPill>
              <GeminiDialogPill disabled={removeDialog.isClosing} onClick={handleConfirmRemove}>
                Remove
              </GeminiDialogPill>
            </>
          )}
        >
          This removes the MCP server from Willow, with its sign-in. You can reconnect at any time using the original link. Your external files and data won&apos;t be affected.
        </GeminiDialog>
      )}

      {customFlowOpen && (
        <CustomAppFlow
          takenTitles={CONNECTORS_DATA.map((item) => item.title)}
          onAdded={(_serverId, name) => {
            showCopyToast(`${name} is connected and ready to use`, {
              label: 'Try now',
              onClick: () => openChatWith(`@${name} `),
            });
          }}
          onClosed={() => setCustomFlowOpen(false)}
        />
      )}

      {disconnectDialog && (
        <GeminiDialog
          headingAs="h2"
          title={`Disconnect ${disconnectDialog.item.title} from Willow?`}
          width={512}
          message
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
                Your choices here don&apos;t change Willow&apos;s ability to use public data to respond to you. For example, if YouTube isn&apos;t connected, Willow can still use public videos on YouTube to respond to you.
              </p>
            </div>
          </div>
        </GeminiDialog>
      )}
      {consentDialog}
    </>
  );

  if (selectedItem) {
    const app = customApps.find((entry) => entry.id === selectedItem.id);
    if (app) {
      return (
        <div key={`detail-${app.id}`} ref={pageRootRef} className="customize-page-root gemini-chat-scrollbar">
          <CustomAppDetail
            item={formatItem(app)}
            onBack={() => setSelectedItem(null)}
            onDisconnect={handleDisconnectClick}
            onConnect={handleConnect}
            onMenu={(item, rect) => {
              if (cardMenu && !cardMenu.isClosing) closeCardMenu();
              else openCardMenu(item, rect, false, true);
            }}
            menuOpen={Boolean(cardMenu && !cardMenu.isClosing && cardMenu.item.id === app.id)}
          />
          {renderModals()}
        </div>
      );
    }
  }

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
          onSelect={selectItem}
          onActionClick={handleActionClick}
        />
        {renderModals()}
      </>
    );
  }

  const createMenuPanel = (
    <div
      role="menu"
      className={`customize-create-menu-panel ${createMenuState === 'closing' ? 'closing' : ''}`}
      aria-label="Create options"
    >
      <button type="button" role="menuitem" className="customize-create-menu-item" onClick={createSkillWithGemini}>
        <span className="customize-create-menu-icon">
          <CustomizeIcon name="chat_bubble" size={16} />
        </span>
        <span className="customize-create-menu-text">Create with Willow</span>
      </button>
      <button type="button" role="menuitem" className="customize-create-menu-item" onClick={createSkillManually}>
        <span className="customize-create-menu-icon">
          <CustomizeIcon name="edit" size={16} />
        </span>
        <span className="customize-create-menu-text">Create manually</span>
      </button>
      <button type="button" role="menuitem" className="customize-create-menu-item" onClick={uploadSkill}>
        <span className="customize-create-menu-icon">
          <CustomizeIcon name="upload" size={16} />
        </span>
        <span className="customize-create-menu-text">Upload</span>
      </button>
    </div>
  );

  return (
    <div
      key={`main-${activeTab}`}
      ref={pageRootRef}
      className="customize-page-root gemini-chat-scrollbar"
    >
      <CustomizeMobileActions
        variant={activeTab === 'discover' ? 'search' : activeTab === 'connectors' ? 'custom' : 'create'}
        query={searchQuery}
        onQuery={setSearchQuery}
        createOpen={createMenuState === 'open' && Boolean(createAnchor)}
        onCreate={(trigger) => toggleCreateMenu(trigger.getBoundingClientRect())}
        onCustom={() => setCustomFlowOpen(true)}
      />
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

            {activeTab === 'connectors' && (
              <button
                type="button"
                className="customize-custom-button"
                aria-label="Create custom app"
                onClick={() => setCustomFlowOpen(true)}
              >
                <LmIcon name="add" size={24} />
                <span className="customize-custom-button-label">Custom</span>
              </button>
            )}

            {activeTab === 'skills' && (
              <div
                className="customize-create-dropdown-container"
                ref={createDropdownRef}
              >
                <button
                  type="button"
                  className={`customize-create-button ${createMenuState === 'open' && !createAnchor ? 'open' : ''}`}
                  onClick={() => toggleCreateMenu(null)}
                  aria-haspopup="menu"
                  aria-expanded={createMenuState === 'open' && !createAnchor}
                  aria-label="Create"
                >
                  <span className="customize-create-button-label">Create</span>
                  <CustomizeIcon
                    name="arrow_drop_down"
                    size={24}
                    className="customize-create-arrow-icon"
                  />
                </button>

                {createMenuState !== 'closed' && !createAnchor && (
                  <>
                    <div aria-hidden="true" className="customize-create-menu-backdrop" onClick={closeCreateMenu} />
                    {createMenuPanel}
                  </>
                )}
                {/* From the 768px pill's "+", the same menu hangs from that button. */}
                {createMenuState !== 'closed' && createAnchor && createPortal(
                  <>
                    <div aria-hidden="true" className="customize-create-menu-backdrop" onClick={closeCreateMenu} />
                    <div
                      className="customize-create-menu-anchor"
                      style={{ left: createAnchor.left, top: createAnchor.top, width: createAnchor.width, height: createAnchor.height }}
                    >
                      {createMenuPanel}
                    </div>
                  </>,
                  document.body,
                )}
                <input
                  type="file"
                  accept=".md,.markdown,.json,.txt"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleUploadFile(file);
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
                        onSelect={selectItem}
                        onActionClick={handleActionClick}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : activeTab === 'connectors' ? (
          filteredActiveConnectors.length === 0 && filteredAllConnectors.length === 0 && filteredCustomApps.length === 0 ? (
            <div className="customize-no-results">No results found</div>
          ) : (
            <div className="customize-connectors-content">
              {connectorBanners}
              {/* Gemini's Connectors headings are plain (`category-header non-interactive`): Active, All, Custom apps. */}
              {filteredActiveConnectors.length > 0 && (
                <section className="customize-category-section">
                  <div className="customize-category-header non-interactive">
                    <h2 className="customize-category-title">Active</h2>
                  </div>
                  <div className="connectors-grid">
                    {filteredActiveConnectors.map((item) => (
                      <CustomizeCard key={item.id} item={item} onSelect={selectItem} onActionClick={handleActionClick} />
                    ))}
                  </div>
                </section>
              )}

              {filteredAllConnectors.length > 0 && (
                <section className="customize-category-section">
                  <div className="customize-category-header non-interactive">
                    <h2 className="customize-category-title">All</h2>
                  </div>
                  <div className="connectors-grid">
                    {filteredAllConnectors.map((item) => (
                      <CustomizeCard key={item.id} item={item} onSelect={selectItem} onActionClick={handleActionClick} />
                    ))}
                  </div>
                </section>
              )}

              {filteredCustomApps.length > 0 && (
                <section className="customize-category-section">
                  <div className="customize-category-header non-interactive">
                    <h2 className="customize-category-title">Custom apps</h2>
                  </div>
                  <div className="connectors-grid">
                    {filteredCustomApps.map((item) => (
                      <CustomizeCard key={item.id} item={formatItem(item)} onSelect={selectItem} onActionClick={handleActionClick} />
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
              {/* Plain headings, as Gemini's Skills has them: Active, Inactive, Recommended (the ones not added). */}
              {filteredActiveSkills.length > 0 && (
                <section className="customize-category-section">
                  <div className="customize-category-header non-interactive">
                    <h2 className="customize-category-title">Active</h2>
                  </div>
                  <div className="skills-grid">
                    {filteredActiveSkills.map((item) => (
                      <CustomizeCard key={item.id} item={item} onSelect={selectItem} onActionClick={handleActionClick} />
                    ))}
                  </div>
                </section>
              )}

              {filteredInactiveSkills.length > 0 && (
                <section className="customize-category-section">
                  <div className="customize-category-header non-interactive">
                    <h2 className="customize-category-title">Inactive</h2>
                  </div>
                  <div className="skills-grid">
                    {filteredInactiveSkills.map((item) => (
                      <CustomizeCard key={item.id} item={item} onSelect={selectItem} onActionClick={handleActionClick} />
                    ))}
                  </div>
                </section>
              )}

              {filteredAllSkills.length > 0 && (
                <section className="customize-category-section">
                  <div className="customize-category-header non-interactive">
                    <h2 className="customize-category-title">Recommended</h2>
                  </div>
                  <div className="skills-grid">
                    {filteredAllSkills.map((item) => (
                      <CustomizeCard key={item.id} item={item} onSelect={selectItem} onActionClick={handleActionClick} />
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
