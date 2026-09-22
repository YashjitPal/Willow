import React, { useRef, useState } from 'react';
import { addUserBullet } from '@willow/personal';
import './ImportMemoryView.css';

const PROMPT_TEXT = `You are helping me import context from one AI assistant to another. Your job is to go through our past conversations and sum up what you know about me.

In the output, please avoid using any first-person pronouns (I, my, me, mine) and any second-person pronouns (you, your, yours). Instead, refer to the individual you have learned about as "the user" or use neutral phrasing.

Preserve the user's words verbatim where possible, especially for instructions and preferences.

Categories (output in this order):
1. Demographics Information: Preferred names, profession, education, and general residence.
2. Interests & Preferences: Sustained, active engagements (not just owning an object or a one-time purchase).
3. Relationships: Confirmed, sustained relationships.
4. Dated Events, Projects & Plans: A log of significant, recent activities.
5. Instructions: Rules I've explicitly asked you to follow going forward, "always do X", "never do Y", and corrections to your behavior. Only include rules from stored memories, not from conversations.

Format:
Divide the content into the labeled section using the categories above. Try to include verbatim quotes from my prompts that justify each entry. Structure each entry using this format:
* The user's name is <name>.
    * Evidence: User said "call me <name>". Date: [YYYY-MM-DD].

Output:
- Output ONLY the requested information. Do not include any conversational filler, intro text, or sign-offs.

Finally, complete the sentence "Imported from: <name>", where name is ChatGPT, Claude, Grok, etc. This must be the absolute final text in your response.`;

interface ImportRecord {
  id: string;
  name: string;
  size: string;
  date: string;
}

const ContentCopyIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 -960 960 960"
    fill="currentColor"
    aria-hidden="true"
    className="shrink-0"
  >
    <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" />
  </svg>
);

const CheckIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 -960 960 960"
    fill="currentColor"
    aria-hidden="true"
    className="shrink-0"
  >
    <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
  </svg>
);

const AddIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 -960 960 960"
    fill="currentColor"
    aria-hidden="true"
    className="shrink-0"
  >
    <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z" />
  </svg>
);

const ZipFileIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 -960 960 960"
    fill="currentColor"
    aria-hidden="true"
    className="shrink-0 text-[#a8c7fa]"
  >
    <path d="M280-120q-33 0-56.5-23.5T200-200v-560q0-33 23.5-56.5T280-840h400q33 0 56.5 23.5T760-760v560q0 33-23.5 56.5T680-120H280Zm0-80h400v-560H280v560Zm80-80h80v-80h-80v80Zm80-80h80v-80h-80v80Zm-80-80h80v-80h-80v80Zm80-80h80v-80h-80v80Zm-80-80h80v-80h-80v80Zm80-80h80v-80h-80v80ZM280-200v-560 560Z" />
  </svg>
);

const DeleteIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 -960 960 960"
    fill="currentColor"
    aria-hidden="true"
    className="shrink-0"
  >
    <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z" />
  </svg>
);

