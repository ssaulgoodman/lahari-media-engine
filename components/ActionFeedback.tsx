import React from 'react';

/**
 * Inline error message — renders below/beside the action that failed.
 * Dismissible via click or the onDismiss callback.
 */
export const ActionError: React.FC<{
  error: string | null;
  onDismiss?: () => void;
  className?: string;
}> = ({ error, onDismiss, className = '' }) => {
  if (!error) return null;
  return (
    <div
      className={`text-[11px] text-red-400 mt-1 flex items-start gap-1.5 ${className}`}
      onClick={onDismiss}
      role={onDismiss ? 'button' : undefined}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 mt-px flex-shrink-0">
        <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
      </svg>
      <span>{error}</span>
    </div>
  );
};

/**
 * Tiny spinner for inline use alongside buttons/text.
 */
export const ActionSpinner: React.FC<{ className?: string }> = ({ className = 'w-3 h-3' }) => (
  <div className={`border-2 border-zinc-600 border-t-white rounded-full animate-spin ${className}`} />
);
