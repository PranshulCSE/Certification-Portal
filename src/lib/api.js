import { supabase } from './supabase';

export async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export function audit(action, entity, entityId, meta = {}) {
  // fire-and-forget; auditing must never block the UI
  supabase.rpc('log_audit', { p_action: action, p_entity: entity, p_entity_id: entityId ? String(entityId) : null, p_meta: meta }).then(() => {}, () => {});
}

export async function callFn(name, body = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export const assetUrl = (path) => {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:') || path.startsWith('data:')) {
    return path;
  }
  return supabase.storage.from('event-assets').getPublicUrl(path).data.publicUrl;
};

export async function uploadAsset(eventId, file, name) {
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${eventId}/${name}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('event-assets').upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return path;
}

// Supabase returns at most 1000 rows per request; this pages through all of them.
export async function fetchAll(build) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  // build() must return a fresh query each call
  for (;;) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
