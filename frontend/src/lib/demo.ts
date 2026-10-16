import type { Conversation, ConversationSummary, Message, FileInfo } from '../types';

/**
 * Offline demo backend.
 *
 * The real UI needs the FastAPI service, which a static host cannot run. When
 * the app is served without a reachable API (GitHub Pages), this module answers
 * the same calls in-browser so the interface stays usable and the layout is
 * demonstrable. Replies are canned; no model is contacted.
 */

declare global {
  interface Window {
    __LUMA_DEMO__?: boolean;
  }
}

let probed = false;
let demo = false;

/** True when the real API is unavailable and we should serve canned data. */
export function isDemoMode(): boolean {
  return demo;
}

/**
 * Decide once, at startup, whether the API is reachable.
 *
 * A static build sets `VITE_DEMO_MODE=true` so demo mode is known up front and
 * no failing request is made. Otherwise we probe `/api/health` and fall back to
 * demo mode on any failure (offline, 404, CORS, proxy error).
 */
export async function detectDemoMode(): Promise<boolean> {
  if (probed) return demo;
  probed = true;

  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    demo = true;
    window.__LUMA_DEMO__ = true;
    return demo;
  }

  try {
    const response = await fetch('/health', { method: 'GET' });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    demo = data?.status !== 'healthy';
  } catch {
    demo = true;
  }
  if (demo) window.__LUMA_DEMO__ = true;
  return demo;
}

const uid = () => `demo-${Math.random().toString(36).slice(2, 10)}`;

const now = () => new Date().toISOString();

const store = new Map<string, Conversation>();

/** Hand copies to callers so React never holds a reference to store state. */
const clone = (c: Conversation): Conversation => ({
  ...c,
  messages: c.messages.map((m) => ({ ...m })),
});

function seed(): Conversation {
  const id = uid();
  return {
    id,
    title: 'Contoh Percakapan',
    created_at: now(),
    updated_at: now(),
    status: 'idle',
    messages: [
      {
        id: uid(),
        role: 'user',
        content: 'Halo, apa yang bisa kamu bantu?',
        created_at: now(),
      },
      {
        id: uid(),
        role: 'assistant',
        content:
          'Halo! Saya LUMA AI. Saya bisa membantu menulis dan men-debug kode, ' +
          'menjelaskan konsep teknis, atau merancang sebuah API.\n\n' +
          'Catatan: ini pratinjau statis. Balasan di sini contoh, bukan dari model.',
        created_at: now(),
      },
    ],
  };
}

/** Canned replies chosen by keyword so the demo reacts plausibly. */
function replyFor(prompt: string): string {
  const text = prompt.toLowerCase();
  if (text.includes('python') || text.includes('fungsi')) {
    return [
      'Berikut contoh fungsi Python:',
      '',
      '```python',
      'def fibonacci(n: int) -> list[int]:',
      '    seq = [0, 1]',
      '    while len(seq) < n:',
      '        seq.append(seq[-1] + seq[-2])',
      '    return seq[:n]',
      '```',
      '',
      'Fungsi ini mengembalikan n bilangan Fibonacci pertama.',
    ].join('\n');
  }
  if (text.includes('api')) {
    return [
      'Kerangka endpoint FastAPI:',
      '',
      '```python',
      '@app.get("/items/{item_id}")',
      'async def read_item(item_id: int):',
      '    return {"item_id": item_id}',
      '```',
      '',
      'Tambahkan validasi lewat anotasi tipe seperti di atas.',
    ].join('\n');
  }
  if (text.includes('javascript') || text.includes('debug')) {
    return [
      'Beberapa hal yang biasa saya periksa saat men-debug JavaScript:',
      '',
      '1. Buka panel Console untuk melihat error pertama.',
      '2. Pastikan nilai tidak `undefined` sebelum dipakai.',
      '3. Periksa apakah closure menangkap state yang sudah usang.',
    ].join('\n');
  }
  if (text.includes('ai') || text.includes('jelaskan')) {
    return [
      'Secara singkat, model bahasa memprediksi token berikutnya berdasarkan konteks.',
      '',
      '- Token adalah potongan kata, bukan kata utuh.',
      '- Pelatihan menyesuaikan bobot agar prediksi makin tepat.',
      '- Inferensi menjalankan model untuk menghasilkan teks baru.',
    ].join('\n');
  }
  return [
    'Ini pratinjau statis LUMA AI, jadi balasan saya masih contoh.',
    '',
    'Untuk mencoba model sungguhan, jalankan backend secara lokal lalu buka ' +
      'antarmuka ini. Detail caranya ada di README repositori.',
  ].join('\n');
}

function streamReply(
  text: string,
  onEvent: (event: { type: string; data: unknown }) => void
): Promise<void> {
  const messageId = uid();
  return new Promise((resolve) => {
    onEvent({ type: 'message_start', data: { id: messageId, role: 'assistant' } });

    // The backend delivers whole content blocks, not tokens; mirror that so the
    // UI's block joining behaves the same in both modes.
    const blocks = text.split('\n\n');
    let index = 0;
    const step = () => {
      if (index >= blocks.length) {
        onEvent({ type: 'message_end', data: { id: messageId } });
        resolve();
        return;
      }
      onEvent({ type: 'content', data: blocks[index] });
      index += 1;
      setTimeout(step, 220);
    };
    step();
  });
}

export const demoApi = {
  async createConversation(title?: string): Promise<Conversation> {
    const conversation: Conversation = {
      id: uid(),
      title: title?.trim() || 'New Conversation',
      created_at: now(),
      updated_at: now(),
      status: 'idle',
      messages: [],
    };
    store.set(conversation.id, conversation);
    return clone(conversation);
  },

  async listConversations(): Promise<ConversationSummary[]> {
    if (store.size === 0) {
      const seeded = seed();
      store.set(seeded.id, seeded);
    }
    return [...store.values()].map((c) => ({
      id: c.id,
      title: c.title,
      created_at: c.created_at,
      updated_at: c.updated_at,
      status: c.status,
    }));
  },

  async getConversation(id: string): Promise<Conversation> {
    const found = store.get(id);
    if (found) return clone(found);
    const fallback = seed();
    fallback.id = id;
    store.set(id, fallback);
    return clone(fallback);
  },

  async deleteConversation(id: string): Promise<void> {
    store.delete(id);
  },

  async sendMessage(
    conversationId: string,
    content: string,
    onEvent: (event: { type: string; data: unknown }) => void
  ): Promise<Message> {
    let conversation = store.get(conversationId);
    if (!conversation) {
      const created = seed();
      created.id = conversationId;
      store.set(conversationId, created);
      conversation = created;
    }
    conversation.messages.push({
      id: uid(),
      role: 'user',
      content,
      created_at: now(),
    });
    const reply = replyFor(content);
    await streamReply(reply, onEvent);
    const message: Message = {
      id: uid(),
      role: 'assistant',
      content: reply,
      created_at: now(),
    };
    conversation.messages.push(message);
    conversation.updated_at = now();
    return { ...message };
  },

  async stopConversation(_id: string): Promise<void> {},
  async pauseConversation(_id: string): Promise<void> {},
  async resumeConversation(_id: string): Promise<void> {},

  async listFiles(_conversationId: string): Promise<FileInfo[]> {
    return [];
  },
};
