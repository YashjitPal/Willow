import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { mcpRuntime, mcpServers } from '@willow/ai/mcp/mcp-store';
import type { CustomizeItem } from '../customize-data';
import { customAppMeta, customAppServerId, syncCustomApp } from './custom-app';
import { LmIcon } from './LmIcon';
import './CustomAppDetail.css';

/*
 * A custom app's page, as Gemini's `app-details-page` draws one (measured on a DeepWiki app added and removed again):
 * the favicon in the 40px tile, the name with its `@handle` badge, Disconnect (accent) and ⋯; "Available actions",
 * one 52px row per tool; and Information — Categories "Custom MCP", Handle, MCP URL with Copy link, Last synced
 * and Made by. The shared classes are the connector page's (`CustomizeDetailView`), so its layout rules apply.
 */
export const CustomAppDetail: React.FC<{
  item: CustomizeItem;
  onBack: () => void;
  onDisconnect: (item: CustomizeItem) => void;
  onConnect: (item: CustomizeItem) => void;
  onMenu: (item: CustomizeItem, trigger: DOMRect) => void;
  menuOpen: boolean;
}> = ({ item, onBack, onDisconnect, onConnect, onMenu, menuOpen }) => {
  const serverId = customAppServerId(item);
  const servers = useStore(mcpServers);
  const runtime = useStore(mcpRuntime);
  const meta = useStore(customAppMeta)[serverId];
  const server = servers.find((entry) => entry.id === serverId);
  const [logoFailed, setLogoFailed] = useState(!item.logoSrc);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void syncCustomApp(serverId);
  }, [serverId]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1000);
    return () => clearTimeout(timer);
  }, [copied]);
  const live = runtime[serverId];
  const tools = useMemo(
    () => (live?.status.state === 'ready' ? live.tools.map((tool) => tool.name) : meta?.tools ?? []),
    [live, meta],
  );
  const loading = Boolean(server?.enabled) && live?.status.state === 'connecting' && tools.length === 0;
  const synced = meta?.syncedAt ? new Date(meta.syncedAt).toLocaleString() : '';
  const handle = `@${item.title.replace(/\s+/g, '')}`;
  const connected = Boolean(server?.enabled);
  const url = server?.url ?? '';

  return (
    <div className="customize-detail-page custom-app-page">
      <div className="page-wrapper">
        <nav aria-label="Breadcrumb navigation" className="top-nav-bar">
          <button type="button" className="back-button gds-label-l" onClick={onBack} aria-label="Back to connectors">
            <LmIcon name="arrow_back" size={20} className="back-icon" />
            <span className="back-button-text gds-label-l">Connectors</span>
          </button>
        </nav>

        <main className="details-content-column">
          <header className="app-header">
            <div className="app-icon-container">
              {logoFailed ? (
                <div className="app-icon-placeholder">
                  <LmIcon name="extension" size={24} />
                </div>
              ) : (
                <img src={item.logoSrc} alt="" aria-hidden="true" className="app-icon-img" referrerPolicy="no-referrer" onError={() => setLogoFailed(true)} />
              )}
            </div>
            <div className="app-header-main">
              <div className="app-title-group">
                <div className="app-title-row">
                  <h1 className="app-title gds-headline-m">{item.title}</h1>
                  <span className="custom-app-handle">{handle}</span>
                </div>
                {item.description ? <div className="app-subtitle gds-body-m">{item.description}</div> : null}
              </div>
              <div className="app-header-action">
                <div className="custom-app-actions">
                  {connected ? (
                    <button type="button" className="use-in-chat-button" aria-label={`Disconnect ${item.title}`} onClick={() => onDisconnect(item)}>
                      <span className="gds-body-m">Disconnect</span>
                    </button>
                  ) : (
                    <button type="button" className="use-in-chat-button" aria-label={`Connect ${item.title}`} onClick={() => onConnect(item)}>
                      <span className="gds-body-m">Connect</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={`overflow-menu-button${menuOpen ? ' is-open' : ''}`}
                    aria-label="More options"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMenu(item, event.currentTarget.getBoundingClientRect());
                    }}
                  >
                    <LmIcon name="more_horiz" size={24} />
                  </button>
                </div>
              </div>
            </div>
          </header>

          {live?.status.state === 'failed' && connected ? (
            <p className="custom-app-problem" role="status">{live.status.message}</p>
          ) : null}

          <section className="custom-app-actions-section">
            <div className="custom-app-actions-header">
              <h2 className="section-title gds-body-l">Available actions</h2>
            </div>
            {loading ? (
              <div className="custom-app-loading" role="progressbar" aria-label="Loading">
                <svg className="custom-app-spinner" viewBox="0 0 48 48" aria-hidden="true">
                  <circle cx="24" cy="24" r="20" />
                </svg>
              </div>
            ) : (
              <ul className="custom-app-actions-list">
                {tools.map((name) => (
                  <li key={name} className="custom-app-action">
                    <LmIcon name="check" size={16} className="custom-app-action-check" />
                    <span className="custom-app-action-name">{name}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="info-section">
            <h2 className="section-title gds-body-l">Information</h2>
            <dl className="info-list">
              <div className="info-row">
                <dt className="info-label gds-body-m">Categories</dt>
                <dd className="info-value gds-body-m">
                  <span className="info-interactive-text gds-body-m">Custom MCP</span>
                </dd>
              </div>
              <div className="info-row">
                <dt className="info-label gds-body-m">Handle</dt>
                <dd className="info-value gds-body-m">{handle}</dd>
              </div>
              <div className="info-row custom-app-url-row">
                <dt className="info-label gds-body-m">MCP URL</dt>
                <dd className="info-value custom-app-url">
                  <span className="custom-app-url-text gds-body-m">{url}</span>
                  <button
                    type="button"
                    className="overflow-menu-button custom-app-copy"
                    aria-label={copied ? 'Link copied' : 'Copy link'}
                    onClick={() => {
                      void navigator.clipboard?.writeText(url).catch(() => {});
                      setCopied(true);
                    }}
                  >
                    <LmIcon name={copied ? 'check' : 'content_copy'} size={24} />
                  </button>
                </dd>
              </div>
              {synced ? (
                <div className="info-row">
                  <dt className="info-label gds-body-m">Last synced</dt>
                  <dd className="info-value gds-body-m">{synced}</dd>
                </div>
              ) : null}
              <div className="info-row">
                <dt className="info-label gds-body-m">Made by</dt>
                <dd className="info-value gds-body-m">{meta?.madeBy || item.title}</dd>
              </div>
            </dl>
          </section>
        </main>
      </div>
    </div>
  );
};
