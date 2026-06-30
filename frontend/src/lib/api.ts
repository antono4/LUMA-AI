import type { Conversation, ConversationSummary, Message, FileInfo } from '../types';

// AI Configuration - FREE options available!
const AI_PROVIDER = localStorage.getItem('ai_provider') || 'openrouter';
const OPENROUTER_API_KEY = localStorage.getItem('openrouter_api_key') || '';
const OPENAI_API_KEY = localStorage.getItem('openai_api_key') || '';
const OLLAMA_BASE_URL = localStorage.getItem('ollama_url') || 'http://localhost:11434';
const OLLAMA_MODEL = localStorage.getItem('ollama_model') || 'llama3.2';

// In-memory conversation storage (for GitHub Pages deployment)
let conversations: Map<string, ConversationSummary[]> = new Map();
let messages: Map<string, Message[]> = new Map();
let conversationOrder: string[] = [];

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function saveToStorage() {
  try {
    localStorage.setItem('luma_conversations', JSON.stringify(conversationOrder));
    conversations.forEach((convs, key) => {
      localStorage.setItem(`luma_convs_${key}`, JSON.stringify(convs));
    });
    messages.forEach((msgs, key) => {
      localStorage.setItem(`luma_msgs_${key}`, JSON.stringify(msgs));
    });
  } catch (e) {
    console.warn('LocalStorage full, clearing old data...');
    localStorage.clear();
  }
}

function loadFromStorage() {
  try {
    const order = localStorage.getItem('luma_conversations');
    if (order) {
      conversationOrder = JSON.parse(order);
    }
    conversationOrder.forEach(id => {
      const convs = localStorage.getItem(`luma_convs_${id}`);
      const msgs = localStorage.getItem(`luma_msgs_${id}`);
      if (convs) conversations.set(id, JSON.parse(convs));
      if (msgs) messages.set(id, JSON.parse(msgs));
    });
  } catch (e) {
    console.error('Failed to load from storage:', e);
  }
}

// Initialize from storage
loadFromStorage();

