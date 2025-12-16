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
      <div className="p-4 border-b border-white/5 bg-obsidian-900/50 backdrop-blur-md">
        <h3 className="font-display font-medium text-white flex items-center gap-2">
          <span>✨</span> Co-Director
        </h3>
        <p className="text-xs text-zinc-500 mt-1">Refine prompts & style with Gemini.</p>
      </div>

      <div className="flex-grow overflow-y-auto p-4 space-y-4" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-50">
            <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center">
                <span className="text-xl">💬</span>
            </div>
            <div className="text-zinc-400 text-sm">
                <p className="mb-2">I can help adjust your storyboard.</p>
                <div className="space-y-2 text-xs">
                    <p className="bg-white/5 p-2 rounded-lg cursor-pointer hover:bg-white/10 transition-colors" onClick={() => setInput("Make Scene 2 more dramatic")}>"Make Scene 2 more dramatic"</p>
                    <p className="bg-white/5 p-2 rounded-lg cursor-pointer hover:bg-white/10 transition-colors" onClick={() => setInput("Change the global style to Cyberpunk")}>"Change style to Cyberpunk"</p>
                </div>
            </div>
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div 
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-zinc-800 text-white rounded-br-none border border-zinc-700' 
                  : 'bg-accent-900/20 border border-accent-500/20 text-accent-100 rounded-bl-none'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
           <div className="flex justify-start">
             <div className="bg-accent-900/10 border border-accent-500/10 px-4 py-2 rounded-2xl rounded-bl-none">
               <div className="flex gap-1">
                 <span className="w-1.5 h-1.5 bg-accent-400 rounded-full animate-bounce"></span>
                 <span className="w-1.5 h-1.5 bg-accent-400 rounded-full animate-bounce [animation-delay:0.1s]"></span>
                 <span className="w-1.5 h-1.5 bg-accent-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
               </div>
             </div>
           </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-white/5 bg-obsidian-900">
        <div className="relative group">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Suggest a change..."
            className="w-full bg-black border border-white/10 rounded-xl pl-4 pr-12 py-3 text-sm text-white focus:border-accent-500/50 focus:outline-none placeholder:text-zinc-600 transition-colors group-hover:border-white/20"
          />
          <button 
            type="submit" 
            disabled={isLoading || !input.trim()}
            className="absolute right-2 top-2 p-1.5 bg-accent-600 text-white rounded-lg hover:bg-accent-500 disabled:opacity-50 disabled:bg-zinc-800 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A.75.75 0 003.779 8.1l5.22.427 5.2.427a.75.75 0 00.95-.826 4.925-1.414.95-.826L3.105 2.289zM3.105 17.711a.75.75 0 01-.826-.95l1.414-4.925a.75.75 0 01.086-.234l5.22.427 5.2.427a.75.75 0 01.95-.826 4.925 1.414.95.826L3.105 17.711z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
};