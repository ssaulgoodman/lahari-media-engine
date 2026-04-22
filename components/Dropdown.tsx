import React, { useState, useRef, useEffect } from 'react';

/**
 * Custom dropdown — replaces native <select> for cross-platform dark UI.
 * Same behavior, matches our surface styles on all platforms.
 */

export interface DropdownOption {
  value: string;
  label: string;
  /** Separator line before this option */
  divider?: boolean;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** Size variant */
  size?: 'sm' | 'xs';
}

export const Dropdown: React.FC<DropdownProps> = ({
  value, options, onChange, disabled, title, className = '', size = 'sm',
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const textSize = size === 'xs' ? 'text-[11px]' : 'text-sm';

  return (
    <div ref={ref} className={`relative ${className}`} title={title}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`w-full flex items-center justify-between gap-1 bg-transparent ${textSize} text-zinc-300 outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed truncate`}
      >
        <span className="truncate">{selected?.label || value}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-zinc-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 min-w-full w-max max-h-60 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#1c1c20] shadow-xl shadow-black/40 py-1">
          {options.map((opt, i) => (
            <React.Fragment key={opt.value}>
              {opt.divider && i > 0 && <div className="h-px bg-white/[0.06] my-1" />}
              <button
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 ${textSize} transition-colors truncate ${
                  opt.value === value
                    ? 'text-white bg-white/[0.06]'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                }`}
              >
                {opt.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
