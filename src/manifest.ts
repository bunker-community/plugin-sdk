/* bunker-plugin.json dogrulamasi (bagimliliksiz; calisma ortami ve gelistirici araci ayni kodu kullanir) */
import { PERMISSIONS, type Permission, type PluginManifest, type PluginUi } from "./types.ts";

export const MANIFEST_FILE = "bunker-plugin.json";
/** 2-28 karakter: bot kimligi "BunkerPluginBot.<id>" en fazla 44 karakter olsun */
export const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,26}[a-z0-9])$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const SDK_RANGE_RE = /^\d+(?:\.\d+)?$/;

export type ManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] };

export function validateManifest(raw: unknown): ManifestResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["manifest bir JSON nesnesi olmalı"] };
  const o = raw as Record<string, unknown>;
  const str = (k: string, max: number, required = true) => {
    const v = o[k];
    if (v === undefined && !required) return undefined;
    if (typeof v !== "string" || !v.trim()) { errors.push(`${k}: metin olmalı`); return undefined; }
    if (v.length > max) errors.push(`${k}: en fazla ${max} karakter`);
    return v.trim();
  };
  const id = str("id", 28);
  if (id && !ID_RE.test(id)) errors.push("id: küçük harf, rakam ve tire (2-28 karakter, tireyle başlayıp bitmez)");
  const name = str("name", 40);
  const version = str("version", 32);
  if (version && !VERSION_RE.test(version)) errors.push("version: x.y.z biçiminde olmalı");
  const description = str("description", 300, false);
  const details = str("details", 4000, false);
  const author = str("author", 80, false);
  const main = str("main", 120, false);
  if (main && (main.startsWith("/") || main.includes("..") || main.includes("\\"))) errors.push("main: plugin klasörünün içinde göreli yol olmalı");
  const sdk = str("sdk", 10);
  if (sdk && !SDK_RANGE_RE.test(sdk)) errors.push('sdk: "0" ya da "0.1" gibi ana sürüm');
  const perms = o.permissions;
  let permissions: Permission[] = [];
  if (!Array.isArray(perms)) errors.push("permissions: dizi olmalı (boş olabilir)");
  else {
    for (const p of perms) if (!PERMISSIONS.includes(p as Permission)) errors.push(`permissions: bilinmeyen izin "${String(p)}"`);
    permissions = [...new Set(perms as Permission[])];
  }
  let ui: PluginUi | undefined;
  if (o.ui !== undefined) {
    const u = o.ui as Record<string, unknown>;
    if (!u || typeof u !== "object" || Array.isArray(u)) errors.push("ui: nesne olmalı");
    else {
      const title = typeof u.title === "string" && u.title.trim() ? u.title.trim().slice(0, 40) : "";
      const page = typeof u.page === "string" ? u.page.trim() : "";
      const icon = u.icon === undefined ? undefined : typeof u.icon === "string" && /^[a-zA-Z]{1,24}$/.test(u.icon) ? u.icon : null;
      if (!title) errors.push("ui.title: metin olmalı");
      if (!page || page.startsWith("/") || page.includes("..") || page.includes("\\") || !/\.html?$/i.test(page)) errors.push("ui.page: plugin klasöründe .html dosyası olmalı");
      if (u.scope !== "voice" && u.scope !== "guild") errors.push('ui.scope: "voice" ya da "guild"');
      if (icon === null) errors.push("ui.icon: harflerden oluşan ikon adı");
      if (title && page && icon !== null) ui = { title, page, scope: u.scope as PluginUi["scope"], ...(icon ? { icon } : {}) };
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, manifest: { id: id!, name: name!, version: version!, description, ...(details ? { details } : {}), author, main: main ?? "src/index.ts", sdk: sdk!, permissions, ...(ui ? { ui } : {}) } };
}

/** Manifest'in istedigi SDK surumu bu SDK ile uyumlu mu ("0.1" -> 0.1.x; "1" -> 1.x). 0.x'te ara surum de kirici sayilir. */
export function sdkCompatible(want: string, have: string): boolean {
  const [wMaj, wMin] = want.split(".").map(Number);
  const [hMaj, hMin] = have.split(".").map(Number);
  if (wMaj !== hMaj) return false;
  if (wMaj === 0) return wMin === undefined ? true : wMin === hMin;
  return wMin === undefined || hMin >= wMin;
}
