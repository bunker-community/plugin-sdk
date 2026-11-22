/* bunker-plugin.json validation (dependency-free; the runtime and the developer tool use the same code) */
import { PERMISSIONS, type Permission, type PluginManifest, type PluginUi } from "./types.ts";

export const MANIFEST_FILE = "bunker-plugin.json";
/** 2-28 characters: the bot identity "BunkerPluginBot.<id>" stays at most 44 characters */
export const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,26}[a-z0-9])$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const SDK_RANGE_RE = /^\d+(?:\.\d+)?$/;

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
      if (title && page && icon !== null) ui = { title, page, scope: u.scope as PluginUi["scope"], ...(icon ? { icon } : {}) };
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, manifest: { id: id!, name: name!, version: version!, description, ...(details ? { details } : {}), author, main: main ?? "src/index.ts", sdk: sdk!, permissions, ...(ui ? { ui } : {}) } };
}

/** Is the SDK version the manifest asks for compatible with this SDK ("0.1" -> 0.1.x; "1" -> 1.x). In 0.x a minor version counts as breaking too. */
export function sdkCompatible(want: string, have: string): boolean {
  const [wMaj, wMin] = want.split(".").map(Number);
  const [hMaj, hMin] = have.split(".").map(Number);
  if (wMaj !== hMaj) return false;
  if (wMaj === 0) return wMin === undefined ? true : wMin === hMin;
  return wMin === undefined || hMin >= wMin;
}
