import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../types';

interface Props {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isLoading: boolean;
}

export const ChatAssistant: React.FC<Props> = ({ messages, onSendMessage, isLoading }) => {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input);
      setInput("");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.04)] bg-obsidian-950/80">
        <h3 className="text-sm font-display font-medium text-white">Co-Director</h3>
        <p className="text-[11px] text-zinc-400 mt-0.5">Refine prompts and style with Gemini.</p>
      </div>

      <div className="flex-grow overflow-y-auto p-4 space-y-3" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-50">
            <div className="w-10 h-10 bg-white/[0.04] rounded-lg flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div className="text-zinc-400 text-sm">
                <p className="mb-3">I can help adjust your storyboard.</p>
                <div className="space-y-2 text-xs">
                    <button type="button" className="w-full text-left surface rounded-lg p-2.5 cursor-pointer hover:bg-white/[0.06] transition-colors text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20" onClick={() => setInput("Make Scene 2 more dramatic")}>"Make Scene 2 more dramatic"</button>
                    <button type="button" className="w-full text-left surface rounded-lg p-2.5 cursor-pointer hover:bg-white/[0.06] transition-colors text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20" onClick={() => setInput("Change the global style to Cyberpunk")}>"Change style to Cyberpunk"</button>
                </div>
            </div>
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-white/[0.06] text-white'
                  : 'bg-white/[0.04] text-zinc-300'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
           <div className="flex justify-start">
             <div className="bg-white/[0.04] px-3.5 py-2.5 rounded-xl">
               <div className="flex gap-1">
                 <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"></span>
                 <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.1s]"></span>
                 <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.2s]"></span>
               </div>
             </div>
           </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-4 shadow-[0_-1px_0_0_rgba(255,255,255,0.04)] bg-obsidian-950/80">
        <div className="relative">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            name="chat-input"
            autoComplete="off"
            placeholder="Suggest a change…"
            className="w-full surface-inset rounded-lg pl-4 pr-12 py-2.5 text-sm text-white outline-none focus-visible:ring-1 focus-visible:ring-white/20 placeholder:text-zinc-400 transition-colors"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            aria-label="Send message"
            className="absolute right-1.5 top-1.5 p-1.5 bg-white text-black rounded-md hover:bg-zinc-200 disabled:opacity-30 disabled:bg-zinc-700 disabled:text-zinc-400 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
              <path d="M3.105 2.29a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.16 9.5h5.59a.75.75 0 010 1.5H5.16a1.5 1.5 0 00-1.467 1.335l-1.414 4.925a.75.75 0 00.826.95l15.02-7.036a.75.75 0 000-1.348L3.105 2.29z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
};