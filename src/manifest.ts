/* bunker-plugin.json validation (dependency-free; the runtime and the developer tool use the same code) */
import { PERMISSIONS, type Permission, type PluginManifest, type PluginUi, type SettingField } from "./types.ts";

export const MANIFEST_FILE = "bunker-plugin.json";
/** 2-28 characters: the bot identity "BunkerPluginBot.<id>" stays at most 44 characters */
export const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,26}[a-z0-9])$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const SDK_RANGE_RE = /^\d+(?:\.\d+)?$/;
/** An https origin for ui.embed, optionally with a "*." subdomain wildcard: https://www.youtube.com, https://*.vimeo.com */
const EMBED_RE = /^https:\/\/(\*\.)?([a-z0-9-]+\.)+[a-z]{2,24}(:\d{2,5})?$/i;

/** A host for manifest "network": api.example.com or *.example.com */
const HOST_RE = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,24}$/i;
const SETTING_TYPES = new Set(["text", "number", "boolean", "select", "channel", "role"]);

/** manifest "settings" (null: invalid, the errors are pushed) */
function checkSettings(raw: unknown, errors: string[]): SettingField[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 20) { errors.push("settings: an array of at most 20 fields"); return undefined; }
  const out: SettingField[] = [];
  const seen = new Set<string>();
  const txt = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  for (const [i, f] of raw.entries()) {
    const o = (f ?? {}) as Record<string, unknown>;
    const at = `settings[${i}]`;
    const key = typeof o.key === "string" && /^[a-zA-Z0-9_]{1,32}$/.test(o.key) ? o.key : "";
    if (!key) { errors.push(`${at}.key: letters, digits, _ (1-32)`); continue; }
    if (seen.has(key)) { errors.push(`${at}.key: "${key}" is used twice`); continue; }
    seen.add(key);
    if (!SETTING_TYPES.has(String(o.type))) { errors.push(`${at}.type: text, number, boolean, select, channel or role`); continue; }
    const label = txt(o.label, 60);
    if (!label) { errors.push(`${at}.label: must be text`); continue; }
    const field: SettingField = { key, type: o.type as SettingField["type"], label };
    const description = txt(o.description, 200);
    if (description) field.description = description;
    if (o.tr && typeof o.tr === "object") {
      const t = o.tr as Record<string, unknown>;
      const tr: NonNullable<SettingField["tr"]> = {};
      if (txt(t.label, 60)) tr.label = txt(t.label, 60);
      if (txt(t.description, 200)) tr.description = txt(t.description, 200);
      if (t.options && typeof t.options === "object") tr.options = Object.fromEntries(Object.entries(t.options as Record<string, unknown>).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v).slice(0, 60)]));
      field.tr = tr;
    }
    if (field.type === "select") {
      const opts = Array.isArray(o.options) ? o.options : [];
      field.options = opts.filter((x) => x && typeof (x as Record<string, unknown>).value === "string").slice(0, 50)
        .map((x) => ({ value: String((x as Record<string, unknown>).value).slice(0, 60), label: txt((x as Record<string, unknown>).label, 60) ?? String((x as Record<string, unknown>).value) }));
      if (!field.options.length) errors.push(`${at}.options: a select needs [{ value, label }]`);
    }
    if (field.type === "number") {
      if (typeof o.min === "number") field.min = o.min;
      if (typeof o.max === "number") field.max = o.max;
    }
    if (field.type === "text") field.maxLength = Math.max(1, Math.min(1000, Number(o.maxLength) || 200));
    if (field.type === "channel" && o.voice === true) field.voice = true;
    if (o.default !== undefined && o.default !== null) {
      const d = o.default;
      const ok = field.type === "boolean" ? typeof d === "boolean" : field.type === "number" ? typeof d === "number" : typeof d === "string";
      if (!ok) errors.push(`${at}.default: wrong type for ${field.type}`);
      else field.default = d as SettingField["default"];
    }
    out.push(field);
  }
  return out;
}

export type ManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] };

