
import React from 'react';

export const UnlockPill: React.FC<{ onClick: () => void; disabled?: boolean; label?: string }> = ({ onClick, disabled, label = 'Unlock' }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="text-[11px] text-zinc-400 hover:text-white hover:bg-white/[0.06] border border-white/[0.08] hover:border-white/20 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
    title="Unlock this phase to make changes"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
    </svg>
    {label}
  </button>
);
