import React, { useEffect, useRef } from 'react';

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'ref'> & {
  inputRef?: React.Ref<HTMLTextAreaElement>;
};

// Textarea that grows to fit its content — no inner scroll. The user always
// sees the whole thing they typed. Shrinks back when content is removed.
export const AutoGrowTextarea: React.FC<Props> = ({ inputRef, value, defaultValue, onInput, style, ...rest }) => {
  const innerRef = useRef<HTMLTextAreaElement>(null);

  const resize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // Re-fit when controlled value changes externally (e.g. cleared after submit).
  useEffect(() => { resize(innerRef.current); }, [value]);
  // Initial fit (also handles defaultValue case).
  useEffect(() => { resize(innerRef.current); }, []);

  const setRef = (el: HTMLTextAreaElement | null) => {
    (innerRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef && 'current' in inputRef) (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
  };

  return (
    <textarea
      {...rest}
      ref={setRef}
      value={value as any}
      defaultValue={defaultValue as any}
      onInput={(e) => { resize(e.currentTarget); onInput?.(e); }}
      style={{ ...style, overflow: 'hidden', resize: 'none' }}
    />
  );
};
