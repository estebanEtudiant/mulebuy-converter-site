import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Mulebuy Manager – Pro
 * Single-file React app — production-ready structure in one file for easy drop-in.
 *
 * Highlights:
 * - Converter Weidian/Taobao → Mulebuy (ref configurable) with validation
 * - Product Lists (Wishlist, To Buy, Ordered, Received, Archived) + custom tags
 * - Sorting (date, title, shop_type, price), filtering (search + tags + list + status)
 * - Bulk select (delete, move list, add tag), keyboard shortcuts
 * - Quick QC: add links, inline previews for direct image URLs, local image paste/drag
 * - Detail drawer to edit fields (title, size, price, seller, notes, rating, tags)
 * - Settings modal: default ref, default list, compact mode, data export/import
 * - LocalStorage persistence with schema version + migration (from v1)
 * - Clean, dark UI (Tailwind). Vite + Tailwind v4 friendly.
 */

// ---------------------------- Types & Constants ----------------------------
const SCHEMA_VERSION = 2;
const LS = {
  products: "mulebuy.products.v2",
  settings: "mulebuy.settings.v2",
  history: "mulebuy.history.v2",
  // older keys we migrate from
  legacySaved: "mulebuy.saved.v1",
  legacyHistory: "mulebuy.history.v1",
};

const LISTS = ["Wishlist", "To Buy", "Ordered", "Received", "Archived"];

const SORTS = [
  { id: "created_at_desc", label: "Plus récent" },
  { id: "created_at_asc", label: "Plus ancien" },
  { id: "title_asc", label: "Titre A→Z" },
  { id: "title_desc", label: "Titre Z→A" },
  { id: "price_asc", label: "Prix ↑" },
  { id: "price_desc", label: "Prix ↓" },
  { id: "shop_type", label: "Shop type" },
];

const DEFAULT_SETTINGS = {
  defaultRef: "200084174",
  defaultList: "Wishlist",
  compactCards: false,
};

// ---------------------------- Utils ---------------------------------------
function uid() {
  return crypto.randomUUID?.() || Math.random().toString(36).slice(2);
}

function parseShopUrl(raw) {
  const s = raw?.trim();
  if (!s) throw new Error("URL manquante.");
  let url;
  try { url = new URL(s); } catch { throw new Error("URL invalide."); }
  const host = url.hostname;
  const q = new URLSearchParams(url.search);
  if (host.includes("weidian.com")) {
    const itemID = q.get("itemID");
    if (!itemID) throw new Error("itemID manquant pour Weidian.");
    return { shop_type: "weidian", id: itemID };
  }
  if (host.includes("taobao.com")) {
    const id = q.get("id");
    if (!id) throw new Error("id manquant pour Taobao.");
    return { shop_type: "taobao", id };
  }
  throw new Error("Domaine non supporté (weidian.com ou taobao.com).");
}

function toMulebuy({ shop_type, id, ref }) {
  const r = (ref || DEFAULT_SETTINGS.defaultRef).trim();
  return `https://mulebuy.com/product/?shop_type=${shop_type}&id=${id}&ref=${r}`;
}

function looksLikeImageUrl(u) {
  try {
    const url = new URL(u);
    const ext = url.pathname.toLowerCase();
    const okExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"].some(e => ext.endsWith(e));
    const hosts = ["i.imgur.com", "imgur.com", "catbox.moe", "files.catbox.moe", "postimg.cc", "i.ibb.co", "cdn.discordapp.com", "images.weserv.nl"];
    return okExt || hosts.some(h => url.hostname.endsWith(h));
  } catch { return false; }
}

function currency(n) {
  if (n == null || n === "") return "—";
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(num);
}

function classNames(...xs) { return xs.filter(Boolean).join(" "); }

