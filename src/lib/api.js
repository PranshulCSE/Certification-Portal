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
  const cleanPath = String(path).replace(/^\/+/, '');
  return supabase.storage.from('event-assets').getPublicUrl(cleanPath).data.publicUrl;
};

export async function uploadAsset(eventId, file, name) {
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${eventId}/${name}-${Date.now()}.${ext}`.replace(/^\/+/, '');
  const { error } = await supabase.storage.from('event-assets').upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return path;
}

export async function uploadGlobalAsset(file, { name, category = 'logo', signerName = '', signerTitle = '' } = {}) {
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanCategory = ['logo', 'signature'].includes(category) ? category : 'other';
  const fileName = `${cleanCategory}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const path = `global/${cleanCategory}s/${fileName}`.replace(/^\/+/, '');

  const { error: uploadErr } = await supabase.storage.from('event-assets').upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
  });
  if (uploadErr) throw new Error(uploadErr.message);

  let width = null;
  let height = null;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    width = img.naturalWidth || img.width;
    height = img.naturalHeight || img.height;
    URL.revokeObjectURL(url);
  } catch {
    /* ignore dimension read error */
  }

  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes?.user?.id || null;

  const metadata = {};
  if (signerName) metadata.signer_name = signerName.trim();
  if (signerTitle) metadata.signer_title = signerTitle.trim();

  const row = {
    name: (name || file.name.replace(/\.[^/.]+$/, '')).trim(),
    category: cleanCategory,
    path,
    width,
    height,
    file_size: file.size || null,
    mime_type: file.type || null,
    metadata,
    created_by: userId,
  };

  const { data, error: insertErr } = await supabase.from('global_assets').insert(row).select().single();
  if (insertErr) {
    throw new Error(insertErr.message);
  }
  return data;
}

export async function fetchGlobalAssets(category = null) {
  let query = supabase.from('global_assets').select('*').order('created_at', { ascending: false });
  if (category && category !== 'all') {
    query = query.eq('category', category);
  }
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data || [];
}

export async function deleteGlobalAsset(id, path) {
  if (path) {
    await supabase.storage.from('event-assets').remove([path]).catch(() => {});
  }
  if (id) {
    const { error } = await supabase.from('global_assets').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
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
