import React, { useEffect, useState } from 'react';
import {
  Check,
  ExternalLink,
  Image as ImageIcon,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  UploadCloud,
  X,
  Database,
} from 'lucide-react';
import { assetUrl, fetchGlobalAssets, uploadGlobalAsset } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Spinner, useToast } from './ui';

export default function GlobalAssetPickerModal({
  open,
  onClose,
  onSelect,
  initialCategory = 'all', // 'logo', 'signature', or 'all'
  title = 'Choose from Global Store',
}) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState(initialCategory || 'all');
  const [search, setSearch] = useState('');
  const [uploadMode, setUploadMode] = useState(false);

  // Quick upload state inside picker
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadPreview, setUploadPreview] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [uploadCat, setUploadCat] = useState(initialCategory === 'signature' ? 'signature' : 'logo');
  const [uploadSigner, setUploadSigner] = useState('');
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) {
      setFilter(initialCategory || 'all');
      setUploadCat(initialCategory === 'signature' ? 'signature' : 'logo');
      loadAssets();
    }
  }, [open, initialCategory]);

  const loadAssets = async () => {
    setLoading(true);
    try {
      const data = await fetchGlobalAssets();
      setAssets(data);
    } catch (err) {
      console.warn('Global assets fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const filteredAssets = assets.filter((a) => {
    const matchCat = filter === 'all' || a.category === filter;
    const matchSearch =
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.metadata?.signer_name?.toLowerCase().includes(search.toLowerCase()) ||
      a.metadata?.signer_title?.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const handleQuickUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile) return toast.error('Please pick an image.');
    if (!uploadName.trim()) return toast.error('Please enter a name.');

    setUploading(true);
    try {
      const created = await uploadGlobalAsset(uploadFile, {
        name: uploadName,
        category: uploadCat,
        signerName: uploadSigner,
        signerTitle: uploadTitle,
      });
      toast.ok('Added to Global Store!');
      setUploadMode(false);
      setUploadFile(null);
      setUploadPreview('');
      setUploadName('');
      setUploadSigner('');
      setUploadTitle('');
      await loadAssets();
      // Auto-select the newly uploaded asset
      if (created) onSelect(created);
    } catch (err) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="card flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden p-0 shadow-2xl animate-in fade-in duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base font-bold text-ink">{title}</h2>
            <span className="badge badge-accent text-[11px]">Reusable Assets</span>
          </div>
          <button className="btn btn-ghost btn-sm p-1" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {uploadMode ? (
          /* Quick Upload Form */
          <form onSubmit={handleQuickUpload} className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Add New Asset to Global Store</h3>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setUploadMode(false)}
              >
                Back to library
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-semibold ${
                  uploadCat === 'logo' ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-line'
                }`}
                onClick={() => setUploadCat('logo')}
              >
                <ImageIcon className="h-3.5 w-3.5" /> Logo / Emblem
              </button>
              <button
                type="button"
                className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-semibold ${
                  uploadCat === 'signature' ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-line'
                }`}
                onClick={() => setUploadCat('signature')}
              >
                <PenLine className="h-3.5 w-3.5" /> Signature
              </button>
            </div>

            <div
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-line p-4 text-center cursor-pointer hover:border-amber-400"
              onClick={() => document.getElementById('quick-asset-file-input').click()}
            >
              {uploadPreview ? (
                <div className="space-y-1">
                  <img src={uploadPreview} alt="Preview" className="mx-auto max-h-24 object-contain" />
                  <p className="text-xs text-slate-500">{uploadFile?.name}</p>
                </div>
              ) : (
                <>
                  <UploadCloud className="mb-1 h-6 w-6 text-slate-400" />
                  <p className="text-xs font-medium">Click to select image (PNG, JPG, WebP)</p>
                </>
              )}
            </div>
            <input
              id="quick-asset-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploadFile(f);
                setUploadPreview(URL.createObjectURL(f));
                if (!uploadName) setUploadName(f.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' '));
              }}
            />

            <Field label="Asset Name">
              <input
                className="input"
                placeholder="e.g. University Crest or Dean Signature"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                required
              />
            </Field>

            {uploadCat === 'signature' && (
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-mist p-2.5">
                <Field label="Signer Name">
                  <input
                    className="input text-xs"
                    placeholder="e.g. Dr. A. K. Verma"
                    value={uploadSigner}
                    onChange={(e) => setUploadSigner(e.target.value)}
                  />
                </Field>
                <Field label="Designation">
                  <input
                    className="input text-xs"
                    placeholder="e.g. Registrar"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                  />
                </Field>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUploadMode(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={uploading || !uploadFile}>
                {uploading ? <Spinner /> : <Plus className="h-4 w-4" />} Upload & Select
              </button>
            </div>
          </form>
        ) : (
          /* Asset Browser */
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-mist/40 px-5 py-2.5">
              <div className="flex items-center gap-1 rounded-md border border-line bg-white p-0.5">
                <button
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${filter === 'all' ? 'bg-ink text-white' : 'text-slate-600'}`}
                  onClick={() => setFilter('all')}
                >
                  All
                </button>
                <button
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${filter === 'logo' ? 'bg-ink text-white' : 'text-slate-600'}`}
                  onClick={() => setFilter('logo')}
                >
                  Logos
                </button>
                <button
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${filter === 'signature' ? 'bg-ink text-white' : 'text-slate-600'}`}
                  onClick={() => setFilter('signature')}
                >
                  Signatures
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    className="input !h-8 !py-1 !pl-8 text-xs w-44"
                    placeholder="Search library..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {isAdmin && (
                  <button
                    className="btn btn-primary btn-xs flex items-center gap-1"
                    onClick={() => setUploadMode(true)}
                  >
                    <Plus className="h-3.5 w-3.5" /> Upload New
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 min-h-[300px] max-h-[55vh]">
              {loading ? (
                <div className="flex h-48 items-center justify-center text-slate-400 text-sm">
                  <Spinner className="mr-2" /> Loading library...
                </div>
              ) : filteredAssets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Database className="mb-2 h-10 w-10 text-slate-300" />
                  <p className="text-sm font-semibold text-ink">No matching assets found</p>
                  <p className="mt-1 max-w-xs text-xs text-slate2">
                    {search ? 'Try adjusting your search.' : 'No assets in this category yet. Admins can upload shared logos and signatures.'}
                  </p>
                  {isAdmin && (
                    <button className="btn btn-primary btn-sm mt-3" onClick={() => setUploadMode(true)}>
                      <Plus className="h-3.5 w-3.5" /> Upload to Global Store
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {filteredAssets.map((asset) => {
                    const url = assetUrl(asset.path);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => onSelect(asset)}
                        className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-white text-left transition hover:border-amber-500 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        <div
                          className="flex h-28 w-full items-center justify-center border-b border-line/60 p-3"
                          style={{
                            backgroundColor: '#fafafa',
                            backgroundImage:
                              'linear-gradient(45deg, #f0f0f0 25%, transparent 25%), linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f0f0f0 75%), linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)',
                            backgroundSize: '12px 12px',
                            backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
                          }}
                        >
                          <img
                            src={url}
                            alt={asset.name}
                            className="max-h-full max-w-full object-contain transition duration-150 group-hover:scale-105"
                            loading="lazy"
                          />
                          <span
                            className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              asset.category === 'logo' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {asset.category}
                          </span>
                        </div>
                        <div className="p-2.5">
                          <p className="font-semibold text-xs text-ink line-clamp-1 group-hover:text-amber-700">
                            {asset.name}
                          </p>
                          {asset.category === 'signature' && (asset.metadata?.signer_name || asset.metadata?.signer_title) && (
                            <p className="mt-0.5 text-[11px] text-slate-500 line-clamp-1">
                              {asset.metadata.signer_name || asset.metadata.signer_title}
                            </p>
                          )}
                          <p className="mt-1 text-[10px] text-slate-400">
                            {asset.width && asset.height ? `${asset.width}×${asset.height}px` : ''}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line bg-mist/30 px-5 py-2.5 text-xs text-slate2">
          <span>Click any asset to insert it directly onto your template</span>
          <button className="btn btn-ghost btn-xs" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
