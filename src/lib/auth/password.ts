import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// Self-contained password hashing (scrypt). Format: "<salt-hex>:<key-hex>".
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${key}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(":");
  if (!salt || !keyHex) return false;
  const key = Buffer.from(keyHex, "hex");
  const test = scryptSync(password, salt, 64);
  return key.length === test.length && timingSafeEqual(key, test);
}