export const api = {
  // Configuration
  setAIProvider(provider: string) {
    localStorage.setItem('ai_provider', provider);
  },
  
  setOpenRouterKey(key: string) {
    localStorage.setItem('openrouter_api_key', key);
  },
  
  setOpenAIKey(key: string) {
    localStorage.setItem('openai_api_key', key);
  },
  
  setOllamaURL(url: string) {
    localStorage.setItem('ollama_url', url);
  },
  
  setOllamaModel(model: string) {
    localStorage.setItem('ollama_model', model);
  },
  
  getConfig() {
    return {
      provider: AI_PROVIDER,
      openrouterKey: OPENROUTER_API_KEY ? '***' + OPENROUTER_API_KEY.slice(-4) : '',
      openaiKey: OPENAI_API_KEY ? '***' + OPENAI_API_KEY.slice(-4) : '',
      ollamaUrl: OLLAMA_BASE_URL,
      ollamaModel: OLLAMA_MODEL,
    };
  },

  // Health check (no backend needed anymore!)
  async health() {
    return { status: 'healthy', provider: AI_PROVIDER };
  },

  // Conversations (stored locally)
  async createConversation(title?: string): Promise<Conversation> {
    const id = generateId();
    const now = new Date().toISOString();
    const convTitle = title || `Chat ${new Date().toLocaleDateString('id-ID')}`;
    
    const conv: Conversation = {
      id,
      title: convTitle,
      created_at: now,
      updated_at: now,
      status: 'idle',
      messages: [],
    };
    
    const summary: ConversationSummary = {
      id,
      title: convTitle,
      created_at: now,
      updated_at: now,
      status: 'idle',
    };
    
    conversations.set(id, [summary]);
    messages.set(id, []);
    conversationOrder.unshift(id);
    saveToStorage();
    
    return conv;
  },

  async listConversations(): Promise<ConversationSummary[]> {
    const result: ConversationSummary[] = [];
    conversationOrder.forEach(id => {
      const convs = conversations.get(id);
      if (convs && convs.length > 0) {
        result.push(convs[0]);
      }
    });
    return result;
  },

  async getConversation(id: string): Promise<Conversation> {
    const msgs = messages.get(id) || [];
    const convs = conversations.get(id);
    const summary = convs?.[0];
    
    return {
      id,
      title: summary?.title || 'Chat',
      created_at: summary?.created_at || new Date().toISOString(),
      updated_at: summary?.updated_at || new Date().toISOString(),
      status: (summary?.status || 'idle') as 'idle' | 'running' | 'paused' | 'completed',
      messages: msgs,
    };
  },

  async deleteConversation(id: string): Promise<void> {
    conversations.delete(id);
    messages.delete(id);
    conversationOrder = conversationOrder.filter(c => c !== id);
    saveToStorage();
  },

  async sendMessage(
    conversationId: string,
    content: string,
    onEvent: (event: { type: string; data: unknown }) => void
  ): Promise<Message> {
    onEvent({ type: 'message_start', data: { id: generateId(), role: 'assistant' } });

    let fullContent = '';
    const assistantMsgId = generateId();

    try {
      if (AI_PROVIDER === 'openrouter') {
        if (!OPENROUTER_API_KEY) {
          throw new Error('OpenRouter API key belum diset. Klik ⚙️ untuk konfigurasi.');
        }

        // Get conversation history
        const history = messages.get(conversationId) || [];
        const historyMessages = history.map(m => ({ role: m.role, content: m.content }));

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.origin,
            'X-Title': 'LUMA AI',
          },
          body: JSON.stringify({
            model: 'google/gemma-2-9b-it:free', // FREE model!
            messages: [...historyMessages, { role: 'user', content }],
            stream: true,
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`OpenRouter Error: ${err}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;
              
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  fullContent += content;
                  onEvent({ type: 'content', data: content });
                }
              } catch {}
            }
          }
        }

      } else if (AI_PROVIDER === 'openai') {
        if (!OPENAI_API_KEY) {
          throw new Error('OpenAI API key belum diset. Klik ⚙️ untuk konfigurasi.');
        }

        const history = messages.get(conversationId) || [];
        const historyMessages = history.map(m => ({ role: m.role, content: m.content }));

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [...historyMessages, { role: 'user', content }],
            stream: true,
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`OpenAI Error: ${err}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;
              
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  fullContent += content;
                  onEvent({ type: 'content', data: content });
                }
              } catch {}
            }
          }
        }

      } else if (AI_PROVIDER === 'ollama') {
        const history = messages.get(conversationId) || [];
        const historyMessages = history.map(m => ({ role: m.role, content: m.content }));

        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages: [...historyMessages, { role: 'user', content }],
            stream: true,
          }),
        });

        if (!response.ok) {
          throw new Error('Tidak dapat terhubung ke Ollama. Pastikan Ollama berjalan.');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.trim()) {
              try {
                const parsed = JSON.parse(line);
                const content = parsed.message?.content;
                if (content) {
                  fullContent += content;
                  onEvent({ type: 'content', data: content });
                }
                if (parsed.done) break;
              } catch {}
            }
          }
        }
      }

      // Save messages
      const userMsg: Message = {
        id: generateId(),
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      };
      
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: fullContent,
        created_at: new Date().toISOString(),
      };
      
      const existing = messages.get(conversationId) || [];
      messages.set(conversationId, [...existing, userMsg, assistantMsg]);
      saveToStorage();

      onEvent({ type: 'message_end', data: { id: assistantMsgId } });
      return assistantMsg;

    } catch (error) {
      onEvent({ type: 'error', data: { error: (error as Error).message } });
      throw error;
    }
  },

  async stopConversation(_conversationId: string): Promise<void> {},
  async pauseConversation(_conversationId: string): Promise<void> {},
  async resumeConversation(_conversationId: string): Promise<void> {},
  async listFiles(_conversationId: string): Promise<FileInfo[]> { return []; },
};