import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatWindow } from './components/ChatWindow';
import { Header } from './components/Header';
import { api } from './lib/api';
import type { Conversation, Message } from './types';

export default function App() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);

  useEffect(() => {
    // Load conversations or create a new one
    initApp();
  }, []);

  const initApp = async () => {
    try {
      const conversations = await api.listConversations();
      if (conversations.length > 0) {
        const conv = await api.getConversation(conversations[0].id);
        setConversationId(conv.id);
        setConversation(conv);
      } else {
        handleNewConversation();
      }
    } catch (error) {
      console.error('Failed to initialize:', error);
      // Create new conversation anyway
      handleNewConversation();
    }
  };

  const handleNewConversation = async () => {
    try {
      const conv = await api.createConversation();
      setConversationId(conv.id);
      setConversation({ ...conv, messages: [] });
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = async (id: string) => {
    try {
      const conv = await api.getConversation(id);
      setConversationId(id);
      setConversation(conv);
      setIsRunning(conv.status === 'running');
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await api.deleteConversation(id);
      if (conversationId === id) {
        handleNewConversation();
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleMessageAdded = (message: Message) => {
    setConversation((prev) =>
      prev ? { ...prev, messages: [...prev.messages, message] } : null
    );
  };

  const handleStatusChange = (status: 'idle' | 'running') => {
    setIsRunning(status === 'running');
    if (conversation) {
      setConversation({ ...conversation, status });
    }
  };

  return (
    <div className="flex h-screen bg-dark-400 text-white">
      {/* Sidebar */}
      <div
        className={`
          ${showSidebar ? 'w-72' : 'w-0'}
          transition-all duration-300 overflow-hidden
          lg:relative absolute z-20 h-full
        `}
      >
        <Sidebar
          currentConversationId={conversationId}
          onSelectConversation={(id) => {
            handleSelectConversation(id);
            setShowSidebar(false);
          }}
          onNewConversation={() => {
            handleNewConversation();
            setShowSidebar(false);
          }}
          onDeleteConversation={handleDeleteConversation}
        />
      </div>

      {/* Overlay for mobile */}
      {showSidebar && (
        <div
          className="fixed inset-0 bg-black/50 z-10 lg:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          title={conversation?.title || 'New Conversation'}
          status={conversation?.status || 'idle'}
          onToggleSidebar={() => setShowSidebar(!showSidebar)}
        />

        {conversationId ? (
          <ChatWindow
            conversationId={conversationId}
            messages={conversation?.messages || []}
            isRunning={isRunning}
            onMessageAdded={handleMessageAdded}
            onStatusChange={handleStatusChange}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="flex gap-1 mb-4 justify-center">
                <div className="w-3 h-3 bg-gray-400 rounded-full typing-dot" />
                <div className="w-3 h-3 bg-gray-400 rounded-full typing-dot" />
                <div className="w-3 h-3 bg-gray-400 rounded-full typing-dot" />
              </div>
              <p className="text-gray-400">Loading...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}