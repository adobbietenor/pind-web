import * as SecureStore from "expo-secure-store";

// Keychain-backed storage for the Supabase session on iOS.
// SecureStore warns above 2048 bytes per value and a session can be larger, so
// values are split into chunks: "<key>.n" holds the count, "<key>.0"… the parts.
const CHUNK = 1800;

async function getItem(key: string): Promise<string | null> {
  const count = await SecureStore.getItemAsync(`${key}.n`);
  if (count === null) return null;
  const parts: string[] = [];
  for (let i = 0; i < Number(count); i++) {
    const part = await SecureStore.getItemAsync(`${key}.${i}`);
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join("");
}

async function removeItem(key: string): Promise<void> {
  const count = await SecureStore.getItemAsync(`${key}.n`);
  if (count === null) return;
  for (let i = 0; i < Number(count); i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
  await SecureStore.deleteItemAsync(`${key}.n`);
}

async function setItem(key: string, value: string): Promise<void> {
  await removeItem(key);
  const count = Math.ceil(value.length / CHUNK);
  for (let i = 0; i < count; i++) {
    await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  await SecureStore.setItemAsync(`${key}.n`, String(count));
}

export const secureStorage = { getItem, setItem, removeItem };
