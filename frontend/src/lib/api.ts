import type { Conversation, ConversationSummary, Message, FileInfo } from '../types';
import { demoApi, isDemoMode } from './demo';

const API_BASE = '/api';
const HEALTH_URL = '/health';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/** One decoded SSE frame: its event name and its concatenated data lines. */
type SseFrame = { event: string; data: string };

/**
 * Incremental SSE parser.
 *
 * Network chunks split wherever TCP feels like it, so a `data:` line can arrive
 * in two pieces. We keep a buffer, only consume complete lines, and reassemble
 * each frame from its `data:` lines before handing it to the caller.
 * https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 */
class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];

    let index: number;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);

      if (line === '') {
        const frame = this.emit();
        if (frame) frames.push(frame);
        continue;
      }
      if (line.startsWith(':')) continue; // comment / keep-alive ping

      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);

      if (field === 'event') this.event = value;
      else if (field === 'data') this.data.push(value);
    }

    return frames;
  }

  private emit(): SseFrame | null {
    if (this.data.length === 0 && this.event === '') return null;
    const frame = { event: this.event || 'message', data: this.data.join('\n') };
    this.event = '';
    this.data = [];
    return frame;
  }
}

const SSE_EVENTS = {
  message_start: 'message_start',
  content: 'content',
  error: 'error',
  message_end: 'message_end',
} as const;

export const api = {
  // Health check
  async health() {
    if (isDemoMode()) return { status: 'demo' };
    const response = await fetch(HEALTH_URL);
    return handleResponse<{ status: string }>(response);
  },

  // Conversations
  async createConversation(title?: string): Promise<Conversation> {
    if (isDemoMode()) return demoApi.createConversation(title);
    const response = await fetch(`${API_BASE}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    return handleResponse<Conversation>(response);
  },

  async listConversations(): Promise<ConversationSummary[]> {
    if (isDemoMode()) return demoApi.listConversations();
    const response = await fetch(`${API_BASE}/conversations`);
    return handleResponse<ConversationSummary[]>(response);
  },

  async getConversation(id: string): Promise<Conversation> {
    if (isDemoMode()) return demoApi.getConversation(id);
    const response = await fetch(`${API_BASE}/conversations/${id}`);
    return handleResponse<Conversation>(response);
  },

  async deleteConversation(id: string): Promise<void> {
    if (isDemoMode()) return demoApi.deleteConversation(id);
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
    if (isDemoMode()) return demoApi.sendMessage(conversationId, content, onEvent);

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
    const parser = new SseParser();
    let messageId = '';
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          if (frame.data === '') continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(frame.data);
          } catch {
            // A malformed frame should not abort the whole reply.
            continue;
          }

          if (frame.event === SSE_EVENTS.message_start) {
            if (typeof parsed.id === 'string') messageId = parsed.id;
            onEvent({ type: 'message_start', data: parsed });
          } else if (frame.event === SSE_EVENTS.content) {
            const text = typeof parsed.content === 'string' ? parsed.content : '';
            if (text) {
              fullContent = fullContent ? `${fullContent}\n\n${text}` : text;
              onEvent({ type: 'content', data: text });
            }
          } else if (frame.event === SSE_EVENTS.error) {
            const message =
              typeof parsed.error === 'string' ? parsed.error : 'Unknown error';
            onEvent({ type: 'error', data: message });
          } else if (frame.event === SSE_EVENTS.message_end) {
            if (typeof parsed.id === 'string') messageId = parsed.id;
            onEvent({ type: 'message_end', data: parsed });
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      id: messageId,
      role: 'assistant',
      content: fullContent,
      created_at: new Date().toISOString(),
    };
  },

  async stopConversation(conversationId: string): Promise<void> {
    if (isDemoMode()) return demoApi.stopConversation(conversationId);
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/stop`,
      { method: 'POST' }
    );
    if (!response.ok) {
      throw new Error(`Failed to stop conversation: ${response.statusText}`);
    }
  },

  async pauseConversation(conversationId: string): Promise<void> {
    if (isDemoMode()) return demoApi.pauseConversation(conversationId);
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/pause`,
      { method: 'POST' }
    );
    if (!response.ok) {
      throw new Error(`Failed to pause conversation: ${response.statusText}`);
    }
  },

  async resumeConversation(conversationId: string): Promise<void> {
    if (isDemoMode()) return demoApi.resumeConversation(conversationId);
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/resume`,
      { method: 'POST' }
    );
    if (!response.ok) {
      throw new Error(`Failed to resume conversation: ${response.statusText}`);
    }
  },

  async listFiles(conversationId: string): Promise<FileInfo[]> {
    if (isDemoMode()) return demoApi.listFiles(conversationId);
    const response = await fetch(
      `${API_BASE}/conversations/${conversationId}/files`
    );
    const data = await handleResponse<{ files: FileInfo[] }>(response);
    return data.files;
  },
};