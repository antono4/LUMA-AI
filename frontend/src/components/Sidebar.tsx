import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { ConversationSummary } from '../types';
import { Plus, MessageSquare, Trash2, Clock } from 'lucide-react';
import { format } from 'date-fns';

interface SidebarProps {
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation?: (id: string) => void;
}

export function Sidebar({
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
}: SidebarProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    try {
      const data = await api.listConversations();
      setConversations(data);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      if (onDeleteConversation) {
        onDeleteConversation(id);
      } else {
        await api.deleteConversation(id);
      }
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (currentConversationId === id) {
        onNewConversation();
      }
    }
  };

  return (
    <div className="w-72 bg-dark-200 h-full flex flex-col border-r border-gray-700">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <button
          onClick={onNewConversation}
          className="w-full flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors text-white font-medium"
        >
          <Plus size={18} />
          New Conversation
        </button>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-20">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-gray-400 rounded-full typing-dot" />
              <div className="w-2 h-2 bg-gray-400 rounded-full typing-dot" />
              <div className="w-2 h-2 bg-gray-400 rounded-full typing-dot" />
            </div>
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <MessageSquare size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No conversations yet</p>
            <p className="text-xs mt-1">Start a new chat to begin</p>
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`
                  group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors
                  ${
                    currentConversationId === conv.id
                      ? 'bg-primary-600/20 text-primary-300'
                      : 'hover:bg-dark-100 text-gray-300'
                  }
                `}
              >
                <MessageSquare size={16} className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{conv.title}</p>
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Clock size={10} />
                    {format(new Date(conv.updated_at), 'MMM d, h:mm a')}
                  </div>
                </div>
                {conv.status === 'running' && (
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                )}
                <button
                  onClick={(e) => handleDelete(e, conv.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-opacity"
                >
                  <Trash2 size={14} className="text-red-400" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}