// ---------------------------- Storage & Migration -------------------------
function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function migrateIfNeeded() {
  const products = loadJSON(LS.products, null);
  const settings = loadJSON(LS.settings, null) ?? DEFAULT_SETTINGS;
  const history = loadJSON(LS.history, null) ?? [];
  if (products) return { products, settings, history };

  // Try migrate v1 saved structure -> products v2
  const legacy = loadJSON(LS.legacySaved, null);
  const legacyHistory = loadJSON(LS.legacyHistory, []) || [];
  if (Array.isArray(legacy)) {
    const migrated = legacy.map(x => ({
      uid: x.uid || uid(),
      created_at: x.created_at || new Date().toISOString(),
      list: DEFAULT_SETTINGS.defaultList,
      shop_type: x.shop_type,
      id: x.id,
      ref: x.ref || DEFAULT_SETTINGS.defaultRef,
      mulebuy_url: x.mulebuy_url || toMulebuy({ shop_type: x.shop_type, id: x.id, ref: x.ref }),
      title: x.title || "",
      seller: "",
      size: "",
      price: "",
      rating: 0,
      notes: x.notes || "",
      tags: x.tags || [],
      qc_links: x.qc_links || [],
      images: x.images || [],
      _v: SCHEMA_VERSION,
    }));
    saveJSON(LS.products, migrated);
    saveJSON(LS.history, legacyHistory);
    return { products: migrated, settings: DEFAULT_SETTINGS, history: legacyHistory };
  }
  // Fresh start
  const fresh = [];
  saveJSON(LS.products, fresh);
  saveJSON(LS.settings, DEFAULT_SETTINGS);
  saveJSON(LS.history, []);
  return { products: fresh, settings: DEFAULT_SETTINGS, history: [] };
}

