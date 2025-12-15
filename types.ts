
export interface Message {
  id: string;
  sender: string;
  content: string;
  timestamp: number;
  isSystem?: boolean;
  status?: 'sent' | 'read'; // Added status for checkmarks
}

export interface ChatSession {
  roomId: string; // The Host's Peer ID
  encryptionKey: string;
  connected: boolean;
  username: string;
  sessionCode?: string; // The short code displayed to user
}

export enum AppScreen {
  LOGIN,
  SETUP,
  CHAT
}

export interface EncryptedPayload {
  iv: number[]; // Array.from(Uint8Array) for serialization
  data: number[]; // Array.from(Uint8Array) for serialization
}

export interface NetworkMessage {
  type: 'CHAT' | 'SYSTEM' | 'JOIN' | 'LEAVE' | 'TYPING' | 'READ_RECEIPT';
  payload?: EncryptedPayload;
  sender?: string; // Plaintext sender name
  messageId?: string; // ID for referencing messages (read receipts)
}
