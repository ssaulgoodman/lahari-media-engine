
import React, { useState } from 'react';

// Slice A of the button-feedback audit (docs/button-feedback-audit.md).
// The pill internally awaits Promise.resolve(onClick()) and shows
// project-standard spinner + "Unlocking…" label while in flight. Callers
// don't change — the pill takes care of perceived feedback regardless of
// whether the caller's handler is sync or returns a Promise.
//
// Label transform: "Unlock characters" → "Unlocking characters…" preserves
// the caller's specificity (which phase is unlocking) while signaling
// in-flight state. Falls back to "Unlocking…" if the label doesn't start
// with "Unlock".
export const UnlockPill: React.FC<{
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  label?: string;
}> = ({ onClick, disabled, label = 'Unlock' }) => {
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      await Promise.resolve(onClick());
    } finally {
      setPending(false);
    }
  };

  const inFlightLabel = label.startsWith('Unlock')
    ? `${label.replace(/^Unlock/, 'Unlocking')}…`
    : 'Unlocking…';

  return (
    <button
      onClick={handleClick}
      disabled={disabled || pending}
      className="text-[11px] text-zinc-400 hover:text-white hover:bg-white/[0.06] border border-white/[0.08] hover:border-white/20 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
      title="Unlock this phase to make changes"
    >
      {pending ? (
        <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
        </svg>
      )}
      {pending ? inFlightLabel : label}
    </button>
  );
};
