"use client";

import { useEffect, useRef, useState } from "react";
import { Type, Image as ImageIcon, EyeOff, Tag, ChevronDown, Braces, Code2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { readGroupSettingsAction, saveGroupSettingsAction, deleteGroupAction } from "@/lib/actions/authoring";
import { SettingsShell, Row, TextField, ToggleField } from "./SettingsUI";

type Meta = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

// Group settings — edits a docs.json navigation group (rename, icon, hidden, tag, expanded,
// openapi/asyncapi). `group` is the current name; a rename updates the lookup key in place.
export function GroupSettings({
  org,
  site,
  branch,
  group,
  onClose,
  onSaved,
}: {
  org: string;
  site: string;
  branch: string;
  group: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const lookup = useRef(group); // the group's current name in docs.json (changes on rename)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    readGroupSettingsAction(org, site, branch, group).then((res) => setMeta("error" in res ? {} : res.settings));
    return () => void (timer.current && clearTimeout(timer.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (key: string, value: unknown) => {
    setMeta((prev) => {
      const next = { ...(prev ?? {}), [key]: value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const body: Meta = {
          group: str(next.group),
          icon: next.icon,
          hidden: next.hidden,
          tag: next.tag,
          expanded: next.expanded,
          openapi: next.openapi,
          asyncapi: next.asyncapi,
        };
        const res = await saveGroupSettingsAction(org, site, branch, lookup.current, body);
        if (!("error" in res)) {
          lookup.current = res.group; // track the (possibly renamed) group for subsequent saves
          onSaved();
        }
      }, 500);
      return next;
    });
  };

  const del = async () => {
    if (!window.confirm(`Delete the "${lookup.current}" group? Its pages stay; only the group is removed.`)) return;
    const res = await deleteGroupAction(org, site, branch, lookup.current);
    if ("error" in res) toast.error(res.error);
    else {
      toast.success("Group deleted");
      onSaved();
      onClose();
    }
  };

  if (!meta) {
    return (
      <SettingsShell title="Group settings" onClose={onClose}>
        <div className="pv-settings-loading">Loading…</div>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell
      title="Group settings"
      onClose={onClose}
      actions={
        <button type="button" aria-label="Delete group" className="pv-settings-iconbtn is-danger" onClick={del}>
          <Trash2 className="h-4 w-4" />
        </button>
      }
    >
      <Row icon={Type} label="Title">
        <TextField value={str(meta.group) || group} placeholder="Group title" onChange={(v) => patch("group", v)} />
      </Row>
      <Row icon={ImageIcon} label="Icon">
        <TextField value={str(meta.icon)} placeholder="Icon name (e.g. house)" onChange={(v) => patch("icon", v)} />
      </Row>
      <Row icon={EyeOff} label="Hidden">
        <ToggleField on={meta.hidden === true} onChange={(v) => patch("hidden", v)} onLabel="Yes" offLabel="No" />
      </Row>
      <Row icon={Tag} label="Tag">
        <TextField value={str(meta.tag)} placeholder="Badge label (e.g. Beta)" onChange={(v) => patch("tag", v)} />
      </Row>
      <Row icon={ChevronDown} label="Expanded">
        <ToggleField on={meta.expanded === true} onChange={(v) => patch("expanded", v)} onLabel="Yes" offLabel="No" />
      </Row>
      <Row icon={Braces} label="OpenAPI">
        <TextField
          value={str(meta.openapi)}
          placeholder="https://api.example.com/openapi.json"
          onChange={(v) => patch("openapi", v)}
        />
      </Row>
      <Row icon={Code2} label="AsyncAPI">
        <TextField
          value={str(meta.asyncapi)}
          placeholder="https://api.example.com/asyncapi.yaml"
          onChange={(v) => patch("asyncapi", v)}
        />
      </Row>
    </SettingsShell>
  );
}
