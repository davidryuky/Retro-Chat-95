
// Utility to convert string to ArrayBuffer
const str2ab = (str: string): ArrayBuffer => {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
};

// Utility to convert ArrayBuffer to string
const ab2str = (buf: ArrayBuffer): string => {
  return String.fromCharCode.apply(null, Array.from(new Uint8Array(buf)));
};

// 1. Import the Key Material
const getKeyMaterial = (password: string): Promise<CryptoKey> => {
  const enc = new TextEncoder();
  return window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
};

// 2. Derive the AES-GCM Key
const getKey = (keyMaterial: CryptoKey, salt: Uint8Array = new Uint8Array(16)): Promise<CryptoKey> => {
  // Fixed salt for P2P simplicity without handshake
  const fixedSalt = new TextEncoder().encode("RETRO_CHAT_FIXED_SALT_V1"); 

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fixedSalt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
};

export const encryptMessage = async (text: string, password: string): Promise<{ iv: number[]; data: number[] }> => {
  try {
    const keyMaterial = await getKeyMaterial(password);
    const key = await getKey(keyMaterial);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encodedText = new TextEncoder().encode(text);

    const encryptedContent = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      encodedText
    );

    return {
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encryptedContent)),
    };
  } catch (e) {
    console.error("Encryption failed", e);
    throw e;
  }
};

export const decryptMessage = async (payload: { iv: number[]; data: number[] }, password: string): Promise<string> => {
  try {
    const keyMaterial = await getKeyMaterial(password);
    const key = await getKey(keyMaterial);
    const iv = new Uint8Array(payload.iv);
    const data = new Uint8Array(payload.data);

    const decryptedContent = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      data
    );

    return new TextDecoder().decode(decryptedContent);
  } catch (e) {
    console.error("Decryption failed", e);
    return "?? [Decryption Failed] ??";
  }
};

export const generateRandomName = (): string => {
  const adjectives = ['Rad', 'Tubular', 'Gnarly', 'Neon', 'Cyber', 'Pixel', 'Mega', 'Hyper'];
  const nouns = ['Surfer', 'Hacker', 'Glitch', 'Wave', 'Drive', 'Net', 'Bot', 'User'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 99);
  return `${adj}${noun}${num}`;
};

// --- SHORT CODE LOGIC ---

const ID_LENGTH = 6;
const KEY_LENGTH = 6;
const PEER_PREFIX = 'rc95-'; // Namespace to avoid collisions on public PeerServer

// Generates a 12-char alphanumeric code (6 for ID, 6 for Key)
export const generateSessionCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // No ambiguous chars (I, l, 1, O, 0)
  let result = '';
  const totalLength = ID_LENGTH + KEY_LENGTH;
  for (let i = 0; i < totalLength; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Parses the 12-char code into PeerID and Key
export const parseSessionCode = (code: string): { peerId: string, key: string, rawCode: string } | null => {
  try {
    // 1. Clean the code (remove URL params, spaces, etc)
    let clean = code.trim();
    
    // Handle URL pastes
    if (clean.includes('join=')) {
        const urlParams = new URLSearchParams(clean.split('?')[1]);
        clean = urlParams.get('join') || clean;
    } else if (clean.includes('http')) {
        try {
            const url = new URL(clean);
            clean = url.searchParams.get('join') || clean;
        } catch {}
    }

    // Remove any non-alphanumeric chars usually found in these codes if user typed them manually
    clean = clean.replace(/[^a-zA-Z0-9]/g, '');

    if (clean.length < (ID_LENGTH + KEY_LENGTH)) {
        return null;
    }

    const idPart = clean.substring(0, ID_LENGTH);
    const keyPart = clean.substring(ID_LENGTH, ID_LENGTH + KEY_LENGTH);

    return {
        peerId: `${PEER_PREFIX}${idPart}`,
        key: keyPart,
        rawCode: clean.substring(0, ID_LENGTH + KEY_LENGTH)
    };
  } catch (e) {
    return null;
  }
};
