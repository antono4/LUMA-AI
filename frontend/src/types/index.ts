export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_name?: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  status: 'idle' | 'running' | 'paused' | 'completed';
  messages: Message[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  status: string;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  modified: string;
}

export interface StreamEvent {
  event: string;
  data: string;
}