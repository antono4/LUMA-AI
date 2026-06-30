import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Menu, X, Sparkles, Zap, Shield, Code, Settings } from 'lucide-react';
import { api } from './lib/api';
import type { Message, ConversationSummary } from './types';

export default function App() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [currentConversationTitle, setCurrentConversationTitle] = useState<string>('New Chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [aiProvider, setAiProvider] = useState(localStorage.getItem('ai_provider') || 'openrouter');
  const [openrouterKey, setOpenrouterKey] = useState(localStorage.getItem('openrouter_api_key') || '');
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem('openai_api_key') || '');
  const [ollamaUrl, setOllamaUrl] = useState(localStorage.getItem('ollama_url') || 'http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState(localStorage.getItem('ollama_model') || 'llama3.2');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    initApp();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent]);

  const initApp = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
      if (convs.length > 0) {
        await selectConversation(convs[0].id);
      } else {
        await createNewConversation();
      }
    } catch (error) {
      console.error('Failed to initialize:', error);
      setConversations([]);
      setMessages([{
        id: 'welcome-error',
        role: 'assistant',
        content: '🔌 **Selamat Datang di LUMA AI!**\n\nKlik tombol ⚙️ di pojok kiri atas untuk mengatur API key AI.\n\n**Pilihan AI Gratis:**\n1. **OpenRouter** (Rekomendasi) - API key gratis di openrouter.ai\n2. **Ollama** - Jalankan AI lokal secara gratis',
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setIsInitialized(true);
    }
  };

  const createNewConversation = async () => {
    try {
      const conv = await api.createConversation();
      const summary: ConversationSummary = {
        id: conv.id,
        title: conv.title,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        status: conv.status,
      };
      setConversations(prev => [summary, ...prev]);
      await selectConversation(conv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const selectConversation = async (id: string) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversationId(id);
      setCurrentConversationTitle(conv.title || 'New Chat');
      setMessages(conv.messages || []);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversationId === id) {
        if (conversations.length > 1) {
          const nextConv = conversations.find(c => c.id !== id);
          if (nextConv) await selectConversation(nextConv.id);
        } else {
          await createNewConversation();
        }
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !currentConversationId) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);
    setStreamingContent('');

    // Add user message immediately
    const tempUserMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    let accumulatedContent = '';

    try {
      await api.sendMessage(currentConversationId, userMessage, (event) => {
        if (event.type === 'content') {
          accumulatedContent += event.data as string;
          setStreamingContent(accumulatedContent);
        }
      });

      // Add assistant message from accumulated content
      if (accumulatedContent) {
        const assistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: accumulatedContent,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      // Show error message in chat
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Maaf, terjadi kesalahan: ${error instanceof Error ? error.message : 'Tidak dapat terhubung ke AI. Pastikan API key sudah benar.'}`,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev.filter(m => m.id !== tempUserMsg.id), tempUserMsg, errorMsg]);
    } finally {
      setStreamingContent('');
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return 'Hari ini';
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Sidebar */}
      <div
        className={`
          ${showSidebar ? 'w-80' : 'w-0'}
          transition-all duration-300 ease-out overflow-hidden
          lg:relative absolute z-30 h-full flex-shrink-0
        `}
      >
        <div className="w-80 h-full flex flex-col border-r" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
          {/* Logo */}
          <div className="p-6 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center animate-pulse-glow" style={{ background: 'var(--accent-gradient)' }}>
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="font-bold text-lg gradient-text">LUMA AI</h1>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {aiProvider === 'openrouter' ? '🆓 Free (OpenRouter)' : aiProvider === 'openai' ? '💰 OpenAI' : '🤖 Ollama'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                title="Pengaturan AI"
              >
                <Settings className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
          </div>

          {/* New Chat Button */}
          <div className="p-4">
            <button
              onClick={createNewConversation}
              className="w-full py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 btn-glow"
              style={{ background: 'var(--accent-gradient)', color: 'white' }}
            >
              <Plus className="w-5 h-5" />
              New Chat
            </button>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
              Recent Chats
            </p>
            <div className="space-y-2">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => {
                    selectConversation(conv.id);
                    setShowSidebar(false);
                  }}
                  className={`w-full p-3 rounded-xl text-left flex items-start justify-between group transition-all duration-200 ${
                    currentConversationId === conv.id
                      ? 'glass'
                      : 'hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate text-sm" style={{ color: 'var(--text-primary)' }}>
                      {conv.title}
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      {formatDate(conv.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => deleteConversation(conv.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/20 transition-all"
                  >
                    <Trash2 className="w-4 h-4" style={{ color: 'var(--error)' }} />
                  </button>
                </button>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-3 p-3 rounded-xl glass">
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-gradient)' }}>
                <span className="text-white text-sm font-bold">U</span>
              </div>
              <div>
                <p className="text-sm font-medium">User</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Online</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Overlay for mobile */}
      {showSidebar && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden backdrop-blur-sm"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 px-6 flex items-center justify-between border-b" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="lg:hidden p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              {showSidebar ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
              <h2 className="font-semibold">{currentConversationTitle}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isLoading && (
              <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--accent-primary)' }}>
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent-primary)' }} />
                Thinking...
              </span>
            )}
          </div>
        </header>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {!isInitialized ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="flex gap-1 mb-4 justify-center">
                  <div className="w-2 h-2 rounded-full typing-dot" style={{ background: 'var(--accent-primary)' }} />
                  <div className="w-2 h-2 rounded-full typing-dot" style={{ background: 'var(--accent-secondary)' }} />
                  <div className="w-2 h-2 rounded-full typing-dot" style={{ background: 'var(--accent-primary)' }} />
                </div>
                <p style={{ color: 'var(--text-secondary)' }}>Memuat...</p>
              </div>
            </div>
          ) : messages.length === 0 && !streamingContent ? (
            <div className="flex flex-col items-center justify-center h-full animate-fade-in">
              {/* Welcome Screen */}
              <div className="text-center max-w-2xl">
                <div className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center animate-float" style={{ background: 'var(--accent-gradient)' }}>
                  <Sparkles className="w-10 h-10 text-white" />
                </div>
                <h1 className="text-3xl font-bold mb-3">
                  Halo! Saya <span className="gradient-text">LUMA AI</span>
                </h1>
                <p className="text-lg mb-8" style={{ color: 'var(--text-secondary)' }}>
                  Assistant AI yang siap membantu kamu dengan berbagai kebutuhan coding, analisis, dan problem-solving.
                </p>
                
                {/* Feature Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl glass">
                    <Code className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--accent-primary)' }} />
                    <h3 className="font-semibold mb-1">Coding Assistant</h3>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Bantu tulis & debug code</p>
                  </div>
                  <div className="p-4 rounded-xl glass">
                    <Zap className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--accent-secondary)' }} />
                    <h3 className="font-semibold mb-1">Cepat & Tepat</h3>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Respon instan & akurat</p>
                  </div>
                  <div className="p-4 rounded-xl glass">
                    <Shield className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--success)' }} />
                    <h3 className="font-semibold mb-1">Aman & Privasi</h3>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Data kamu aman</p>
                  </div>
                </div>

                {/* Quick Suggestions */}
                <div className="mt-8 flex flex-wrap justify-center gap-2">
                  {[
                    'Bantu saya menulis fungsi Python',
                    'Debug kode JavaScript ini',
                    'Jelaskan konsep AI',
                    'Buat API endpoint'
                  ].map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(suggestion)}
                      className="px-4 py-2 rounded-full text-sm glass hover:opacity-80 transition-opacity"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-6">
              {messages.map((msg, index) => (
                <div
                  key={msg.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] message-user px-5 py-3">
                        <p className="text-white">{msg.content}</p>
                        <p className="text-xs text-white/60 mt-1">{formatTime(msg.created_at)}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] message-assistant px-5 py-4">
                        {msg.tool_name && (
                          <div className="flex items-center gap-2 mb-2 text-xs font-medium" style={{ color: 'var(--warning)' }}>
                            <Zap className="w-3 h-3" />
                            {msg.tool_name}
                          </div>
                        )}
                        <div className="prose prose-invert prose-sm max-w-none">
                          <pre className="whitespace-pre-wrap font-sans text-sm bg-transparent p-0 m-0 leading-relaxed">
                            {msg.content}
                          </pre>
                        </div>
                        <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{formatTime(msg.created_at)}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming Content */}
              {streamingContent && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] message-assistant px-5 py-4">
                    <div className="prose prose-invert prose-sm max-w-none">
                      <pre className="whitespace-pre-wrap font-sans text-sm bg-transparent p-0 m-0 leading-relaxed">
                        {streamingContent}
                        <span className="animate-pulse" style={{ color: 'var(--accent-primary)' }}>▊</span>
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* Loading Indicator */}
              {isLoading && !streamingContent && (
                <div className="flex justify-start">
                  <div className="message-assistant px-5 py-4">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full typing-dot" style={{ background: 'var(--accent-primary)' }} />
                      <div className="w-2 h-2 rounded-full typing-dot" style={{ background: 'var(--accent-secondary)' }} />
                      <div className="w-2 h-2 rounded-full typing-dot" style={{ background: 'var(--accent-primary)' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-6 border-t" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
            <div className="relative flex items-end gap-3 p-2 rounded-2xl" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ketik pesanmu di sini..."
                className="flex-1 bg-transparent px-4 py-3 text-white placeholder-[var(--text-muted)] resize-none focus:outline-none input-glow"
                rows={1}
                disabled={isLoading}
                style={{ maxHeight: '150px' }}
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="p-3 rounded-xl font-medium flex items-center justify-center gap-2 btn-glow disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                style={{ background: 'var(--accent-gradient)', color: 'white' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            <p className="text-center text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              Tekan Enter untuk kirim, Shift+Enter untuk baris baru
            </p>
          </form>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass rounded-2xl p-6 max-w-md w-full" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold gradient-text">Pengaturan AI</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {/* AI Provider Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                Provider AI
              </label>
              <select
                value={aiProvider}
                onChange={(e) => {
                  setAiProvider(e.target.value);
                  localStorage.setItem('ai_provider', e.target.value);
                }}
                className="w-full px-4 py-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-white focus:outline-none focus:border-[var(--accent-primary)]"
              >
                <option value="openrouter">🆓 OpenRouter (Gratis - Rekomendasi)</option>
                <option value="openai">💰 OpenAI (Berbayar)</option>
                <option value="ollama">🤖 Ollama (Lokal Gratis)</option>
              </select>
            </div>

            {/* OpenRouter Settings */}
            {aiProvider === 'openrouter' && (
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                    OpenRouter API Key
                  </label>
                  <input
                    type="password"
                    value={openrouterKey}
                    onChange={(e) => setOpenrouterKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    className="w-full px-4 py-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                </div>
                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <strong className="text-blue-400">💡 Tips:</strong> Daftar di{' '}
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 underline hover:text-blue-300"
                    >
                      OpenRouter
                    </a>{' '}
                    untuk mendapatkan API key gratis. Model default: <code className="text-green-400">google/gemma-2-9b-it:free</code>
                  </p>
                </div>
              </div>
            )}

            {/* OpenAI Settings */}
            {aiProvider === 'openai' && (
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                  OpenAI API Key
                </label>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-4 py-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  Dapatkan dari: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">platform.openai.com</a>
                </p>
              </div>
            )}

            {/* Ollama Settings */}
            {aiProvider === 'ollama' && (
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Ollama URL
                  </label>
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                    className="w-full px-4 py-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Model
                  </label>
                  <input
                    type="text"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    placeholder="llama3.2"
                    className="w-full px-4 py-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                </div>
                <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <strong className="text-yellow-400">💡 Tips:</strong> Install Ollama dari{' '}
                    <a
                      href="https://ollama.ai"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-yellow-400 underline hover:text-yellow-300"
                    >
                      ollama.ai
                    </a>{' '}
                    lalu jalankan <code className="text-green-400">ollama serve</code>
                  </p>
                </div>
              </div>
            )}

            {/* Save Button */}
            <button
              onClick={() => {
                if (aiProvider === 'openrouter') {
                  localStorage.setItem('openrouter_api_key', openrouterKey);
                } else if (aiProvider === 'openai') {
                  localStorage.setItem('openai_api_key', openaiKey);
                } else if (aiProvider === 'ollama') {
                  localStorage.setItem('ollama_url', ollamaUrl);
                  localStorage.setItem('ollama_model', ollamaModel);
                }
                setShowSettings(false);
              }}
              className="w-full py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 btn-glow"
              style={{ background: 'var(--accent-gradient)', color: 'white' }}
            >
              Simpan Pengaturan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}