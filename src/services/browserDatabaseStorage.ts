import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';

const FORMAT = 'gewu.browser-cache.gzip.v1';
const COMPRESSION_THRESHOLD = 256 * 1024;

// The complete multi-subject taxonomy has both authority rows and UI tags.
// Keep those rows intact while fitting multiple identity caches in Web Storage.
export function encodeBrowserDatabase(value: unknown): string {
  const json = JSON.stringify(value);
  if (json.length < COMPRESSION_THRESHOLD) return json;
  const bytes = gzipSync(strToU8(json));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  const encoded = JSON.stringify({ format: FORMAT, payload: btoa(binary) });
  return encoded.length < json.length ? encoded : json;
}

export function decodeBrowserDatabase(stored: string): any {
  const value = JSON.parse(stored);
  if (value?.format !== FORMAT) return value;
  if (typeof value.payload !== 'string') throw new Error('BROWSER_DATABASE_CACHE_INVALID');
  const binary = atob(value.payload);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return JSON.parse(strFromU8(gunzipSync(bytes)));
}
