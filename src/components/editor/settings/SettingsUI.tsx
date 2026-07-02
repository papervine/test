"use client";

import { useState, type ReactNode } from "react";
import { X, Plus, type LucideIcon } from "lucide-react";

/** Right slide-over shell for the Page/Group settings panels. */
export function SettingsShell({
  title,
  actions,
  onClose,
  children,
}: {
  title: string;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="pv-settings-overlay" onClick={onClose} />
      <aside className="pv-settings db-portal" role="dialog" aria-label={title}>
        <header className="pv-settings-head">
          <span className="pv-settings-title">{title}</span>
          <div className="pv-settings-actions">
            {actions}
            <button type="button" aria-label="Close" className="pv-settings-iconbtn" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="pv-settings-body">{children}</div>
      </aside>
    </>
  );
}

/** A labelled settings row (icon + label on the left, control on the right). */
export function Row({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="pv-settings-row">
      <div className="pv-settings-rowlabel">
        <Icon className="h-4 w-4 opacity-70" />
        <span>{label}</span>
      </div>
      <div className="pv-settings-rowcontrol">{children}</div>
    </div>
  );
}

export function TextField({
  value,
  placeholder,
  onChange,
  disabled,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      className="pv-settings-input"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ToggleField({
  on,
  onChange,
  onLabel = "On",
  offLabel = "Off",
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="pv-settings-toggle"
    >
      <span className={`pv-toggle-track${on ? " is-on" : ""}`}>
        <span className="pv-toggle-thumb" />
      </span>
      <span className="pv-toggle-label">{on ? onLabel : offLabel}</span>
    </button>
  );
}

export function KeywordsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="pv-keywords">
      {value.map((k) => (
        <span key={k} className="pv-keyword">
          {k}
          <button type="button" aria-label={`Remove ${k}`} onClick={() => onChange(value.filter((x) => x !== k))}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {draft || value.length === 0 ? (
        <input
          className="pv-keyword-input"
          value={draft}
          placeholder="Add keyword"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      ) : (
        <button type="button" className="pv-keyword-add" onClick={() => setDraft(" ")}>
          <Plus className="h-3.5 w-3.5" /> Add keyword
        </button>
      )}
    </div>
  );
}

export function SelectField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select className="pv-settings-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
