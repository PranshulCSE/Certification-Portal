import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  FileImage,
  Filter,
  Image as ImageIcon,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
  X,
  AlertCircle,
  Database,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { assetUrl, deleteGlobalAsset, fetchGlobalAssets, uploadGlobalAsset } from '../lib/api';
import { Field, PageLoader, Spinner, useToast } from '../components/ui';

export default function GlobalStore() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'logo', 'signature'
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  // Upload modal state
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('logo');
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setMigrationNeeded(false);
    try {
      const data = await fetchGlobalAssets();
      setAssets(data);
    } catch (err) {
      if (err.message?.includes('global_assets') || err.code === '42P01') {
        setMigrationNeeded(true);
      } else {
        toast.error(`Failed to load global assets: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
      toast.error('Please upload a PNG, JPG, or WebP image.');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error('File size cannot exceed 10 MB.');
      return;
    }
    setFile(f);
    setFilePreview(URL.createObjectURL(f));
    if (!name) {
      setName(f.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' '));
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error('Please choose an image file.');
      return;
    }
    if (!name.trim()) {
      toast.error('Please provide a name for this asset.');
      return;
    }

    setUploading(true);
    try {
      await uploadGlobalAsset(file, {
        name,
        category,
        signerName,
        signerTitle,
      });
      toast.ok(`${category === 'logo' ? 'Logo' : 'Signature'} added to Global Store!`);
      closeModal();
      loadAssets();
    } catch (err) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (asset) => {
    try {
      await deleteGlobalAsset(asset.id, asset.path);
      toast.ok('Asset removed from Global Store.');
      setDeleteConfirmId(null);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    } catch (err) {
      toast.error(`Failed to delete: ${err.message}`);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setFile(null);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview('');
    setName('');
    setCategory('logo');
    setSignerName('');
    setSignerTitle('');
  };

  const copyPath = (path, id) => {
    navigator.clipboard.writeText(path);
    setCopiedId(id);
    toast.ok('Asset path copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredAssets = assets.filter((a) => {
    const matchCategory = filter === 'all' || a.category === filter;
    const matchSearch =
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.metadata?.signer_name?.toLowerCase().includes(search.toLowerCase()) ||
      a.metadata?.signer_title?.toLowerCase().includes(search.toLowerCase());
    return matchCategory && matchSearch;
  });

  const logoCount = assets.filter((a) => a.category === 'logo').length;
  const sigCount = assets.filter((a) => a.category === 'signature').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold">Global Asset Store</h1>
            <span className="badge badge-accent">Shared Library</span>
          </div>
          <p className="mt-1 text-sm text-slate2">
            Store official logos and authorized signatures once. Reusable across all events by all issuers, saving storage and keeping branding consistent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={loadAssets} title="Refresh assets">
            <RefreshCw className="h-4 w-4" />
          </button>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
              <Plus className="h-4 w-4" />
              Add to Global Store
            </button>
          )}
        </div>
      </div>

      {/* Migration Notice if table not created */}
      {migrationNeeded && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-900 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-6 w-6 shrink-0 text-amber-600" />
            <div className="space-y-2">
              <h3 className="font-semibold text-amber-950">Database Setup Required for Global Store</h3>
              <p className="text-sm">
                The <code>global_assets</code> table does not exist in your Supabase database yet. Run the migration script in{' '}
                <code>supabase/migrations/003_global_assets.sql</code> inside your Supabase Dashboard SQL Editor to enable shared assets.
              </p>
              <div className="flex gap-2">
                <button
                  className="btn btn-sm border-amber-400 bg-white text-amber-900 hover:bg-amber-100"
                  onClick={() => {
                    navigator.clipboard.writeText(`create table if not exists public.global_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('logo', 'signature', 'other')),
  path text not null unique,
  width int,
  height int,
  file_size int,
  mime_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.global_assets enable row level security;
create policy global_assets_select on public.global_assets for select to authenticated using (true);
create policy global_assets_public_select on public.global_assets for select to anon using (true);
create policy global_assets_insert on public.global_assets for insert to authenticated with check (public.is_admin());
create policy global_assets_update on public.global_assets for update to authenticated using (public.is_admin());
create policy global_assets_delete on public.global_assets for delete to authenticated using (public.is_admin());`);
                    toast.ok('SQL copied to clipboard!');
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy SQL Query
                </button>
                <button className="btn btn-sm btn-ghost" onClick={loadAssets}>
                  Check Again
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-white p-1">
          <button
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${filter === 'all' ? 'bg-ink text-white' : 'text-slate2 hover:text-ink'}`}
            onClick={() => setFilter('all')}
          >
            All ({assets.length})
          </button>
          <button
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${filter === 'logo' ? 'bg-ink text-white' : 'text-slate2 hover:text-ink'}`}
            onClick={() => setFilter('logo')}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Logos ({logoCount})
          </button>
          <button
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${filter === 'signature' ? 'bg-ink text-white' : 'text-slate2 hover:text-ink'}`}
            onClick={() => setFilter('signature')}
          >
            <PenLine className="h-3.5 w-3.5" />
            Signatures ({sigCount})
          </button>
        </div>

        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            className="input !py-1.5 !pl-9 text-sm"
            placeholder="Search assets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-ink" onClick={() => setSearch('')}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Asset Cards Grid */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="mr-2" />
          Loading Global Store...
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <Database className="mb-3 h-12 w-12 text-slate-300" />
          <h3 className="font-semibold text-ink">No assets found</h3>
          <p className="mt-1 max-w-sm text-sm text-slate2">
            {search
              ? 'No assets match your search term.'
              : filter !== 'all'
              ? `No ${filter}s in the store yet.`
              : 'The Global Store is currently empty. Admins can upload official logos and authorized signatures to share with all issuers.'}
          </p>
          {isAdmin && !search && (
            <button className="btn btn-primary mt-4" onClick={() => setModalOpen(true)}>
              <Plus className="h-4 w-4" />
              Upload First Asset
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filteredAssets.map((asset) => {
            const url = assetUrl(asset.path);
            const isDeleting = deleteConfirmId === asset.id;
            return (
              <div key={asset.id} className="card group flex flex-col overflow-hidden transition hover:shadow-md">
                {/* Image Preview Box with checkerboard */}
                <div
                  className="relative flex h-40 w-full items-center justify-center border-b border-line p-4"
                  style={{
                    backgroundColor: '#fafafa',
                    backgroundImage:
                      'linear-gradient(45deg, #f0f0f0 25%, transparent 25%), linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f0f0f0 75%), linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)',
                    backgroundSize: '16px 16px',
                    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                  }}
                >
                  <img
                    src={url}
                    alt={asset.name}
                    className="max-h-full max-w-full object-contain transition duration-200 group-hover:scale-105"
                    loading="lazy"
                  />
                  <span
                    className={`absolute left-2.5 top-2.5 rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
                      asset.category === 'logo' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {asset.category}
                  </span>
                </div>

                {/* Details */}
                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <h3 className="font-semibold text-ink line-clamp-1" title={asset.name}>
                      {asset.name}
                    </h3>
                    {asset.category === 'signature' && (asset.metadata?.signer_name || asset.metadata?.signer_title) && (
                      <p className="mt-0.5 text-xs text-slate-600 line-clamp-1">
                        {asset.metadata.signer_name}
                        {asset.metadata.signer_title ? ` (${asset.metadata.signer_title})` : ''}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      {asset.width && asset.height && <span>{asset.width}×{asset.height}px</span>}
                      {asset.file_size && <span>• {Math.round(asset.file_size / 1024)} KB</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-3">
                    <button
                      className="btn btn-ghost btn-xs flex items-center gap-1"
                      onClick={() => copyPath(asset.path, asset.id)}
                      title="Copy asset path"
                    >
                      {copiedId === asset.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                      <span className="text-xs">{copiedId === asset.id ? 'Copied' : 'Copy Path'}</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost btn-xs p-1"
                        title="Open image in new tab"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>

                      {isAdmin && (
                        <>
                          {isDeleting ? (
                            <div className="flex items-center gap-1">
                              <button
                                className="btn btn-danger btn-xs px-2"
                                onClick={() => handleDelete(asset)}
                              >
                                Confirm
                              </button>
                              <button
                                className="btn btn-ghost btn-xs px-1"
                                onClick={() => setDeleteConfirmId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              className="btn btn-ghost btn-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 p-1"
                              onClick={() => setDeleteConfirmId(asset.id)}
                              title="Delete from Global Store"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Modal Dialog */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 shadow-xl animate-in fade-in duration-200">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Add to Global Store</h2>
              <button className="btn btn-ghost btn-sm p-1" onClick={closeModal}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleUpload} className="space-y-4">
              {/* Category radio */}
              <div>
                <label className="label">Asset Category</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-semibold transition ${
                      category === 'logo' ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-line hover:bg-mist'
                    }`}
                    onClick={() => setCategory('logo')}
                  >
                    <ImageIcon className="h-4 w-4" />
                    Logo / Emblem
                  </button>
                  <button
                    type="button"
                    className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-semibold transition ${
                      category === 'signature' ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-line hover:bg-mist'
                    }`}
                    onClick={() => setCategory('signature')}
                  >
                    <PenLine className="h-4 w-4" />
                    Signature
                  </button>
                </div>
              </div>

              {/* File upload drag drop */}
              <div>
                <label className="label">Image File (PNG, JPG, WebP)</label>
                <div
                  className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-line p-5 text-center transition hover:border-amber-400 hover:bg-amber-50/20 cursor-pointer"
                  onClick={() => document.getElementById('global-asset-file-input').click()}
                >
                  {filePreview ? (
                    <div className="space-y-2">
                      <img src={filePreview} alt="Preview" className="mx-auto max-h-32 object-contain" />
                      <p className="text-xs text-slate-600">{file?.name} ({Math.round(file?.size / 1024)} KB)</p>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFile(null);
                          setFilePreview('');
                        }}
                      >
                        Change file
                      </button>
                    </div>
                  ) : (
                    <>
                      <UploadCloud className="mb-2 h-8 w-8 text-slate-400" />
                      <p className="text-sm font-medium text-ink">Click or drag image here</p>
                      <p className="mt-0.5 text-xs text-slate-400">Transparent PNG recommended for signatures & logos</p>
                    </>
                  )}
                </div>
                <input
                  id="global-asset-file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={handleFileChange}
                />
              </div>

              {/* Name */}
              <Field label="Asset Name" hint="Descriptive label (e.g. 'Geeta University Official Crest')">
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. University Seal"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </Field>

              {/* If signature, optional signer details */}
              {category === 'signature' && (
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-mist/60 p-3">
                  <Field label="Signer Name" hint="Auto-fills on certificate">
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. Dr. R. K. Sharma"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                    />
                  </Field>
                  <Field label="Designation / Title" hint="Auto-fills on certificate">
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. Vice Chancellor"
                      value={signerTitle}
                      onChange={(e) => setSignerTitle(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {/* Submit buttons */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" className="btn btn-ghost" onClick={closeModal} disabled={uploading}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
                  {uploading ? <Spinner /> : <Plus className="h-4 w-4" />}
                  Save to Global Store
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
