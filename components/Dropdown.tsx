import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Custom dropdown — replaces native <select> for cross-platform dark UI.
 * Same behavior, matches our surface styles on all platforms.
 * Full keyboard nav: Arrow Up/Down, Enter/Space to select, Escape to close.
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
  const [focusIdx, setFocusIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(o => o.value === value);
  const listId = useRef(`dropdown-${Math.random().toString(36).slice(2, 8)}`).current;

  // When opening, set focus index to current value
  const openMenu = useCallback(() => {
    const idx = options.findIndex(o => o.value === value);
    setFocusIdx(idx >= 0 ? idx : 0);
    setOpen(true);
  }, [options, value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Scroll focused option into view
  useEffect(() => {
    if (!open || focusIdx < 0) return;
    const list = listRef.current;
    const item = list?.children[focusIdx] as HTMLElement | undefined;
    item?.scrollIntoView?.({ block: 'nearest' });
  }, [open, focusIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIdx(prev => (prev + 1) % options.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIdx(prev => (prev - 1 + options.length) % options.length);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusIdx >= 0 && focusIdx < options.length) {
          onChange(options[focusIdx].value);
          setOpen(false);
          triggerRef.current?.focus();
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const textSize = size === 'xs' ? 'text-[11px]' : 'text-sm';

  return (
    <div ref={ref} className={`relative ${className}`} title={title} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && focusIdx >= 0 ? `${listId}-${focusIdx}` : undefined}
        onClick={() => !disabled && (open ? setOpen(false) : openMenu())}
        disabled={disabled}
        className={`w-full flex items-center justify-between gap-1 bg-transparent ${textSize} text-zinc-300 outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed truncate`}
      >
        <span className="truncate">{selected?.label || value}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-zinc-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={title}
          className="absolute z-50 mt-1 left-0 min-w-full w-max max-h-60 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#1c1c20] shadow-xl shadow-black/40 py-1"
        >
          {options.map((opt, i) => (
            <React.Fragment key={opt.value}>
              {opt.divider && i > 0 && <div className="h-px bg-white/[0.06] my-1" role="separator" />}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={opt.value === value}
                onMouseDown={(e) => { e.preventDefault(); onChange(opt.value); setOpen(false); triggerRef.current?.focus(); }}
                onMouseEnter={() => setFocusIdx(i)}
                className={`w-full text-left px-3 py-1.5 ${textSize} transition-colors truncate cursor-pointer ${
                  i === focusIdx
                    ? 'text-white bg-white/[0.08]'
                    : opt.value === value
                      ? 'text-white bg-white/[0.04]'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                }`}
              >
                {opt.label}
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
