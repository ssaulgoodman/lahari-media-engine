import React, { useEffect, useLayoutEffect, useRef } from 'react';

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'ref'> & {
  inputRef?: React.Ref<HTMLTextAreaElement>;
};

// Textarea that grows to fit its content — no inner scroll. The user always
// sees the whole thing they typed. Shrinks back when content is removed.
export const AutoGrowTextarea: React.FC<Props> = ({ inputRef, value, defaultValue, onInput, style, ...rest }) => {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  const frameRef = useRef<number | null>(null);
  const observedWidthRef = useRef<number | null>(null);

  const resize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  };

  const scheduleResize = () => {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    resize(innerRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      resize(innerRef.current);
    });
  };

  // Re-fit before paint when controlled value changes externally, including
  // agent-written prompts. Running once more in rAF catches width/font/layout
  // changes after expand/collapse so old tall measurements do not linger.
  useLayoutEffect(() => { scheduleResize(); }, [value, defaultValue]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    observedWidthRef.current = el.getBoundingClientRect().width;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (!width || Math.abs(width - (observedWidthRef.current || 0)) < 0.5) return;
      observedWidthRef.current = width;
      scheduleResize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
  }, []);

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
