import React from 'react';
import { ChevronDown, Cloud, FlaskConical, Search, FolderOpen, HardDrive, Check, AlertCircle, Shield } from 'lucide-react';

type SectionType = 'workspace' | 'people' | 'models' | 'cloud' | 'privacy' | 'account' | 'labs' | 'connectors' | 'github';

interface ConnectorsTabProps {
  activeConnector: string | null;
  setActiveConnector: (v: string | null) => void;
  setActiveTab: (v: SectionType) => void;
  // Local FS
  isLocalFSSupported: boolean;
  isLocalFolderConnected: boolean;
  localFolderName: string | null;
  connectLocalFolder: () => Promise<boolean>;
  disconnectLocalFolder: () => void;
  // Drive
  isDriveConnected: boolean;
  connectDrive: () => void;
  disconnectDrive: () => void;
}

export const ConnectorsTab: React.FC<ConnectorsTabProps> = ({
  activeConnector,
  setActiveConnector,
  setActiveTab,
  isLocalFSSupported,
  isLocalFolderConnected,
  localFolderName,
  connectLocalFolder,
  disconnectLocalFolder,
  isDriveConnected,
  connectDrive,
  disconnectDrive,
}) => {
  if (!activeConnector) {
    return (
      <div className="w-full h-full px-12 py-10 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-[24px] font-bold text-white">Connectors</h1>
        </div>

        {/* Enabled connectors */}
        <div className="mt-8">
          <h2 className="text-[16px] font-bold text-white mb-1">Enabled connectors</h2>
          <p className="text-[14px] text-zinc-400 mb-4 max-w-2xl">
            Add functionality to your apps. Configured once by admins, available to everyone in your workspace.
          </p>
          
          <div className="grid grid-cols-2 gap-4">
            {/* Webcontainers */}
            <div 
              onClick={() => setActiveConnector('webcontainers')}
              className="bg-[#272729] hover:bg-[#323235] border border-white/5 rounded-xl p-4 flex items-center justify-between cursor-pointer group transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 flex items-center justify-center">
                  <Cloud size={20} className="text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[14px] font-bold text-white">Webcontainers</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] shrink-0" />
                  </div>
                  <div className="text-[13px] text-zinc-400">Browser-based Node.js runtime</div>
                </div>
              </div>
              <ChevronDown className="rotate-[-90deg] text-zinc-600 group-hover:text-white transition-colors" size={16} />
            </div>

            {/* Willow AI */}
            <div 
              onClick={() => setActiveConnector('willow-ai')}
              className="bg-[#272729] hover:bg-[#323235] border border-white/5 rounded-xl p-4 flex items-center justify-between cursor-pointer group transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 flex items-center justify-center">
                  <FlaskConical size={20} className="text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[14px] font-bold text-white">Willow AI</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] shrink-0" />
                  </div>
                  <div className="text-[13px] text-zinc-400">Unlock powerful AI features</div>
                </div>
              </div>
              <ChevronDown className="rotate-[-90deg] text-zinc-600 group-hover:text-white transition-colors" size={16} />
            </div>

            {/* Local Folder Sync (if connected) */}
            {isLocalFolderConnected && (
              <div 
                onClick={() => setActiveConnector('localfs')}
                className="bg-[#272729] hover:bg-[#323235] border border-white/5 rounded-xl p-4 flex items-center justify-between cursor-pointer group transition-colors animate-[fadeIn_150ms_ease-out]"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 flex items-center justify-center">
                    <FolderOpen size={20} className="text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[14px] font-bold text-white">Local Folder</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] shrink-0" />
                    </div>
                    <div className="text-[13px] text-zinc-400 truncate max-w-[200px]">Synced to: {localFolderName}</div>
                  </div>
                </div>
                <ChevronDown className="rotate-[-90deg] text-zinc-600 group-hover:text-white transition-colors" size={16} />
              </div>
            )}
          </div>
        </div>

        {/* Available connectors */}
        <div className="mt-10 mb-12">
          <h2 className="text-[16px] font-bold text-white mb-1">Available connectors</h2>
          <p className="text-[14px] text-zinc-400 mb-4 max-w-2xl">
            Connect your personal tools to provide context while building. Only you can access your connections.
          </p>
          
          <div className="grid grid-cols-2 gap-4">
            {/* Search */}
            <div 
              onClick={() => setActiveConnector('search')}
              className="bg-[#272729] hover:bg-[#323235] border border-white/5 rounded-xl p-4 flex items-center justify-between cursor-pointer group transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 flex items-center justify-center">
                  <Search size={20} className="text-white" />
                </div>
                <div>
                  <div className="text-[14px] font-bold text-white mb-0.5">Search</div>
                  <div className="text-[13px] text-zinc-400">Allow AI Agent to search through the web</div>
                </div>
              </div>
              <ChevronDown className="rotate-[-90deg] text-zinc-600 group-hover:text-white transition-colors" size={16} />
            </div>

            {/* Drive */}
            <div 
              onClick={() => setActiveConnector('drive')}
              className="bg-[#272729] hover:bg-[#323235] border border-white/5 rounded-xl p-4 flex items-center justify-between cursor-pointer group transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 flex items-center justify-center">
                  <HardDrive size={20} className="text-white" />
                </div>
                <div>
                  <div className="text-[14px] font-bold text-white mb-0.5">Drive</div>
                  <div className="text-[13px] text-zinc-400">Save and share your projects</div>
                </div>
              </div>
              <ChevronDown className="rotate-[-90deg] text-zinc-600 group-hover:text-white transition-colors" size={16} />
            </div>

            {/* Local Folder Sync (if not connected) */}
            {!isLocalFolderConnected && (
              <div 
                onClick={() => setActiveConnector('localfs')}
                className="bg-[#272729] hover:bg-[#323235] border border-white/5 rounded-xl p-4 flex items-center justify-between cursor-pointer group transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 flex items-center justify-center">
                    <FolderOpen size={20} className="text-white" />
                  </div>
                  <div>
                    <div className="text-[14px] font-bold text-white mb-0.5">Local Folder</div>
                    <div className="text-[13px] text-zinc-400">Save projects & chats locally</div>
                  </div>
                </div>
                <ChevronDown className="rotate-[-90deg] text-zinc-600 group-hover:text-white transition-colors" size={16} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (activeConnector === 'willow-ai') {
    return (
      <div className="w-full h-full px-12 py-10 overflow-y-auto animate-[fadeIn_150ms_ease-out]">
        <button 
          onClick={() => setActiveConnector(null)}
          className="flex items-center gap-2 text-[14px] text-zinc-400 hover:text-white transition-colors mb-6 group"
        >
          <ChevronDown className="rotate-90 group-hover:-translate-x-1 transition-transform" size={16} />
          <span>Connectors</span>
        </button>

        <div className="flex items-center justify-center mb-10">
           <div className="flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 flex items-center justify-center">
                <FlaskConical size={32} className="text-white" />
              </div>
              <div>
                <div className="flex items-center justify-center gap-2.5 mb-1">
                  <h1 className="text-[24px] font-bold text-white">Willow AI</h1>
                  <span className="w-2 h-2 rounded-full bg-[#4ade80] shrink-0 animate-pulse" />
                </div>
                <p className="text-[16px] text-zinc-400">Unlock powerful AI features</p>
              </div>
           </div>
        </div>

        <div className="space-y-10 max-w-3xl mx-auto">
          <div>
            <h2 className="text-[18px] font-bold text-white mb-3">Overview</h2>
            <p className="text-[14px] leading-relaxed text-zinc-400">
              Enable to use AI models without needing to provide an API key and centralized billing. 
              Willow AI seamlessly integrates with your workflow to provide intelligent assistance, code generation, and more.
            </p>
          </div>

          <div>
            <h2 className="text-[18px] font-bold text-white mb-3">Available models</h2>
            <p className="text-[14px] text-zinc-400 mb-6">
              AI models you can use through Willow AI Gateway.
            </p>
            
            <div className="bg-[#272729] border border-white/5 rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <h3 className="text-[15px] font-bold text-white mb-1">Manage Models & API Keys</h3>
                <p className="text-[13px] text-zinc-400">
                  Configure your model providers, API keys, and selected models in the settings menu.
                </p>
              </div>
              <button 
                onClick={() => setActiveTab('models')}
                className="px-4 py-2 bg-white text-black text-[13px] font-bold rounded-lg hover:bg-zinc-200 transition-colors whitespace-nowrap"
              >
                Open Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeConnector === 'webcontainers') {
    return (
      <div className="w-full h-full px-12 py-10 overflow-y-auto animate-[fadeIn_150ms_ease-out]">
        <button 
          onClick={() => setActiveConnector(null)}
          className="flex items-center gap-2 text-[14px] text-zinc-400 hover:text-white transition-colors mb-6 group"
        >
          <ChevronDown className="rotate-90 group-hover:-translate-x-1 transition-transform" size={16} />
          <span>Connectors</span>
        </button>

        <div className="flex items-center justify-center mb-10">
           <div className="flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 flex items-center justify-center">
                <Cloud size={32} className="text-white" />
              </div>
              <div>
                <div className="flex items-center justify-center gap-2.5 mb-1">
                  <h1 className="text-[24px] font-bold text-white">Webcontainers</h1>
                  <span className="w-2 h-2 rounded-full bg-[#4ade80] shrink-0 animate-pulse" />
                </div>
                <p className="text-[16px] text-zinc-400">Browser-based Node.js runtime</p>
              </div>
           </div>
        </div>

        <div className="space-y-10 max-w-3xl mx-auto">
          <div>
            <h2 className="text-[18px] font-bold text-white mb-3">Overview</h2>
            <p className="text-[14px] leading-relaxed text-zinc-400">
              Webcontainers allow you to run Node.js directly in your browser. This technology powers the instant development environment, enabling you to run build tools, servers, and scripts without any local setup or cloud latency.
            </p>
          </div>

           <div>
            <h2 className="text-[18px] font-bold text-white mb-3">Capabilities</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#272729] border border-white/5 rounded-xl p-4">
                   <h3 className="text-[14px] font-bold text-white mb-1">Instant Boot</h3>
                   <p className="text-[13px] text-zinc-400">Environments start in milliseconds.</p>
              </div>
              <div className="bg-[#272729] border border-white/5 rounded-xl p-4">
                   <h3 className="text-[14px] font-bold text-white mb-1">Secure by Default</h3>
                   <p className="text-[13px] text-zinc-400">Code runs entirely within your browser sandbox.</p>
              </div>
              <div className="bg-[#272729] border border-white/5 rounded-xl p-4">
                   <h3 className="text-[14px] font-bold text-white mb-1">Full Node.js API</h3>
                   <p className="text-[13px] text-zinc-400">Support for standard Node.js binaries and packages.</p>
              </div>
              <div className="bg-[#272729] border border-white/5 rounded-xl p-4">
                   <h3 className="text-[14px] font-bold text-white mb-1">Offline Capable</h3>
                   <p className="text-[13px] text-zinc-400">Works even without an internet connection once loaded.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeConnector === 'search') {
    return (
      <div className="w-full h-full px-12 py-10 overflow-y-auto animate-[fadeIn_150ms_ease-out]">
        <button 
          onClick={() => setActiveConnector(null)}
          className="flex items-center gap-2 text-[14px] text-zinc-400 hover:text-white transition-colors mb-6 group"
        >
          <ChevronDown className="rotate-90 group-hover:-translate-x-1 transition-transform" size={16} />
          <span>Connectors</span>
        </button>

         <div className="flex items-center justify-center mb-10">
           <div className="flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 flex items-center justify-center">
                <Search size={32} className="text-white" />
              </div>
              <div>
                   <div className="flex items-center justify-center gap-3 mb-1">
                  <h1 className="text-[24px] font-bold text-white">Search</h1>
                </div>
                <p className="text-[16px] text-zinc-400">Allow AI Agent to search through the web</p>
              </div>
           </div>
        </div>

        <div className="max-w-xl mx-auto space-y-6">
          <div className="space-y-2">
            <label className="text-[14px] font-medium text-white">Google Custom Search API Key</label>
            <input 
              type="password"
              placeholder="Enter your API key"
              className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 transition-all placeholder:text-zinc-600"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[14px] font-medium text-white">Search Engine ID (CX)</label>
            <input 
              type="text"
              placeholder="Enter your Search Engine ID"
              className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 transition-all placeholder:text-zinc-600"
            />
          </div>

           <div className="pt-4 flex justify-end">
            <button className="px-6 py-2.5 bg-white text-black text-[14px] font-bold rounded-xl hover:bg-zinc-200 transition-colors shadow-lg shadow-white/5">
              Save Configuration
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeConnector === 'localfs') {
    return (
      <div className="w-full h-full px-12 py-10 overflow-y-auto animate-[fadeIn_150ms_ease-out]">
        <button 
          onClick={() => setActiveConnector(null)}
          className="flex items-center gap-2 text-[14px] text-zinc-400 hover:text-white transition-colors mb-6 group"
        >
          <ChevronDown className="rotate-90 group-hover:-translate-x-1 transition-transform" size={16} />
          <span>Connectors</span>
        </button>

         <div className="flex items-center justify-center mb-10">
           <div className="flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 flex items-center justify-center">
                <FolderOpen size={32} className="text-white" />
              </div>
              <div>
                   <div className="flex items-center justify-center gap-2.5 mb-1">
                  <h1 className="text-[24px] font-bold text-white">Local Folder Sync</h1>
                  {isLocalFolderConnected && (
                    <span className="w-2 h-2 rounded-full bg-[#4ade80] shrink-0 animate-pulse" />
                  )}
                </div>
                <p className="text-[16px] text-zinc-400">Save your projects, chats, and media directly on your device</p>
              </div>
           </div>
        </div>

        <div className="max-w-xl mx-auto space-y-8">
          <div>
            <h2 className="text-[18px] font-bold text-white mb-3">Overview</h2>
            <p className="text-[14px] leading-relaxed text-zinc-400">
              Synchronize your chats, media generations, and vibecoded apps directly to a folder on your computer. 
              Once set up, the application will write checkpoints and files in real-time.
            </p>
          </div>

          {/* FSAA Browser Support check */}
          {!isLocalFSSupported ? (
            <div className="bg-red-900/20 border border-red-900/30 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
              <div>
                <h4 className="text-[14px] font-bold text-white mb-1">Not Supported</h4>
                <p className="text-[13px] text-zinc-300">
                  Your browser does not support the File System Access API. Please use a modern Chromium-based browser (e.g. Chrome, Edge, Brave, or Opera).
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Connection Status & Action */}
              <div className="bg-[#272729] border border-white/5 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 flex items-center justify-center">
                      {isLocalFolderConnected ? (
                        <Check size={24} className="text-[#4ade80]" />
                      ) : (
                        <FolderOpen size={24} className="text-zinc-500" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-[15px] font-bold text-white mb-0.5">
                        {isLocalFolderConnected ? 'Local Folder Connected' : 'Local Folder'}
                      </h3>
                      <p className="text-[13px] text-zinc-400">
                        {isLocalFolderConnected 
                          ? `Synced to: ${localFolderName}` 
                          : 'Connect a folder on your hard drive'}
                      </p>
                    </div>
                  </div>
                  
                  {isLocalFolderConnected ? (
                    <button 
                      onClick={disconnectLocalFolder}
                      className="px-4 py-2 bg-[#1c1c1c] text-zinc-400 text-[13px] font-medium rounded-lg hover:bg-[#2a2a2a] hover:text-white transition-colors border border-white/10"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button 
                      onClick={async () => {
                        await connectLocalFolder();
                      }}
                      className="px-5 py-2.5 bg-white text-black text-[13px] font-bold rounded-xl hover:bg-zinc-200 transition-colors shadow-lg shadow-white/5 flex items-center gap-2"
                    >
                      Select Folder
                    </button>
                  )}
                </div>
              </div>

              {/* Permissions Information Box */}
              <div className="bg-blue-900/10 border border-blue-900/20 rounded-xl p-5 text-zinc-300">
                <h3 className="text-[14px] font-bold text-white mb-2 flex items-center gap-2">
                  <Shield size={16} className="text-blue-400" />
                  Bypassing Permission Prompts
                </h3>
                <p className="text-[13px] leading-relaxed mb-3">
                  For security, your browser resets local folder permissions when you reload the page, requiring you to grant access again. To prevent this and allow silent auto-saving:
                </p>
                <ol className="text-[13px] list-decimal list-inside space-y-1 ml-1 text-zinc-400">
                  <li>Click the <strong className="text-white">lock/settings icon</strong> to the left of the URL in your browser's address bar.</li>
                  <li>Find the <strong className="text-white">File System</strong> or <strong className="text-white">Edit files on your device</strong> setting.</li>
                  <li>Change its value to <strong className="text-white">Allow</strong>.</li>
                </ol>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (activeConnector === 'drive') {
    return (
      <div className="w-full h-full px-12 py-10 overflow-y-auto animate-[fadeIn_150ms_ease-out]">
        <button 
          onClick={() => setActiveConnector(null)}
          className="flex items-center gap-2 text-[14px] text-zinc-400 hover:text-white transition-colors mb-6 group"
        >
          <ChevronDown className="rotate-90 group-hover:-translate-x-1 transition-transform" size={16} />
          <span>Connectors</span>
        </button>

         <div className="flex items-center justify-center mb-10">
           <div className="flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 flex items-center justify-center">
                <HardDrive size={32} className="text-white" />
              </div>
              <div>
                   <div className="flex items-center justify-center gap-2.5 mb-1">
                  <h1 className="text-[24px] font-bold text-white">Drive</h1>
                  {isDriveConnected && (
                    <span className="w-2 h-2 rounded-full bg-[#4ade80] shrink-0 animate-pulse" />
                  )}
                </div>
                <p className="text-[16px] text-zinc-400">Save and share your projects</p>
              </div>
           </div>
        </div>

        <div className="max-w-xl mx-auto space-y-8">
          <div>
            <h2 className="text-[18px] font-bold text-white mb-3">Overview</h2>
            <p className="text-[14px] leading-relaxed text-zinc-400">
              Connect your Google Drive to save and share your projects seamlessly. Your projects will be 
              stored in a dedicated folder, making it easy to access them from anywhere and collaborate with your team.
            </p>
          </div>

          {/* Connection Status & Action */}
          <div className="bg-[#272729] border border-white/5 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 flex items-center justify-center">
                  {isDriveConnected ? (
                    <Check size={24} className="text-[#4ade80]" />
                  ) : (
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                  )}
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-white mb-0.5">
                    {isDriveConnected ? 'Google Drive Connected' : 'Google Drive'}
                  </h3>
                  <p className="text-[13px] text-zinc-400">
                    {isDriveConnected 
                      ? 'Your projects are being synced to Drive' 
                      : 'Connect to save projects to your Drive'}
                  </p>
                </div>
              </div>
              
              {isDriveConnected ? (
                <button 
                  onClick={disconnectDrive}
                  className="px-4 py-2 bg-[#1c1c1c] text-zinc-400 text-[13px] font-medium rounded-lg hover:bg-[#2a2a2a] hover:text-white transition-colors border border-white/10"
                >
                  Disconnect
                </button>
              ) : (
                <button 
                  onClick={connectDrive}
                  className="px-5 py-2.5 bg-white text-black text-[13px] font-bold rounded-xl hover:bg-zinc-200 transition-colors shadow-lg shadow-white/5 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Connect Google Drive
                </button>
              )}
            </div>
          </div>

          {/* Benefits */}
          {!isDriveConnected && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#272729] border border-white/5 rounded-xl p-4">
                <h3 className="text-[14px] font-bold text-white mb-1">Cloud Backup</h3>
                <p className="text-[13px] text-zinc-400">Your projects are safely stored in the cloud.</p>
              </div>
              <div className="bg-[#272729] border border-white/5 rounded-xl p-4">
                <h3 className="text-[14px] font-bold text-white mb-1">Easy Sharing</h3>
                <p className="text-[13px] text-zinc-400">Share projects with anyone via Drive links.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
};
