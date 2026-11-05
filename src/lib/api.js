import { supabase } from './supabase';
import { evictAssetCache } from './render';

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
  const cleanPath = path ? String(path).replace(/^\/+/, '') : null;

  // 1. Evict from memory image cache immediately
  if (path) evictAssetCache(path);
  if (cleanPath) evictAssetCache(cleanPath);

  // 2. Remove file from Supabase storage
  if (cleanPath || path) {
    try {
      const targets = [cleanPath, path].filter(Boolean);
      await supabase.storage.from('event-assets').remove(targets);
    } catch (storageErr) {
      console.warn('Storage removal warning:', storageErr);
    }
  }

  // 3. Check if record exists in global_assets table
  let rowExists = false;
  if (id) {
    const { data } = await supabase.from('global_assets').select('id').eq('id', id).maybeSingle();
    if (data) rowExists = true;
  } else if (cleanPath) {
    const { data } = await supabase
      .from('global_assets')
      .select('id')
      .or(`path.eq.${cleanPath},path.eq.${path}`)
      .maybeSingle();
    if (data) rowExists = true;
  }

  // If already not in database, we are done
  if (!rowExists) {
    return true;
  }

  // 4. Delete row from global_assets table and verify with select()
  let rowsDeleted = 0;
  if (id) {
    const { data, error } = await supabase.from('global_assets').delete().eq('id', id).select();
    if (error) throw new Error(error.message);
    if (data && data.length > 0) rowsDeleted += data.length;
  }

  if (rowsDeleted === 0 && cleanPath) {
    const { data, error } = await supabase
      .from('global_assets')
      .delete()
      .or(`path.eq.${cleanPath},path.eq.${path}`)
      .select();
    if (error) throw new Error(error.message);
    if (data && data.length > 0) rowsDeleted += data.length;
  }

  // If the record exists in DB but 0 rows were deleted, RLS policy blocked the deletion
  if (rowsDeleted === 0) {
    throw new Error(
      'Database permission denied: Supabase Row-Level Security (RLS) blocked the deletion of this asset. Please run migration 004 in your Supabase SQL Editor to allow deleting assets.'
    );
  }

  return true;
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
