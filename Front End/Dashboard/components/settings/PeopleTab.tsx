import React from 'react';
import { Search, ChevronDown, Users, MoreHorizontal } from 'lucide-react';

interface PeopleTabProps {
  userProfile: any;
  user: any;
}

export const PeopleTab: React.FC<PeopleTabProps> = ({ userProfile, user }) => (
  <div className="w-full h-full px-12 py-10 flex flex-col overflow-y-auto">
    <div className="flex items-center justify-between mb-2">
      <h1 className="text-[24px] font-bold text-white">People</h1>
    </div>
    
    <div className="pb-6 mb-6">
      <p className="text-[14px] text-zinc-400">
         Inviting people to <span className="text-white font-medium">{userProfile?.workspaceName || "My Willow"}</span> gives access to workspace shared projects and credits. You have 1 builder in this workspace.
      </p>
    </div>

    {/* Tabs */}
    <div className="flex items-center gap-1 mb-8">
      {['All', 'Invitations', 'Collaborators'].map((tab) => (
        <button 
          key={tab}
          className={`px-4 py-1.5 text-[13px] font-medium rounded-full transition-colors
            ${tab === 'All' 
              ? 'bg-[#27272a] text-white' 
              : 'text-zinc-500 hover:text-white'
            }`}
        >
          {tab}
        </button>
      ))}
    </div>

    {/* Search and Action Bar */}
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
          <input 
            type="text" 
            placeholder="Search..."
            className="bg-transparent border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-[13px] text-white w-64 focus:outline-none focus:border-white/20 transition-colors"
          />
        </div>
        <button className="flex items-center justify-between gap-2 bg-transparent border border-white/10 rounded-lg px-3 py-1.5 text-[13px] text-white w-32 hover:bg-white/5 transition-colors">
          <span>All roles</span>
          <ChevronDown size={14} className="text-zinc-500" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-white/5 rounded-lg transition-colors border border-white/5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Export</span>
        </button>
        <button className="flex items-center gap-2 px-4 py-1.5 bg-white text-black text-[13px] font-bold rounded-lg hover:bg-zinc-200 transition-colors">
          <Users size={16} />
          <span>Invite members</span>
        </button>
      </div>
    </div>

    {/* Table Container */}
    <div className="flex-1 min-h-0 flex flex-col border border-white/5 rounded-xl bg-[#1c1c1c] overflow-hidden">
      <div className="grid grid-cols-[1fr_120px_140px_120px_120px_120px_40px] px-4 py-3 bg-[#242424]/40 border-b border-white/5 text-[12px] font-medium text-zinc-500">
        {[
          { label: 'Name', sortable: true },
          { label: 'Role', sortable: true },
          { label: 'Joined date', sortable: true },
          { label: 'Dec usage', sortable: true },
          { label: 'Total usage', sortable: true },
          { label: 'Credit limit', sortable: true },
        ].map((col) => (
          <div key={col.label} className="flex items-center gap-1 cursor-pointer hover:text-white transition-colors">
            <span>{col.label}</span>
            {col.sortable && (
              <div className="flex flex-col gap-0.5 opacity-50">
                <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[4px] border-b-current" />
                <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[4px] border-t-current" />
              </div>
            )}
          </div>
        ))}
        <div />
      </div>
      
      <div className="divide-y divide-white/5">
        <div className="grid grid-cols-[1fr_120px_140px_120px_120px_120px_40px] px-4 py-4 items-center group hover:bg-white/[0.02] transition-colors">
          <div className="flex items-center gap-3">
            {userProfile?.photoURL ? (
              <img 
                src={userProfile.photoURL} 
                alt="User" 
                className="w-10 h-10 rounded-full border border-white/10 object-cover" 
              />
            ) : (
              <div className="w-10 h-10 rounded-full border border-white/10 bg-gradient-to-br from-[#1e3a29] via-[#4a7c59] to-[#8fb896] flex items-center justify-center text-white font-medium">
                {userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || '?'}
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-[13px] font-bold text-white">{userProfile?.displayName || 'User'} (you)</span>
              <span className="text-[12px] text-zinc-500">{user?.email || ''}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[13px] text-zinc-300">
            <span>Owner</span>
            <ChevronDown size={14} className="text-zinc-500" />
          </div>
          <div className="text-[13px] text-zinc-300">Jun 17, 2025</div>
          <div className="text-[13px] text-white font-bold">6 credits</div>
          <div className="text-[13px] text-white font-bold">33 credits</div>
          <div className="text-[13px] text-zinc-300"></div>
          <div className="flex justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button className="p-1 hover:text-white transition-colors">
              <MoreHorizontal size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
);
