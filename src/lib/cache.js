// In-memory cache for template assets and images
export const imageCache = new Map();

export function evictAssetCache(path) {
  if (!path) return;
  const cleanPath = String(path).replace(/^\/+/, '');
  imageCache.delete(cleanPath);
  imageCache.delete(path);
  // Also clear any cached URL keys that reference this path
  for (const key of imageCache.keys()) {
    if (key.includes(cleanPath)) {
      imageCache.delete(key);
    }
  }
}

export function clearAssetCache() {
  imageCache.clear();
}