export const ImportMemoryView: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [importRecords, setImportRecords] = useState<ImportRecord[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2500);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(PROMPT_TEXT);
      setCopied(true);
      showToast('Prompt copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Failed to copy');
    }
  };

  const handleAddMemory = () => {
    const text = pasteValue.trim();
    if (!text) return;

    addUserBullet({
      section: 'interests',
      text,
    });

    setPasteValue('');
    showToast('Memory added successfully');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const sizeInMB = (file.size / (1024 * 1024)).toFixed(1);
    const newRecord: ImportRecord = {
      id: `${Date.now()}-${file.name}`,
      name: file.name,
      size: `${sizeInMB} MB`,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    };

    setImportRecords((prev) => [newRecord, ...prev]);
    showToast(`Uploaded ${file.name}`);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeleteRecord = (id: string) => {
    setImportRecords((prev) => prev.filter((r) => r.id !== id));
    showToast('Removed imported chat record');
  };

  return (
    <div className="import-hub-root gemini-chat-scrollbar">
      <div className="import-hub-window">
        <div data-test-id="import-hub-page" className="import-hub-content">
          {/* Page Header */}
          <div className="import-page-header">
            <h2 id="import-hub-title" data-test-id="page-title" className="import-page-title">
              Import memory to Gemini
            </h2>
          </div>

          {/* Memory Import Section */}
          <section data-test-id="memory-import-section" className="import-memory-section">
            {/* Step 1 */}
            <div className="import-step">
              <div className="import-step-indicator">
                <span className="import-step-number">1</span>
                <h3 data-test-id="copy-section-title" className="import-section-title">
                  Copy this prompt into a chat with your other AI provider
                </h3>
              </div>

              <div data-test-id="prompt-card" className="import-prompt-card" onClick={handleCopy}>
                <div data-test-id="prompt-text" className="import-prompt-text">
                  {PROMPT_TEXT}
                </div>
                <div className="import-prompt-actions">
                  <button
                    type="button"
                    data-test-id="copy-button"
                    className={`import-copy-button ${copied ? 'copied' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy();
                    }}
                    aria-label="Copy prompt to clipboard"
                  >
                    <span className="import-btn-icon-24">
                      {copied ? <CheckIcon size={20} /> : <ContentCopyIcon size={20} />}
                    </span>
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="import-step">
              <div className="import-step-indicator">
                <span className="import-step-number">2</span>
                <h3 data-test-id="paste-section-title" className="import-section-title">
                  Paste the response here
                </h3>
              </div>

              <div className={`import-paste-card ${pasteValue.trim() ? 'has-content' : ''}`} data-test-id="paste-card">
                <textarea
                  data-test-id="paste-textarea"
                  rows={3}
                  className="import-paste-textarea"
                  placeholder="Paste your info here..."
                  value={pasteValue}
                  onChange={(e) => setPasteValue(e.target.value)}
                />
                <div className="import-paste-actions">
                  <button
                    type="button"
                    data-test-id="send-button"
                    className="import-send-button"
                    disabled={!pasteValue.trim()}
                    onClick={handleAddMemory}
                    aria-label="Add memory"
                  >
                    <span className="import-btn-icon-24">
                      <AddIcon size={20} />
                    </span>
                    <span>Add memory</span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Import chats */}
          <section data-test-id="llm-history-import-page" className="import-chats-section">
            <h2 id="llm-history-import-title" className="import-chats-title">
              Import chats
            </h2>
            <div className="import-chats-subtitle">
              <span id="llm-history-import-instructions">
                Export your data from a{' '}
                <a
                  target="_blank"
                  rel="noopener noreferrer"
                  className="import-link"
                  href="https://support.google.com/gemini/answer/16868299#import_chat"
                >
                  supported AI provider
                </a>{' '}
                and upload the .zip file (up to 5 GB) directly to Gemini.{' '}
              </span>
              <a
                target="_blank"
                rel="noopener noreferrer"
                aria-describedby="llm-history-import-instructions"
                className="import-link"
                href="https://support.google.com/gemini?p=import_chat"
              >
                Learn more
              </a>
            </div>

            <button
              type="button"
              data-test-id="add-button"
              className="import-chats-add-button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Add chat export file"
            >
              <span className="import-chats-add-icon">
                <AddIcon size={20} />
              </span>
              <span>Add</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/zip"
              data-test-id="file-input"
              hidden
              onChange={handleFileSelect}
            />

            {importRecords.length > 0 && (
              <ol className="import-record-list">
                {importRecords.map((record) => (
                  <li key={record.id} className="import-record-item">
                    <ZipFileIcon size={24} />
                    <div className="import-record-label-container">
                      <span className="import-record-name">{record.name}</span>
                      <span className="import-record-meta">{record.size} • Uploaded {record.date}</span>
                    </div>
                    <button
                      type="button"
                      className="import-record-delete-button"
                      onClick={() => handleDeleteRecord(record.id)}
                      aria-label={`Delete ${record.name}`}
                    >
                      <DeleteIcon size={18} />
                    </button>
                  </li>
                ))}
              </ol>
            )}

            <div className="import-disclaimer">
              Your imported and continued chats are saved in your Activity. This data is used to improve our services (including
              training generative AI models), and to protect Google, our users and the public. You can{' '}
              <a
                target="_blank"
                rel="noopener noreferrer"
                className="import-link"
                href="https://support.google.com/gemini/answer/13278892"
              >
                manage or delete your activity
              </a>{' '}
              anytime.
            </div>
          </section>
        </div>
      </div>

      {toastMessage && <div className="import-toast" role="status">{toastMessage}</div>}
    </div>
  );
};

export default ImportMemoryView;
