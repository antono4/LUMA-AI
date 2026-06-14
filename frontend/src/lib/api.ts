import type { Conversation, ConversationSummary, Message, FileInfo } from '../types';

const API_BASE = '/api';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export const api = {
  // Health check
  async health() {
    const response = await fetch(`${API_BASE}/../health`);
    return handleResponse<{ status: string }>(response);
  },

  // Conversations
  async createConversation(title?: string): Promise<Conversation> {
    const response = await fetch(`${API_BASE}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    return handleResponse<Conversation>(response);
  },

  async listConversations(): Promise<ConversationSummary[]> {
    const response = await fetch(`${API_BASE}/conversations`);
    return handleResponse<ConversationSummary[]>(response);
  },

  async getConversation(id: string): Promise<Conversation> {
    const response = await fetch(`${API_BASE}/conversations/${id}`);
    return handleResponse<Conversation>(response);
  },

  async deleteConversation(id: string): Promise<void> {
    const response = await fetch(`${API_BASE}/conversations/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete conversation: ${response.statusText}`);
    }
  },

  async sendMessage(
    conversationId: string,
    content: string,
    onEvent: (event: { type: string; data: unknown }) => void
  ): Promise<Message> {
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let messageId = '';
    let fullContent = '';
    let finalMessage: Message | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('event:')) {
            const eventType = line.slice(6).trim();
            onEvent({ type: eventType, data: null });
          } else if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            try {
              const parsed = JSON.parse(data);
              
              if (parsed.id && !messageId) {
                messageId = parsed.id;
              }
              if (parsed.content) {
                fullContent += parsed.content;
                onEvent({ type: 'content', data: parsed.content });
              }
              if (parsed.error) {
                onEvent({ type: 'error', data: parsed.error });
              }
            } catch {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    finalMessage = {
      id: messageId,
      role: 'assistant',
      content: fullContent,
      created_at: new Date().toISOString(),
    };

    return finalMessage;
  },

  async stopConversation(conversationId: string): Promise<void> {
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/stop`,
      { method: 'POST' }
    );
    if (!response.ok) {
      throw new Error(`Failed to stop conversation: ${response.statusText}`);
    }
  },

  async pauseConversation(conversationId: string): Promise<void> {
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/pause`,
      { method: 'POST' }
    );
    if (!response.ok) {
      throw new Error(`Failed to pause conversation: ${response.statusText}`);
    }
  },

  async resumeConversation(conversationId: string): Promise<void> {
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/resume`,
      { method: 'POST' }
    );
    if (!response.ok) {
      throw new Error(`Failed to resume conversation: ${response.statusText}`);
    }
  },

  async listFiles(conversationId: string): Promise<FileInfo[]> {
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/files`
    );
    const data = await handleResponse<{ files: FileInfo[] }>(response);
    return data.files;
  },
};