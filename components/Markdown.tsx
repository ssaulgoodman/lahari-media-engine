import React from 'react';
import ReactMarkdown from 'react-markdown';

// Inline markdown renderer tuned for our dark UI. Kept narrow on purpose —
// we don't need tables, custom code fences, or remark plugins.
// All styling inline since Tailwind CDN doesn't ship the typography plugin.
interface Props { children: string; className?: string; }

export const Markdown: React.FC<Props> = ({ children, className = '' }) => {
  return (
    <div className={`text-sm text-zinc-300 leading-relaxed space-y-3 ${className}`}>
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="text-zinc-300 leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
          em: ({ children }) => <em className="text-zinc-300 italic">{children}</em>,
          h1: ({ children }) => <h3 className="text-lg font-semibold text-white mt-2">{children}</h3>,
          h2: ({ children }) => <h4 className="text-sm font-semibold text-white mt-2">{children}</h4>,
          h3: ({ children }) => <h5 className="text-sm font-semibold text-white mt-2">{children}</h5>,
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 text-zinc-300">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 text-zinc-300">{children}</ol>,
          li: ({ children }) => <li className="text-zinc-300">{children}</li>,
          code: ({ children }) => <code className="surface-inset rounded px-1.5 py-0.5 text-sm font-mono text-zinc-300">{children}</code>,
          pre: ({ children }) => <pre className="surface-inset rounded-md p-3 text-sm font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap">{children}</pre>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-white/20 pl-3 text-zinc-400 italic">{children}</blockquote>,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-white hover:text-zinc-300 underline underline-offset-2 decoration-white/40">{children}</a>,
          hr: () => <hr className="border-white/[0.06] my-4" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
};
