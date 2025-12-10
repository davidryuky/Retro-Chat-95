
// Utility to convert string to ArrayBuffer
const str2ab = (str: string): ArrayBuffer => {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
};

// Utility to convert ArrayBuffer to string (for checking key validity mostly)
const ab2str = (buf: ArrayBuffer): string => {
  return String.fromCharCode.apply(null, Array.from(new Uint8Array(buf)));
};

// 1. Import the Key Material (the password user types)
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

// 2. Derive the AES-GCM Key from the password
const getKey = (keyMaterial: CryptoKey, salt: Uint8Array = new Uint8Array(16)): Promise<CryptoKey> => {
  // In a real app, salt should be random and shared. 
  // For this simplified P2P demo without a complex handshake, 
  // we will use a static salt derived from the room ID or a fixed value for simplicity 
  // to ensure both parties generate the same key from the same password.
  // We'll use a fixed salt for this demo to ensure connectability with just the password.
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
    console.error("Decryption failed - likely wrong key", e);
    return "?? [Decryption Failed] ??";
  }
};

export const generateRandomKey = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const generateRandomName = (): string => {
  const adjectives = ['Rad', 'Tubular', 'Gnarly', 'Neon', 'Cyber', 'Pixel', 'Mega', 'Hyper'];
  const nouns = ['Surfer', 'Hacker', 'Glitch', 'Wave', 'Drive', 'Net', 'Bot', 'User'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 99);
  return `${adj}${noun}${num}`;
};

// --- Connection Code Helpers ---

const SEPARATOR = '$';

export const encodeConnectionCode = (peerId: string, key: string): string => {
  try {
    const raw = `${peerId}${SEPARATOR}${key}`;
    return btoa(raw); // Base64 encode
  } catch (e) {
    console.error("Failed to encode connection code", e);
    return "";
  }
};

export const decodeConnectionCode = (code: string): { peerId: string, key: string } | null => {
  try {
    // If user pasted a full URL, try to extract the 'join' param
    let cleanCode = code;
    if (code.includes('?join=')) {
        const urlParams = new URLSearchParams(code.split('?')[1]);
        cleanCode = urlParams.get('join') || code;
    } else if (code.includes('http')) {
        // Fallback for simple paste
        try {
            const url = new URL(code);
            cleanCode = url.searchParams.get('join') || code;
        } catch {}
    }

    const raw = atob(cleanCode);
    const parts = raw.split(SEPARATOR);
    if (parts.length === 2) {
      return { peerId: parts[0], key: parts[1] };
    }
    return null;
  } catch (e) {
    console.error("Failed to decode connection code", e);
    return null;
  }
};
