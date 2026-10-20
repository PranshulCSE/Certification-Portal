// Crypto-secure verification codes: XXXX-XXXX-XXXX, 32-symbol alphabet (no I, O, 0, 1) = 60 bits.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars -> no modulo bias with random bytes

export function generateCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i] % 32];
    if (i === 3 || i === 7) out += '-';
  }
  return out;
}

export const CODE_REGEX = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
