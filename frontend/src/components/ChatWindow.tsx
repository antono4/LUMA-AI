import { useState, useRef, useEffect } from 'react';
import { Send, Square } from 'lucide-react';
import type { Message } from '../types';
import { api } from '../lib/api';

interface ChatWindowProps {
  conversationId: string;
  messages: Message[];
  isRunning: boolean;
  onMessageAdded: (message: Message) => void;
  onStatusChange: (status: 'idle' | 'running') => void;
}

export function ChatWindow({
  conversationId,
  messages,
  isRunning,
  onMessageAdded,
  onStatusChange,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);
    onStatusChange('running');

    try {
      await api.sendMessage(conversationId, userMessage, (event) => {
        if (event.type === 'content') {
          setStreamingContent((prev) => prev + event.data);
        }
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      setInput(userMessage); // Restore input on error
    } finally {
      // Add the final message
      const assistantMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: streamingContent,
        created_at: new Date().toISOString(),
      };
      onMessageAdded(assistantMessage);
      setStreamingContent('');
      setIsLoading(false);
      onStatusChange('idle');
    }
  };

  const handleStop = async () => {
    try {
      await api.stopConversation(conversationId);
      onStatusChange('idle');
    } catch (error) {
      console.error('Failed to stop:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !streamingContent && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-2">Welcome to OpenHands AI</h2>
              <p className="text-sm max-w-md">
                I can help you with coding tasks, file management, terminal commands,
                and more. Just describe what you need!
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`
                max-w-[80%] rounded-lg px-4 py-3
                ${
                  msg.role === 'user'
                    ? 'bg-primary-600 text-white'
                    : msg.role === 'tool'
                    ? 'bg-yellow-500/20 text-yellow-200 border border-yellow-500/30'
                    : 'bg-dark-100 text-gray-100'
                }
              `}
            >
              {msg.tool_name && (
                <div className="text-xs text-yellow-400 mb-1">
                  Tool: {msg.tool_name}
                </div>
              )}
              <div className="prose prose-invert prose-sm max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm bg-transparent p-0 m-0">
                  {msg.content}
                </pre>
              </div>
            </div>
          </div>
        ))}

        {/* Streaming content */}
        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-4 py-3 bg-dark-100 text-gray-100">
              <div className="prose prose-invert prose-sm max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm bg-transparent p-0 m-0">
                  {streamingContent}
                  <span className="animate-pulse">▊</span>
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-dark-100 rounded-lg px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full typing-dot" />
                <div className="w-2 h-2 bg-gray-400 rounded-full typing-dot" />
                <div className="w-2 h-2 bg-gray-400 rounded-full typing-dot" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-700 p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
            className="flex-1 bg-dark-100 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 resize-none focus:outline-none focus:border-primary-500"
            rows={1}
            disabled={isLoading}
            style={{ maxHeight: '200px' }}
          />
          {isRunning ? (
            <button
              type="button"
              onClick={handleStop}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors text-white"
              title="Stop"
            >
              <Square size={20} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors text-white"
            >
              <Send size={20} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}