// ---------------------------- App ----------------------------------------
export default function App() {
  const boot = useMemo(() => migrateIfNeeded(), []);
  const [products, setProducts] = useState(boot.products);
  const [settings, setSettings] = useState(boot.settings);
  const [history, setHistory] = useState(boot.history);

  const [tab, setTab] = useState("manage"); // manage | lists | settings
  const [search, setSearch] = useState("");
  const [activeList, setActiveList] = useState(settings.defaultList || "Wishlist");
  const [sortId, setSortId] = useState("created_at_desc");
  const [showDrawer, setShowDrawer] = useState(false);
  const [editing, setEditing] = useState(null); // product
  const [selection, setSelection] = useState(new Set());

  useEffect(() => saveJSON(LS.products, products), [products]);
  useEffect(() => saveJSON(LS.settings, settings), [settings]);
  useEffect(() => saveJSON(LS.history, history), [history]);

  // ---------------- Converter state
  const [inputUrl, setInputUrl] = useState("");
  const [ref, setRef] = useState(settings.defaultRef || DEFAULT_SETTINGS.defaultRef);
  const [conv, setConv] = useState(null);
  const [convErr, setConvErr] = useState("");

  function handleConvert() {
    setConv(null); setConvErr("");
    try {
      const parsed = parseShopUrl(inputUrl);
      const url = toMulebuy({ ...parsed, ref });
      const now = new Date().toISOString();
      setConv({ url, ...parsed, ref });
      const h = { id: uid(), ts: now, input: inputUrl, ...parsed, ref, out: url };
      setHistory(prev => [h, ...prev].slice(0, 400));
    } catch (e) {
      setConvErr(e.message);
    }
  }

  function handleSaveConverted() {
    if (!conv) return;
    const p = newProductFromConv(conv, settings.defaultList);
    setProducts(prev => [p, ...prev]);
    setEditing(p); setShowDrawer(true);
  }

  // ---------------- Derived data
  const allTags = useMemo(() => Array.from(new Set(products.flatMap(p => p.tags || []))).sort(), [products]);

  const [tagFilter, setTagFilter] = useState("");

  const filtered = useMemo(() => {
    return products
      .filter(p => (activeList ? p.list === activeList : true))
      .filter(p => (tagFilter ? (p.tags || []).includes(tagFilter) : true))
      .filter(p => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        const hay = [p.title, p.notes, p.shop_type, p.id, p.seller, p.size, p.ref, p.mulebuy_url, ...(p.tags||[])].join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort(bySort(sortId));
  }, [products, activeList, search, sortId, tagFilter]);

  // ---------------- Bulk actions
  function toggleSelect(uid) {
    setSelection(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }
  function clearSelection() { setSelection(new Set()); }

  function bulkDelete() {
    if (selection.size === 0) return;
    if (!confirm(`Supprimer ${selection.size} élément(s) ?`)) return;
    setProducts(prev => prev.filter(p => !selection.has(p.uid)));
    clearSelection();
  }

  function bulkMove(listName) {
    if (selection.size === 0) return;
    setProducts(prev => prev.map(p => selection.has(p.uid) ? { ...p, list: listName } : p));
    clearSelection();
  }

  function bulkAddTag(tag) {
    if (!tag) return;
    setProducts(prev => prev.map(p => selection.has(p.uid) ? { ...p, tags: Array.from(new Set([...(p.tags||[]), tag])) } : p));
  }

  // keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") { setShowDrawer(false); setEditing(null); }
      if (e.key === "Delete") { bulkDelete(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { const el = document.getElementById("search"); el?.focus(); e.preventDefault(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur border-b border-neutral-800 bg-neutral-900/60">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <h1 className="text-xl sm:text-2xl font-semibold">Mulebuy Manager</h1>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            <TabButton active={tab==="manage"} onClick={()=>setTab("manage")}>Convertir</TabButton>
            <TabButton active={tab==="lists"} onClick={()=>setTab("lists")}>Listes</TabButton>
            <TabButton active={tab==="settings"} onClick={()=>setTab("settings")}>Paramètres</TabButton>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 space-y-6">
        {tab === "manage" && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-6 shadow-xl shadow-black/30">
            <h2 className="text-lg font-semibold mb-4">Convertisseur Weidian/Taobao → Mulebuy</h2>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-3">
                <label className="block text-sm opacity-80">URL Weidian ou Taobao</label>
                <input value={inputUrl} onChange={e=>setInputUrl(e.target.value)} placeholder="https://weidian.com/item.html?itemID=... ou https://item.taobao.com/item.htm?id=..." className="w-full rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"/>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm opacity-80">Referral (ref)</label>
                    <input value={ref} onChange={e=>setRef(e.target.value)} className="w-full rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                    <div className="text-xs opacity-60 mt-1">Défaut : {settings.defaultRef}</div>
                  </div>
                  <div className="flex items-end">
                    <button onClick={handleConvert} className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[.99] transition px-3 py-2 font-medium">Convertir</button>
                  </div>
                </div>
                {convErr && <div className="text-sm text-red-400">{convErr}</div>}
              </div>
            </div>

            {conv && (
              <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                <div className="truncate">
                  <div className="text-xs opacity-70 mb-1">URL Mulebuy</div>
                  <a href={conv.url} target="_blank" rel="noreferrer" className="block truncate rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 hover:border-neutral-600">{conv.url}</a>
                  <div className="text-xs opacity-70 mt-2">shop_type: <span className="font-mono">{conv.shop_type}</span> · id: <span className="font-mono">{conv.id}</span> · ref: <span className="font-mono">{conv.ref}</span></div>
                </div>
                <button onClick={()=>navigator.clipboard.writeText(conv.url)} className="rounded-xl border border-neutral-700 px-3 py-2 hover:bg-neutral-800">Copier</button>
                <button onClick={handleSaveConverted} className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-2 font-medium">Enregistrer</button>
              </div>
            )}

            {/* History */}
            <div className="mt-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">Historique</h3>
                {history.length>0 && <button className="text-sm rounded-xl border border-neutral-700 px-3 py-1.5 hover:bg-neutral-800" onClick={()=>setHistory([])}>Vider</button>}
              </div>
              {history.length===0? (
                <div className="text-sm opacity-70">Aucune conversion.</div>
              ): (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left opacity-70">
                      <tr><th className="py-2">Date</th><th className="py-2">Input</th><th className="py-2">Sortie</th><th className="py-2">Infos</th></tr>
                    </thead>
                    <tbody>
                      {history.map(h => (
                        <tr key={h.id} className="border-t border-neutral-800">
                          <td className="py-2 align-top whitespace-nowrap">{new Date(h.ts).toLocaleString()}</td>
                          <td className="py-2 align-top max-w-[24rem] truncate"><a href={h.input} target="_blank" rel="noreferrer" className="hover:underline">{h.input}</a></td>
                          <td className="py-2 align-top max-w-[24rem] truncate"><a href={h.out} target="_blank" rel="noreferrer" className="hover:underline">{h.out}</a></td>
                          <td className="py-2 align-top">{h.shop_type} · <span className="font-mono">{h.id}</span> · ref <span className="font-mono">{h.ref}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {tab === "lists" && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-6 shadow-xl shadow-black/30">
            <div className="flex flex-wrap items-center gap-3 justify-between mb-4">
              <h2 className="text-lg font-semibold">Listes & Produits</h2>
              <div className="flex items-center gap-2">
                <input id="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher (titre, tags, id, vendeur...)" className="rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                <TagFilter tag={tagFilter} setTag={setTagFilter} allTags={allTags}/>
                <Select value={activeList} onChange={e=>setActiveList(e.target.value)}>
                  {LISTS.map(l => <option key={l} value={l}>{l}</option>)}
                </Select>
                <Select value={sortId} onChange={e=>setSortId(e.target.value)}>
                  {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
                <button className="rounded-xl border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800" onClick={()=>{
                  const p = newBlankProduct(settings.defaultRef, activeList);
                  setProducts(prev=>[p, ...prev]); setEditing(p); setShowDrawer(true);
                }}>Nouveau</button>
              </div>
            </div>

            <BulkBar selection={selection} onClear={clearSelection} onDelete={bulkDelete} onMove={bulkMove} onAddTag={bulkAddTag} />

            {filtered.length===0 ? (
              <div className="text-sm opacity-70">Aucun produit dans cette vue.</div>
            ) : (
              <div className={classNames("grid gap-3", settings.compactCards? "sm:grid-cols-3 md:grid-cols-4" : "sm:grid-cols-2 md:grid-cols-3") }>
                {filtered.map(p => (
                  <ProductCard key={p.uid} p={p} compact={settings.compactCards} selected={selection.has(p.uid)} onSelect={()=>toggleSelect(p.uid)} onOpen={()=>{ setEditing(p); setShowDrawer(true); }} onUpdate={patch=>setProducts(prev=>prev.map(x=>x.uid===p.uid?{...x,...patch}:x))} onDelete={()=>setProducts(prev=>prev.filter(x=>x.uid!==p.uid))}/>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "settings" && (
          <SettingsSection settings={settings} setSettings={setSettings} products={products} setProducts={setProducts} />
        )}
      </main>

      {showDrawer && editing && (
        <EditDrawer product={editing} onClose={()=>{ setShowDrawer(false); setEditing(null); }} onChange={patch=>setProducts(prev=>prev.map(x=>x.uid===editing.uid?{...x,...patch}:x))} allTags={allTags} />
      )}
    </div>
  );
}

// ---------------------------- Helpers (domain) ----------------------------
function bySort(sortId) {
  return (a, b) => {
    switch (sortId) {
      case "created_at_desc": return (b.created_at||"").localeCompare(a.created_at||"");
      case "created_at_asc": return (a.created_at||"").localeCompare(b.created_at||"");
      case "title_asc": return (a.title||"").localeCompare(b.title||"");
      case "title_desc": return (b.title||"").localeCompare(a.title||"");
      case "price_asc": return (Number(a.price||0) - Number(b.price||0));
      case "price_desc": return (Number(b.price||0) - Number(a.price||0));
      case "shop_type": return (a.shop_type||"").localeCompare(b.shop_type||"");
      default: return 0;
    }
  };
}

function newProductFromConv(conv, list) {
  return {
    uid: uid(),
    created_at: new Date().toISOString(),
    list: list || "Wishlist",
    shop_type: conv.shop_type,
    id: conv.id,
    ref: conv.ref,
    mulebuy_url: conv.url,
    title: "",
    seller: "",
    size: "",
    price: "",
    rating: 0,
    notes: "",
    tags: [],
    qc_links: [],
    images: [],
    _v: SCHEMA_VERSION,
  };
}

function newBlankProduct(ref, list) {
  return {
    uid: uid(),
    created_at: new Date().toISOString(),
    list: list || "Wishlist",
    shop_type: "weidian",
    id: "",
    ref: ref || DEFAULT_SETTINGS.defaultRef,
    mulebuy_url: "",
    title: "(sans titre)",
    seller: "",
    size: "",
    price: "",
    rating: 0,
    notes: "",
    tags: [],
    qc_links: [],
    images: [],
    _v: SCHEMA_VERSION,
  };
}

// ---------------------------- UI Components -------------------------------
function TabButton({ active, children, ...props }) {
  return (
    <button {...props} className={classNames("rounded-xl px-3 py-2", active? "bg-neutral-800 border border-neutral-700" : "hover:bg-neutral-800/60 border border-transparent")}>{children}</button>
  );
}

function Select({ children, ...props }) {
  return (
    <select {...props} className="rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
      {children}
    </select>
  );
}

function Tag({ children, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-900 border border-neutral-700 px-2 py-1 text-xs">
      {children}
      {onRemove && <button className="opacity-70 hover:opacity-100" onClick={onRemove}>×</button>}
    </span>
  );
}

function TagFilter({ tag, setTag, allTags }) {
  return (
    <select value={tag} onChange={e=>setTag(e.target.value)} className="rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm">
      <option value="">Toutes les balises</option>
      {allTags.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

function ProductCard({ p, onOpen, onUpdate, onDelete, compact, selected, onSelect }) {
  const [newLink, setNewLink] = useState("");
  const fileRef = useRef(null);

  async function addImagesFromFiles(fileList) {
    const files = Array.from(fileList||[]).filter(f=>f.type.startsWith("image/"));
    if (!files.length) return;
    const dataUrls = await Promise.all(files.map(f=> new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(f);})))
    onUpdate({ images: [...(p.images||[]), ...dataUrls] });
  }

  return (
    <div className={classNames("rounded-2xl border border-neutral-800 bg-neutral-900 p-3", selected && "ring-2 ring-indigo-500")}
      onClick={(e)=>{ if (e.detail===2) onOpen(); }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs opacity-70 mb-1">{p.shop_type} · <span className="font-mono">{p.id||"(id?)"}</span></div>
          <div className="font-medium truncate">{p.title || "(sans titre)"}</div>
          <div className="text-xs opacity-70 truncate">{p.mulebuy_url || "—"}</div>
        </div>
        <div className="flex items-center gap-1">
          <input type="checkbox" checked={selected} onChange={onSelect} className="h-4 w-4"/>
          <button title="Éditer" onClick={onOpen} className="rounded-lg border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800">Edit</button>
          <button title="Supprimer" onClick={onDelete} className="rounded-lg border border-red-700/60 text-red-300 px-2 py-1 text-xs hover:bg-red-900/20">Del</button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="text-xs opacity-80">Prix: <span className="font-medium">{currency(p.price)}</span></div>
        <div className="text-xs opacity-80 text-right">Taille: <span className="font-medium">{p.size || "—"}</span></div>
      </div>

      {/* QC preview from links */}
      {(p.qc_links||[]).some(looksLikeImageUrl) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {p.qc_links.filter(looksLikeImageUrl).slice(0, compact? 3 : 6).map((l,i) => (
            <a key={i} href={l} target="_blank" rel="noreferrer" className="block">
              <img src={l} alt="qc" loading="lazy" onError={(e)=>{e.currentTarget.style.display='none';}} className="h-20 w-20 object-cover rounded-lg border border-neutral-700"/>
            </a>
          ))}
        </div>
      )}

      {/* Local images area (compact hidden) */}
      {!compact && (
        <div className="mt-2">
          <div className="text-xs opacity-70 mb-1">Photos locales</div>
          <div className="flex flex-wrap gap-2">
            {(p.images||[]).map((src,i)=>(
              <div key={i} className="relative group">
                <img src={src} alt="local" className="h-20 w-20 object-cover rounded-lg border border-neutral-700"/>
                <button className="absolute top-1 right-1 hidden group-hover:block text-[10px] rounded bg-black/70 px-1" onClick={()=>onUpdate({ images: p.images.filter((_,j)=>j!==i) })}>×</button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e=>addImagesFromFiles(e.target.files)}/>
            <button className="rounded-lg border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800" onClick={()=>fileRef.current?.click()}>Importer</button>
          </div>
        </div>
      )}

      {/* Quick add link */}
      <div className="mt-2 flex gap-2">
        <input value={newLink} onChange={e=>setNewLink(e.target.value)} placeholder="Ajouter lien QC https://..." className="flex-1 rounded-lg bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs"/>
        <button className="rounded-lg border border-neutral-700 px-2 py-1 text-xs" onClick={()=>{ if (newLink.trim()) { onUpdate({ qc_links: [...(p.qc_links||[]), newLink.trim()] }); setNewLink(""); } }}>Ajouter</button>
      </div>

      {/* Tags */}
      <div className="mt-2 flex flex-wrap gap-1">
        {(p.tags||[]).map((t,i)=>(<Tag key={i} onRemove={()=>onUpdate({ tags: p.tags.filter((_,j)=>j!==i) })}>{t}</Tag>))}
      </div>
    </div>
  );
}

function BulkBar({ selection, onClear, onDelete, onMove, onAddTag }) {
  const [tag, setTag] = useState("");
  const count = selection.size;
  if (!count) return null;
  return (
    <div className="mb-3 rounded-xl border border-neutral-700 bg-neutral-800/60 p-2 text-sm flex flex-wrap items-center gap-2">
      <div>{count} sélectionné(s)</div>
      <button className="rounded-lg border border-neutral-700 px-2 py-1 hover:bg-neutral-900" onClick={onDelete}>Supprimer</button>
      <div className="flex items-center gap-1">
        <span>Déplacer vers</span>
        {LISTS.map(l=> (
          <button key={l} className="rounded-lg border border-neutral-700 px-2 py-1 hover:bg-neutral-900" onClick={()=>onMove(l)}>{l}</button>
        ))}
      </div>
      <div className="flex items-center gap-1 ml-auto">
        <input value={tag} onChange={e=>setTag(e.target.value)} placeholder="Ajouter tag" className="rounded-lg bg-neutral-900 border border-neutral-700 px-2 py-1"/>
        <button className="rounded-lg border border-neutral-700 px-2 py-1 hover:bg-neutral-900" onClick={()=>{ if(tag.trim()) onAddTag(tag.trim()); }}>OK</button>
        <button className="rounded-lg border border-neutral-700 px-2 py-1 hover:bg-neutral-900" onClick={onClear}>Annuler</button>
      </div>
    </div>
  );
}

function EditDrawer({ product, onClose, onChange, allTags }) {
  const p = product;
  const [local, setLocal] = useState(p);
  useEffect(()=>setLocal(p), [p.uid]);

  function apply() { onChange(local); onClose(); }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose}/>
      <div className="w-[420px] max-w-[90vw] h-full overflow-y-auto bg-neutral-900 border-l border-neutral-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Éditer le produit</h3>
          <button className="rounded-lg border border-neutral-700 px-2 py-1 text-sm" onClick={onClose}>Fermer</button>
        </div>

        <div className="space-y-3">
          <Field label="Liste">
            <Select value={local.list} onChange={e=>setLocal(v=>({...v, list: e.target.value}))}>
              {LISTS.map(l=> <option key={l} value={l}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Titre">
            <input value={local.title} onChange={e=>setLocal(v=>({...v, title: e.target.value}))} className="w-full rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2"/>
          </Field>
          <Field label="Shop type / ID">
            <div className="grid grid-cols-2 gap-2">
              <Select value={local.shop_type} onChange={e=>setLocal(v=>({...v, shop_type: e.target.value}))}>
                <option value="weidian">weidian</option>
                <option value="taobao">taobao</option>
              </Select>
              <input value={local.id} onChange={e=>setLocal(v=>({...v, id: e.target.value}))} className="rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2"/>
            </div>
          </Field>
          <Field label="Referral (ref)">
            <input value={local.ref} onChange={e=>setLocal(v=>({...v, ref: e.target.value}))} className="w-full rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2"/>
          </Field>
          <Field label="URL Mulebuy">
            <div className="flex gap-2">
              <input value={local.mulebuy_url} onChange={e=>setLocal(v=>({...v, mulebuy_url: e.target.value}))} className="flex-1 rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2"/>
              <button className="rounded-xl border border-neutral-700 px-3 py-2" onClick={()=>navigator.clipboard.writeText(local.mulebuy_url)}>Copier</button>
            </div>
            <button className="mt-2 text-xs rounded-lg border border-neutral-700 px-2 py-1" onClick={()=>setLocal(v=>({...v, mulebuy_url: toMulebuy({shop_type:v.shop_type,id:v.id,ref:v.ref})}))}>Générer depuis ref/id</button>
          </Field>
          <Field label="Vendeur / Taille / Prix">
            <div className="grid grid-cols-3 gap-2">
              <input placeholder="seller" value={local.seller} onChange={e=>setLocal(v=>({...v, seller: e.target.value}))} className="rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2"/>
              <input placeholder="size" value={local.size} onChange={e=>setLocal(v=>({...v, size: e.target.value}))} className="rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2"/>
              <input placeholder="price €" value={local.price} onChange={e=>setLocal(v=>({...v, price: e.target.value}))} className="rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2"/>
            </div>
          </Field>
          <Field label="Note (0-5)">
            <input type="range" min={0} max={5} step={1} value={local.rating||0} onChange={e=>setLocal(v=>({...v, rating: Number(e.target.value)}))} className="w-full"/>
          </Field>
          <Field label="Tags">
            <TagEditor value={local.tags||[]} onChange={tags=>setLocal(v=>({...v, tags}))} allTags={allTags} />
          </Field>
          <Field label="Notes">
            <textarea value={local.notes} onChange={e=>setLocal(v=>({...v, notes: e.target.value}))} className="w-full h-28 rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2"/>
          </Field>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="rounded-xl border border-neutral-700 px-3 py-2" onClick={onClose}>Annuler</button>
          <button className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-2" onClick={apply}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-sm opacity-80 mb-1">{label}</div>
      {children}
    </div>
  );
}

function TagEditor({ value, onChange, allTags }) {
  const [txt, setTxt] = useState("");
  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-2">
        {(value||[]).map((t,i)=>(<Tag key={i} onRemove={()=>onChange(value.filter((_,j)=>j!==i))}>{t}</Tag>))}
      </div>
      <div className="flex gap-2">
        <input value={txt} onChange={e=>setTxt(e.target.value)} placeholder="nouveau tag" className="flex-1 rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2"/>
        <button className="rounded-xl border border-neutral-700 px-3 py-2" onClick={()=>{ const t=txt.trim(); if(!t) return; onChange(Array.from(new Set([...(value||[]), t]))); setTxt(""); }}>Ajouter</button>
      </div>
      {allTags.length>0 && (
        <div className="mt-2 flex flex-wrap gap-1 text-xs">
          {allTags.map(t => (
            <button key={t} className="rounded-full border border-neutral-700 px-2 py-1 hover:bg-neutral-800" onClick={()=>onChange(Array.from(new Set([...(value||[]), t])))}>{t}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsSection({ settings, setSettings, products, setProducts }) {
  const [openExport, setOpenExport] = useState(false);
  const [jsonText, setJsonText] = useState("");

  useEffect(()=>{ if(openExport) setJsonText(JSON.stringify({ settings, products }, null, 2)); }, [openExport, settings, products]);

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-6 shadow-xl shadow-black/30 space-y-4">
      <h2 className="text-lg font-semibold">Paramètres</h2>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Ref par défaut">
          <input value={settings.defaultRef} onChange={e=>setSettings(v=>({...v, defaultRef: e.target.value}))} className="w-full rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2"/>
        </Field>
        <Field label="Liste par défaut">
          <Select value={settings.defaultList} onChange={e=>setSettings(v=>({...v, defaultList: e.target.value}))}>
            {LISTS.map(l=> <option key={l} value={l}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Cartes compactes">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={settings.compactCards} onChange={e=>setSettings(v=>({...v, compactCards: e.target.checked}))}/>
            <span className="text-sm opacity-80">Activer</span>
          </label>
        </Field>
      </div>

      <div className="pt-2 border-t border-neutral-800">
        <h3 className="font-medium mb-2">Sauvegarde & Données</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-xl border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800" onClick={()=>setOpenExport(true)}>Exporter JSON</button>
          <ImportButton setProducts={setProducts} setSettings={setSettings} />
          <button className="rounded-xl border border-red-700/60 text-red-300 px-3 py-2 text-sm hover:bg-red-900/20" onClick={()=>{
            if (confirm("Réinitialiser toutes les données ?")) {
              setProducts([]);
            }
          }}>Réinitialiser</button>
        </div>
      </div>

      {openExport && (
        <Modal title="Exporter JSON" onClose={()=>setOpenExport(false)}>
          <textarea value={jsonText} onChange={e=>setJsonText(e.target.value)} className="w-full h-64 rounded-xl bg-neutral-950 border border-neutral-700 px-3 py-2 font-mono text-xs"/>
          <div className="mt-3 flex justify-end gap-2">
            <button className="rounded-xl border border-neutral-700 px-3 py-2 text-sm" onClick={()=>navigator.clipboard.writeText(jsonText)}>Copier</button>
            <button className="rounded-xl border border-neutral-700 px-3 py-2 text-sm" onClick={()=>{
              const blob = new Blob([jsonText], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `mulebuy-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
              URL.revokeObjectURL(url);
            }}>Télécharger</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function ImportButton({ setProducts, setSettings }) {
  const inputRef = useRef(null);
  function onPick(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (Array.isArray(data)) { // old export just array
          setProducts(data);
        } else {
          if (Array.isArray(data.products)) setProducts(data.products);
          if (data.settings) setSettings(prev=>({ ...prev, ...data.settings }));
        }
        alert("Import réussi ✔");
      } catch (e) {
        alert("Import invalide: "+ e.message);
      }
    };
    reader.readAsText(file);
  }
  return (
    <>
      <input ref={inputRef} type="file" accept="application/json" className="hidden" onChange={onPick}/>
      <button className="rounded-xl border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800" onClick={()=>inputRef.current?.click()}>Importer JSON</button>
    </>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-neutral-700 bg-neutral-900 p-4" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="rounded-lg border border-neutral-700 px-2 py-1 text-sm" onClick={onClose}>Fermer</button>
        </div>
        {children}
      </div>
    </div>
  );
}
