import React from 'react';
import { PenLine, ArrowUpRight } from 'lucide-react';

interface AccountTabProps {
  user: any;
  userProfile: any;
  localDisplayName: string;
  setLocalDisplayName: (v: string) => void;
  localUsername: string;
  setLocalUsername: (v: string) => void;
  localPhotoURL: string | null;
  setLocalPhotoURL: (v: string | null) => void;
  localLocation: string;
  setLocalLocation: (v: string) => void;
  localDescription: string;
  setLocalDescription: (v: string) => void;
  accountSettingsChanged: boolean;
  setAccountSettingsChanged: (v: boolean) => void;
  showDeleteConfirmation: boolean;
  setShowDeleteConfirmation: (v: boolean) => void;
  isDeleting: boolean;
  deleteError: string | null;
  setDeleteError: (v: string | null) => void;
  handleDeleteAccount: () => Promise<void>;
  handleAccountUpdate: () => Promise<void>;
  handleAccountCancel: () => void;
}

export const AccountTab: React.FC<AccountTabProps> = ({
  user,
  userProfile,
  localDisplayName,
  setLocalDisplayName,
  localUsername,
  setLocalUsername,
  localPhotoURL,
  setLocalPhotoURL,
  localLocation,
  setLocalLocation,
  localDescription,
  setLocalDescription,
  accountSettingsChanged,
  setAccountSettingsChanged,
  showDeleteConfirmation,
  setShowDeleteConfirmation,
  isDeleting,
  deleteError,
  setDeleteError,
  handleDeleteAccount,
  handleAccountUpdate,
  handleAccountCancel,
}) => (
  <div className="w-full h-full relative flex flex-col">
    <div className="flex-1 overflow-y-auto px-12 py-10 pb-32">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-[24px] font-bold text-white">Account settings</h1>
      </div>
      <div className="pb-6 border-b border-white/5 mb-6">
        <p className="text-[14px] text-zinc-400">
             Personalize how others see and interact with you on Willow.
        </p>
      </div>

      {/* Avatar */}
       <div className="flex items-start gap-8 py-6 border-b border-white/5">
        <div className="w-[50%] shrink-0">
          <h3 className="text-[14px] font-bold text-white mb-1">Your avatar</h3>
          <p className="text-[14px] text-zinc-400">Your avatar is either fetched from your linked identity provider or automatically generated based on your account.</p>
        </div>
        <div className="flex-1 flex justify-end">
          <div className="relative group cursor-pointer">
            <input
              type="file"
              id="account-avatar-upload"
              accept="image/*"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  const file = e.target.files[0];
                  const imageUrl = URL.createObjectURL(file);
                  setLocalPhotoURL(imageUrl);
                  setAccountSettingsChanged(true);
                }
              }}
              className="hidden"
            />
            <label htmlFor="account-avatar-upload" className="cursor-pointer block relative">
              {localPhotoURL ? (
                <img 
                  src={localPhotoURL} 
                  alt="User Avatar" 
                  className="w-[64px] h-[64px] rounded-full object-cover"
                />
              ) : (
                <div className="w-[64px] h-[64px] rounded-full bg-gradient-to-br from-[#1e3a29] via-[#4a7c59] to-[#8fb896] flex items-center justify-center">
                  <span className="text-white text-xl font-medium">
                    {localDisplayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || '?'}
                  </span>
                </div>
              )}
              {/* Hover overlay */}
              <div className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <PenLine size={20} className="text-white" />
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Username */}
      <div className="py-6 border-b border-white/5">
        <div className="flex items-start gap-8">
             <div className="w-[50%] shrink-0">
            <h3 className="text-[14px] font-bold text-white mb-1">Username</h3>
            <p className="text-[14px] text-zinc-400">Your public identifier and profile URL. No spaces allowed.</p>
          </div>
          <div className="flex-1">
            <input 
              type="text" 
              value={localUsername}
              onChange={(e) => {
                // Remove spaces from username
                const noSpaces = e.target.value.replace(/\s+/g, '');
                setLocalUsername(noSpaces);
                setAccountSettingsChanged(true);
              }}
              className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-2.5 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors mb-2"
            />
            <a href="#" className="text-[13px] text-zinc-500 hover:text-zinc-400 transition-colors flex items-center gap-1">
              willow.dev/@{localUsername || 'user'} 
              <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
      </div>

       {/* Email */}
       <div className="py-6 border-b border-white/5">
        <div className="flex items-start gap-8">
             <div className="w-[50%] shrink-0">
            <h3 className="text-[14px] font-bold text-white mb-1">Email</h3>
            <p className="text-[14px] text-zinc-400">Your email address associated with your account.</p>
          </div>
          <div className="flex-1">
            <input 
              type="email" 
              value={user?.email || ''}
              readOnly
              className="w-full bg-[#1c1c1c] border border-white/5 rounded-xl px-4 py-2.5 text-[14px] text-zinc-400 focus:outline-none cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      {/* Name */}
      <div className="py-6 border-b border-white/5">
        <div className="flex items-start gap-8">
             <div className="w-[50%] shrink-0">
            <h3 className="text-[14px] font-bold text-white mb-1">Name</h3>
            <p className="text-[14px] text-zinc-400">Your full name, as visible to others.</p>
          </div>
          <div className="flex-1">
            <input 
              type="text" 
              value={localDisplayName}
              onChange={(e) => {
                setLocalDisplayName(e.target.value);
                setAccountSettingsChanged(true);
              }}
              className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-2.5 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="py-6 border-b border-white/5">
        <div className="flex items-start gap-8">
             <div className="w-[50%] shrink-0">
            <h3 className="text-[14px] font-bold text-white mb-1">Description</h3>
            <p className="text-[14px] text-zinc-400">A short description of yourself or your work.</p>
          </div>
          <div className="flex-1">
            <textarea 
              value={localDescription}
              onChange={(e) => {
                setLocalDescription(e.target.value);
                setAccountSettingsChanged(true);
              }}
              className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors resize-y min-h-[100px]"
            />
          </div>
        </div>
      </div>

      {/* Location */}
      <div className="py-6 border-b border-white/5">
        <div className="flex items-start gap-8">
             <div className="w-[50%] shrink-0">
            <h3 className="text-[14px] font-bold text-white mb-1">Location</h3>
            <p className="text-[14px] text-zinc-400">Where you're based.</p>
          </div>
          <div className="flex-1">
            <input 
              type="text"
              value={localLocation}
              onChange={(e) => {
                setLocalLocation(e.target.value);
                setAccountSettingsChanged(true);
              }}
              className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-2.5 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Link */}
      <div className="py-6 border-b border-white/5">
        <div className="flex items-start gap-8">
             <div className="w-[50%] shrink-0">
            <h3 className="text-[14px] font-bold text-white mb-1">Link</h3>
            <p className="text-[14px] text-zinc-400">Add a link to your personal website or portfolio.</p>
          </div>
          <div className="flex-1">
            <input 
              type="text" 
              className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-2.5 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Hide profile picture */}
      <div className="py-6 border-b border-white/5 flex items-start justify-between gap-8">
        <div className="flex-1 max-w-[50%]">
          <h3 className="text-[14px] font-bold text-white mb-1">Hide profile picture</h3>
        </div>
        <div className="w-4 h-4 rounded border border-white/10 bg-transparent cursor-pointer flex items-center justify-center">
             {/* Checkbox Placeholder */}
        </div>
      </div>

      {/* Chat suggestions */}
      <div className="py-6 flex items-start justify-between gap-8">
        <div className="flex-1 max-w-[50%]">
          <h3 className="text-[14px] font-bold text-white mb-1">Chat suggestions</h3>
          <p className="text-[14px] text-zinc-400">Show helpful suggestions in the chat interface to enhance your experience.</p>
        </div>
         <div className="w-9 h-5 rounded-full bg-zinc-800 p-0.5 cursor-pointer relative group border border-white/5">
          <div className="w-3.5 h-3.5 rounded-full bg-white transition-all translate-x-[16px]" />
        </div>
      </div>

      {/* Generation complete sound */}
      <div className="py-6 border-t border-white/5 flex items-start justify-between gap-8">
        <div className="flex-1 max-w-[50%]">
          <h3 className="text-[14px] font-bold text-white mb-1">Generation complete sound</h3>
           <p className="text-[14px] text-zinc-400">Plays a satisfying sound notification when a generation is finished.</p>
        </div>
         <div className="space-y-2">
             <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border border-white/20 flex items-center justify-center">
              <div className="w-2 h-2 bg-white rounded-full"></div>
            </div>
            <span className="text-[14px] text-white">First generation</span>
          </div>
             <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border border-white/20"></div>
            <span className="text-[14px] text-zinc-400">Always</span>
          </div>
             <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border border-white/20"></div>
            <span className="text-[14px] text-zinc-400">Never</span>
          </div>
        </div>
      </div>

       {/* Linked sign-in providers */}
      <div className="py-6 border-t border-white/5 flex items-start justify-between gap-8">
        <div className="flex-1 max-w-[100%]">
          <h3 className="text-[14px] font-bold text-white mb-1">Linked sign-in providers</h3>
           <p className="text-[14px] text-zinc-400 mb-3">Manage authentication providers linked to your account.</p>
           
           <div className="w-full bg-[#1c1c1c] border border-white/5 rounded-xl px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                      <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center p-1">
                          {/* Google G SVG */}
                          <svg viewBox="0 0 24 24" className="w-full h-full">
                              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                          </svg>
                      </div>
                      <div>
                          <div className="text-[13px] font-medium text-white flex items-center gap-2">
                              Google 
                              <span className="bg-zinc-800 text-zinc-400 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">Primary</span>
                          </div>
                          <div className="text-[13px] text-zinc-500">{user?.email || ''}</div>
                      </div>
                </div>
           </div>
        </div>
      </div>


       {/* Delete account */}
       <div className="py-6 border-t border-white/5 flex items-center justify-between gap-8 mb-8">
        <div className="flex-1 max-w-[60%]">
          <h3 className="text-[14px] font-bold text-white mb-1">Delete account</h3>
           <p className="text-[14px] text-zinc-400">Permanently delete your Willow account. This cannot be undone.</p>
        </div>
        <button 
          onClick={() => setShowDeleteConfirmation(true)}
          className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-[13px] font-medium rounded-lg transition-colors"
        >
          Delete account
        </button>
      </div>

      {/* Delete Account Confirmation Dialog */}
      {showDeleteConfirmation && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200]">
          <div className="bg-[#1c1c1c] border border-white/10 rounded-[2rem] p-8 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-red-600/20 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                  <path d="M12 9v4"/>
                  <path d="M12 17h.01"/>
                </svg>
              </div>
              <h2 className="text-[20px] font-bold text-white">Delete your account?</h2>
            </div>
            
            <div className="bg-red-600/10 border border-red-600/20 rounded-xl p-4 mb-6">
              <p className="text-[14px] text-red-200">
                <strong>Warning:</strong> This action is permanent and cannot be undone. All of the following will be deleted:
              </p>
              <ul className="text-[14px] text-red-200/80 mt-2 space-y-1 list-disc list-inside">
                <li>All your projects and code</li>
                <li>Your profile and settings</li>
                <li>All data in Google Drive (Willow Apps folder)</li>
                <li>Your account credentials</li>
              </ul>
            </div>
            
            {deleteError && (
              <div className="bg-red-600/20 border border-red-600/30 rounded-xl p-3 mb-4">
                <p className="text-[13px] text-red-300">{deleteError}</p>
              </div>
            )}
            
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirmation(false);
                  setDeleteError(null);
                }}
                className="flex-1 px-4 py-3 text-[14px] font-semibold text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="flex-1 px-4 py-3 text-[14px] font-semibold text-white bg-red-600 hover:bg-red-500 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Deleting...
                  </>
                ) : (
                  'Delete permanently'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spacer for floating footer */}
      <div className="h-10"></div>
    </div>
    
    {/* Floating Footer */}
    <div className="absolute bottom-0 w-full bg-[#1c1c1c] border-t border-white/10 px-8 py-4 flex items-center justify-end gap-3 z-10 shadow-2xl">
         <button 
          onClick={handleAccountCancel}
          className="px-4 py-2 text-[13px] font-bold text-white hover:bg-white/5 rounded-lg transition-colors"
       >
          Cancel
      </button>
      <button 
          onClick={handleAccountUpdate}
          disabled={!accountSettingsChanged}
          className="px-5 py-2 bg-white text-black text-[13px] font-bold rounded-lg hover:bg-zinc-100 transition-colors shadow-lg shadow-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
      >
          Update
      </button>
    </div>
  </div>
);