export function validateManifest(raw: unknown): ManifestResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["manifest must be a JSON object"] };
  const o = raw as Record<string, unknown>;
  const str = (k: string, max: number, required = true) => {
    const v = o[k];
    if (v === undefined && !required) return undefined;
    if (typeof v !== "string" || !v.trim()) { errors.push(`${k}: must be text`); return undefined; }
    if (v.length > max) errors.push(`${k}: at most ${max} characters`);
    return v.trim();
  };
  const id = str("id", 28);
  if (id && !ID_RE.test(id)) errors.push("id: lowercase letters, digits and dashes (2-28 characters, not starting or ending with a dash)");
  const name = str("name", 40);
  const version = str("version", 32);
  if (version && !VERSION_RE.test(version)) errors.push("version: must be x.y.z");
  const description = str("description", 300, false);
  const details = str("details", 4000, false);
  const author = str("author", 80, false);
  const main = str("main", 120, false);
  if (main && (main.startsWith("/") || main.includes("..") || main.includes("\\"))) errors.push("main: must be a relative path inside the plugin folder");
  const sdk = str("sdk", 10);
  if (sdk && !SDK_RANGE_RE.test(sdk)) errors.push('sdk: a major version like "0" or "0.1"');
  const perms = o.permissions;
  let permissions: Permission[] = [];
  if (!Array.isArray(perms)) errors.push("permissions: must be an array (can be empty)");
  else {
    for (const p of perms) if (!PERMISSIONS.includes(p as Permission)) errors.push(`permissions: unknown permission "${String(p)}"`);
    permissions = [...new Set(perms as Permission[])];
  }
  let ui: PluginUi | undefined;
  if (o.ui !== undefined) {
    const u = o.ui as Record<string, unknown>;
    if (!u || typeof u !== "object" || Array.isArray(u)) errors.push("ui: must be an object");
    else {
      const title = typeof u.title === "string" && u.title.trim() ? u.title.trim().slice(0, 40) : "";
      const page = typeof u.page === "string" ? u.page.trim() : "";
      const icon = u.icon === undefined ? undefined : typeof u.icon === "string" && /^[a-zA-Z]{1,24}$/.test(u.icon) ? u.icon : null;
      if (!title) errors.push("ui.title: must be text");
      if (!page || page.startsWith("/") || page.includes("..") || page.includes("\\") || !/\.html?$/i.test(page)) errors.push("ui.page: must be an .html file in the plugin folder");
      if (u.scope !== "voice" && u.scope !== "guild") errors.push('ui.scope: "voice" or "guild"');
      if (icon === null) errors.push("ui.icon: an icon name made of letters");
      if (u.layout !== undefined && u.layout !== "window" && u.layout !== "stage") errors.push('ui.layout: "window" or "stage"');
      let embed: string[] | undefined;
      if (u.embed !== undefined) {
        if (!Array.isArray(u.embed) || u.embed.length > 16) errors.push("ui.embed: an array of at most 16 https origins");
        else {
          embed = [];
          for (const e of u.embed) {
            if (typeof e === "string" && EMBED_RE.test(e)) embed.push(e.toLowerCase());
            else errors.push(`ui.embed: "${String(e)}" is not an https origin (like "https://www.youtube.com" or "https://*.vimeo.com")`);
          }
          embed = [...new Set(embed)];
          if (embed.length && !permissions.includes("ui.embed")) errors.push('ui.embed: needs the "ui.embed" permission');
        }
      }
      if (title && page && icon !== null) ui = { title, page, scope: u.scope as PluginUi["scope"], ...(icon ? { icon } : {}), ...(u.layout === "stage" ? { layout: "stage" as const } : {}), ...(embed?.length ? { embed } : {}) };
    }
  }
  let network: string[] | undefined;
  if (o.network !== undefined) {
    if (!Array.isArray(o.network) || o.network.length > 16) errors.push("network: an array of at most 16 hosts");
    else {
      network = [];
      for (const h of o.network) {
        if (typeof h === "string" && HOST_RE.test(h)) network.push(h.toLowerCase());
        else errors.push(`network: "${String(h)}" is not a host name (like "api.example.com" or "*.example.com")`);
      }
      network = [...new Set(network)];
      if (network.length && !permissions.includes("net.fetch")) errors.push('network: needs the "net.fetch" permission');
    }
  }
  if (permissions.includes("net.fetch") && !network?.length) errors.push('permissions: "net.fetch" needs the hosts in "network"');
  const settings = checkSettings(o.settings, errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      id: id!, name: name!, version: version!, description, ...(details ? { details } : {}), author, main: main ?? "src/index.ts", sdk: sdk!, permissions,
      ...(ui ? { ui } : {}), ...(network?.length ? { network } : {}), ...(settings?.length ? { settings } : {}),
    },
  };
}

/** Is the SDK version the manifest asks for compatible with this SDK ("0.1" -> 0.1.x; "1" -> 1.x). In 0.x a minor version counts as breaking too. */
export function sdkCompatible(want: string, have: string): boolean {
  const [wMaj, wMin] = want.split(".").map(Number);
  const [hMaj, hMin] = have.split(".").map(Number);
  if (wMaj !== hMaj) return false;
  if (wMaj === 0) return wMin === undefined ? true : wMin === hMin;
  return wMin === undefined || hMin >= wMin;
}
