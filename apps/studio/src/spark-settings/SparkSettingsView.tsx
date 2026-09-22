import React, { useState, useEffect } from 'react';
import './SparkSettingsView.css';

interface SparkSettingsViewProps {
  onBack?: () => void;
}

type DialogType = 'turn-off' | 'delete-browser' | 'delete-code' | null;

const PowerIcon: React.FC<{ size?: number; className?: string }> = ({ size = 28, className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    height={size}
    width={size}
    viewBox="0 -960 960 960"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-84 31.5-156.5T197-763l56 56q-44 44-68.5 102T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-67-24.5-125T707-707l56-56q54 54 85.5 126.5T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-40-360v-440h80v440h-80Z" />
  </svg>
);

const MonitorIcon: React.FC<{ size?: number; className?: string }> = ({ size = 28, className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    height={size}
    width={size}
    viewBox="0 -960 960 960"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M80-160v-80h240v-80H160q-33 0-56.5-23.5T80-400v-440q0-33 23.5-56.5T160-920h640q33 0 56.5 23.5T880-840v440q0 33-23.5 56.5T800-320H560v80h240v80H80Zm80-240h640v-440H160v440Zm0 0v-440 440Z" />
  </svg>
);

const CodeIcon: React.FC<{ size?: number; className?: string }> = ({ size = 28, className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    height={size}
    width={size}
    viewBox="0 -960 960 960"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M320-240 80-480l240-240 57 57-184 183 184 183-57 57Zm320 0-57-57 184-183-184-183 57-57 240 240-240 240Z" />
  </svg>
);

const TrashIcon: React.FC<{ size?: number; className?: string }> = ({ size = 24, className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    height={size}
    width={size}
    viewBox="0 -960 960 960"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z" />
  </svg>
);

export const SparkSettingsView: React.FC<SparkSettingsViewProps> = () => {
  const [activeDialog, setActiveDialog] = useState<DialogType>(null);
  const [dialogPhase, setDialogPhase] = useState<'closed' | 'open' | 'closing'>('closed');

  const openDialog = (type: DialogType) => {
    setActiveDialog(type);
    setDialogPhase('open');
  };

  const closeDialog = () => {
    setDialogPhase('closing');
    setTimeout(() => {
      setActiveDialog(null);
      setDialogPhase('closed');
    }, 125);
  };

  // Keyboard shortcut listener for Escape key
  useEffect(() => {
    if (dialogPhase === 'closed') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDialog();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dialogPhase]);

  return (
    <div className="spark-settings-root">
      <div className="spark-settings-container">
        {/* Header */}
        <div className="spark-settings-header">
          <h1 className="spark-settings-title">Gemini Spark Settings</h1>
        </div>

        {/* Options Stack */}
        <div className="spark-settings-options">
          {/* Card 1: Turn off Gemini Spark */}
          <div className="spark-settings-card">
            <div className="spark-card-icon">
              <PowerIcon size={28} />
            </div>
            <h2 className="spark-card-title">Turn off Gemini Spark</h2>
            <p className="spark-card-description">
              Turning off Gemini Spark deletes your browsing data and remote code execution files, and stops your schedules.{' '}
              <a
                href="http://support.google.com/gemini?p=turn_off_spark"
                target="_blank"
                rel="noopener noreferrer"
                className="spark-card-link"
              >
                Learn more about how to manage this setting.
              </a>
            </p>
            <div className="spark-card-actions">
              <button
                type="button"
                className="spark-action-button"
                onClick={() => openDialog('turn-off')}
              >
                Turn off
              </button>
            </div>
          </div>

          {/* Card 2: Delete remote browser data */}
          <div className="spark-settings-card">
            <div className="spark-card-icon">
              <MonitorIcon size={28} />
            </div>
            <h2 className="spark-card-title">Delete remote browser data</h2>
            <p className="spark-card-description">
              Delete the browsing data Gemini uses to complete tasks for you. This clears your cookies and signs you out of websites.{' '}
              <a
                href="http://support.google.com/gemini?p=agent_browser_data"
                target="_blank"
                rel="noopener noreferrer"
                className="spark-card-link"
              >
                Learn more.
              </a>
            </p>
            <div className="spark-card-actions">
              <button
                type="button"
                className="spark-delete-button"
                onClick={() => openDialog('delete-browser')}
              >
                <span className="spark-delete-icon">
                  <TrashIcon size={24} />
                </span>
                <span>Delete</span>
              </button>
            </div>
          </div>

          {/* Card 3: Delete remote code execution data */}
          <div className="spark-settings-card">
            <div className="spark-card-icon">
              <CodeIcon size={28} />
            </div>
            <h2 className="spark-card-title">Delete remote code execution data</h2>
            <p className="spark-card-description">
              Delete the saved files and other data Gemini uses to run code for you through your remote computer.{' '}
              <a
                href="https://support.google.com/gemini?p=lm_agent_comp_data#topic=15280100"
                target="_blank"
                rel="noopener noreferrer"
                className="spark-card-link"
              >
                Learn more.
              </a>
            </p>
            <div className="spark-card-actions">
              <button
                type="button"
                className="spark-delete-button"
                onClick={() => openDialog('delete-code')}
              >
                <span className="spark-delete-icon">
                  <TrashIcon size={24} />
                </span>
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialogs */}
      {dialogPhase !== 'closed' && activeDialog && (
        <div
          role="dialog"
          aria-modal="true"
          className={`spark-dialog-backdrop ${dialogPhase === 'closing' ? 'spark-dialog-backdrop-exit' : 'spark-dialog-backdrop-enter'}`}
          onClick={closeDialog}
        >
          <div
            className={`spark-dialog-surface ${dialogPhase === 'closing' ? 'spark-dialog-surface-exit' : 'spark-dialog-surface-enter'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {activeDialog === 'turn-off' && (
              <>
                <div className="spark-dialog-content-wrapper">
                  <h3 className="spark-dialog-title">Turn off Gemini Spark?</h3>
                  <div className="spark-dialog-body-group">
                    <p className="spark-dialog-body">
                      Turning off Gemini Spark will delete your browsing data and remote code execution files.
                    </p>
                    <p className="spark-dialog-body">
                      This will not delete tasks, threads, schedules, or any related files that Gemini updated or created. Schedules will stop running while Gemini Spark is off.
                    </p>
                  </div>
                </div>
                <div className="spark-dialog-actions">
                  <button type="button" className="spark-dialog-cancel-button" onClick={closeDialog}>
                    Cancel
                  </button>
                  <button type="button" className="spark-dialog-confirm-button" onClick={closeDialog}>
                    Turn off
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'delete-browser' && (
              <>
                <div className="spark-dialog-content-wrapper">
                  <h3 className="spark-dialog-title">Delete remote browser data?</h3>
                  <div className="spark-dialog-body-group">
                    <p className="spark-dialog-body">
                      All saved remote browser data from your past sessions will be permanently deleted. Remote browser data from future sessions will still be saved for convenience.
                    </p>
                  </div>
                </div>
                <div className="spark-dialog-actions">
                  <button type="button" className="spark-dialog-cancel-button" onClick={closeDialog}>
                    Cancel
                  </button>
                  <button type="button" className="spark-dialog-confirm-button" onClick={closeDialog}>
                    Delete
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'delete-code' && (
              <>
                <div className="spark-dialog-content-wrapper">
                  <h3 className="spark-dialog-title">Delete remote code execution data?</h3>
                  <div className="spark-dialog-body-group">
                    <p className="spark-dialog-body">
                      All saved remote code execution files and data from previous sessions will be deleted. Remote code execution data from future sessions will still be saved for convenience.
                    </p>
                  </div>
                </div>
                <div className="spark-dialog-actions">
                  <button type="button" className="spark-dialog-cancel-button" onClick={closeDialog}>
                    Cancel
                  </button>
                  <button type="button" className="spark-dialog-confirm-button" onClick={closeDialog}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SparkSettingsView;
