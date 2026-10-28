import React, { useState } from 'react';
import { Award, Check, Sparkles, X, LayoutTemplate, ShieldCheck, Flame, BookOpen, Trophy, GraduationCap } from 'lucide-react';
import { CERTIFICATE_PRESETS } from '../lib/presets';

const CATEGORY_ICONS = {
  Academic: GraduationCap,
  Competition: Trophy,
  Training: BookOpen,
  Sports: Flame,
  Appreciation: Award,
};

export default function PresetPickerModal({ open, onClose, onSelectPreset }) {
  const [selectedId, setSelectedId] = useState(CERTIFICATE_PRESETS[0].id);
  const [confirming, setConfirming] = useState(false);

  if (!open) return null;

  const activePreset = CERTIFICATE_PRESETS.find((p) => p.id === selectedId) || CERTIFICATE_PRESETS[0];

  const handleApply = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    onSelectPreset(activePreset);
    setConfirming(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-saffron-50 text-saffron-600">
              <LayoutTemplate className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold">Certificate Template Presets</h2>
              <p className="text-xs text-slate2">Choose from ready-to-use institutional and competition styles</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body: Split layout */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[280px_1fr]">
          {/* Preset List */}
          <div className="overflow-y-auto border-r border-line bg-slate-50/50 p-3">
            <label className="mb-2 block px-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Select Preset ({CERTIFICATE_PRESETS.length})
            </label>
            <div className="space-y-1.5">
              {CERTIFICATE_PRESETS.map((p) => {
                const isSelected = p.id === selectedId;
                const Icon = CATEGORY_ICONS[p.category] || Award;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedId(p.id);
                      setConfirming(false);
                    }}
                    className={`flex w-full items-start gap-3 rounded-xl p-3 text-left transition ${
                      isSelected
                        ? 'border border-saffron-300 bg-white shadow-xs ring-1 ring-saffron-400'
                        : 'border border-transparent hover:bg-slate-100/80 text-slate-700'
                    }`}
                  >
                    <div
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${p.badgeColor}20`, color: p.badgeColor }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-xs font-bold leading-snug">{p.title}</span>
                        {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-saffron-600" />}
                      </div>
                      <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                        {p.category}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preset Details & Preview Card */}
          <div className="flex flex-col overflow-y-auto p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="badge badge-info mb-1 text-[11px]">{activePreset.category} Template</span>
                <h3 className="font-display text-xl font-bold">{activePreset.title}</h3>
                <p className="mt-1 text-xs text-slate2">{activePreset.description}</p>
              </div>
            </div>

            {/* Visual Card Mockup */}
            <div className="relative mb-5 overflow-hidden rounded-xl border border-line bg-gradient-to-br from-white via-slate-50 to-slate-100 p-6 shadow-sm">
              <div
                className="absolute inset-x-0 top-0 h-1.5"
                style={{ backgroundColor: activePreset.badgeColor }}
              />

              <div className="space-y-3 text-center">
                <div
                  className="mx-auto flex h-12 w-12 items-center justify-center rounded-full shadow-inner"
                  style={{
                    backgroundColor: `${activePreset.badgeColor}15`,
                    border: `2px solid ${activePreset.badgeColor}`,
                    color: activePreset.badgeColor,
                  }}
                >
                  <Sparkles className="h-6 w-6" />
                </div>

                <div className="space-y-1">
                  <p
                    className="font-display text-sm font-extrabold tracking-widest uppercase"
                    style={{ color: activePreset.accentColor }}
                  >
                    {activePreset.config.fields[0]?.text || 'Certificate'}
                  </p>
                  <p className="text-[11px] text-slate-400">Awarded to</p>
                  <p className="font-display text-lg font-bold text-slate-900">Aarav Sharma</p>
                  <p className="mx-auto max-w-md text-[11px] text-slate-500 line-clamp-2">
                    {activePreset.config.fields[4]?.text || activePreset.description}
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-center gap-6 border-t border-line/60 pt-3 text-[10px] text-slate-400">
                  <span>Standard {activePreset.width}×{activePreset.height}px</span>
                  <span>•</span>
                  <span>{activePreset.config.badges?.length || 0} Vector Badges</span>
                  <span>•</span>
                  <span>{activePreset.config.signatories?.length || 0} Signatories</span>
                </div>
              </div>
            </div>

            {/* Inclusions summary */}
            <div className="mt-auto rounded-xl bg-slate-50 p-4 border border-line">
              <h4 className="mb-2 text-xs font-bold text-slate-700 uppercase tracking-wider">Features included:</h4>
              <ul className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                <li className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Pre-configured typography & hierarchy
                </li>
                <li className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Vector badges & gold foil seals
                </li>
                <li className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Automatic participant variable tokens
                </li>
                <li className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Pre-positioned verification QR code
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line bg-slate-50 px-6 py-4">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>

          <div className="flex items-center gap-3">
            {confirming && (
              <p className="text-xs text-amber-700 font-medium">
                Applying will replace current template layout. Continue?
              </p>
            )}
            <button
              className={`btn ${confirming ? 'btn-danger' : 'btn-accent'}`}
              onClick={handleApply}
            >
              {confirming ? 'Confirm & Apply Preset' : 'Apply this Template'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
