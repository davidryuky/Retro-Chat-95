
export interface Message {
  id: string;
  sender: string;
  content: string;
  timestamp: number;
  isSystem?: boolean;
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
  type: 'CHAT' | 'SYSTEM' | 'JOIN' | 'LEAVE';
  payload?: EncryptedPayload;
  sender?: string; // Plaintext sender name (metadata is usually public in simple P2P, only content is encrypted)
}
