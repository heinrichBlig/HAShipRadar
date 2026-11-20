/* Ship Radar Card for Home Assistant - https://github.com/YOUR-USER/HAShipRadar
 * Reads the ship list that the Ship Radar app writes to sensor.ship_radar.
 */
const VERSION = "0.1.0";

// hull / superstructure colours and the silhouette used for each vessel category
const CATS = {
  cargo:     { label: "Cargo ship",       hull: "#2f6f8f", sup: "#e6eaec", sil: "cargo" },
  tanker:    { label: "Tanker",           hull: "#a8443a", sup: "#e6eaec", sil: "tanker" },
  passenger: { label: "Passenger vessel", hull: "#1f3a5f", sup: "#f3efe6", sil: "passenger" },
  fishing:   { label: "Fishing vessel",   hull: "#2e8b6a", sup: "#efe3c0", sil: "fishing" },
  tug:       { label: "Tug or tow",       hull: "#c4871b", sup: "#2d3640", sil: "tug" },
  sailing:   { label: "Sailing vessel",   hull: "#6b5fa6", sup: "#f2f2f2", sil: "sailing" },
  pleasure:  { label: "Pleasure craft",   hull: "#d06a4a", sup: "#f4f4f4", sil: "yacht" },
  naval:     { label: "Naval or patrol",  hull: "#5d6b78", sup: "#aeb8c1", sil: "patrol" },
  service:   { label: "Service vessel",   hull: "#e0742f", sup: "#f1ece2", sil: "patrol" },
  other:     { label: "Other vessel",     hull: "#7a8791", sup: "#dde3e7", sil: "patrol" },
  unknown:   { label: "Type not reported", hull: "#8a949c", sup: "#dde3e7", sil: "hull" },
};

// side-on silhouettes, bow to the right, drawn in a 100 x 40 box with the waterline near y=33
const SIL = {
  hull:      `<path class="h" d="M3 25H94Q98 25 99 22L92 33H8Q4 33 3 25Z"/>`,
  cargo:     `<path class="h" d="M3 25H94Q98 25 99 22L92 33H8Q4 33 3 25Z"/><path class="s" d="M7 11H19V25H7Z"/><path class="s" d="M9 6H17V11H9Z"/><path class="s" opacity=".6" d="M25 16H45V25H25ZM48 16H68V25H48ZM71 16H88V25H71Z"/>`,
  tanker:    `<path class="h" d="M2 26H95Q98 26 99 24L93 33H7Q3 33 2 26Z"/><path class="s" d="M6 14H18V26H6Z"/><path class="s" d="M8 9H16V14H8Z"/><path class="s" opacity=".75" d="M26 23H86V26H26Z"/><path class="s" opacity=".75" d="M40 20H44V23H40ZM62 20H66V23H62Z"/>`,
  passenger: `<path class="h" d="M3 27H94Q98 27 99 24L92 33H8Q4 33 3 27Z"/><path class="s" d="M10 20H88V27H10Z"/><path class="s" d="M16 14H80V20H16Z"/><path class="s" d="M26 9H70V14H26Z"/><path class="h" d="M44 2H52V9H44Z"/>`,
  fishing:   `<path class="h" d="M12 26H84Q90 26 92 22L86 33H18Q13 33 12 26Z"/><path class="s" d="M58 14H72V26H58Z"/><path class="s" d="M64 5H66V14H64Z"/><path class="s" opacity=".6" d="M32 18H48V26H32Z"/><path class="s" d="M24 8H26V26H24Z"/>`,
  tug:       `<path class="h" d="M16 26H80Q86 26 88 23L82 33H20Q16 33 16 26Z"/><path class="s" d="M32 15H58V26H32Z"/><path class="s" d="M37 9H53V15H37Z"/><path class="h" d="M43 2H49V9H43Z"/>`,
  sailing:   `<path class="h" d="M10 27H88L80 33H18Q12 33 10 27Z"/><path class="s" d="M49 2H51V27H49Z"/><path class="s" d="M47 4V25H22Z"/><path class="s" opacity=".85" d="M53 6V25H86Z"/>`,
  yacht:     `<path class="h" d="M8 27H90Q96 27 97 24L88 33H14Q9 33 8 27Z"/><path class="s" d="M28 18H62L68 27H24Z"/><path class="s" opacity=".7" d="M40 12H56L60 18H38Z"/>`,
  patrol:    `<path class="h" d="M4 26H92Q97 26 98 23L90 33H10Q5 33 4 26Z"/><path class="s" d="M30 16H66V26H30Z"/><path class="s" d="M40 10H58V16H40Z"/><path class="s" d="M48 1H50V10H48Z"/><path class="s" d="M78 20H88V22H78Z"/>`,
};

const STATUS_LONG = { 1: "At anchor", 5: "Moored", 6: "Aground" };
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const cardinal = (d) => COMPASS[Math.round(((d % 360) + 360) % 360 / 45) % 8];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const flagEmoji = (iso) => (iso && /^[A-Z]{2}$/.test(iso)
  ? String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "");

const CSS = `
:host{display:block}
ha-card{display:block;padding:16px 16px 12px;overflow:hidden}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
h2{margin:0;font-size:1.1rem;font-weight:600}
.sub{color:var(--secondary-text-color);font-size:.85rem;margin-top:2px;font-variant-numeric:tabular-nums}
.tabs{display:flex;gap:14px;flex:none}
.tabs button{background:none;border:0;border-bottom:2px solid transparent;padding:2px 0;font:inherit;font-size:.9rem;color:var(--secondary-text-color);cursor:pointer}
.tabs button[aria-pressed=true]{color:var(--primary-text-color);border-bottom-color:var(--primary-color)}
button:focus-visible,.ship:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}
.note{margin:12px 0 0;padding:10px 12px;border-radius:8px;background:rgba(127,127,127,.12);font-size:.9rem;line-height:1.4}
.radar{width:100%;height:auto;display:block;margin-top:6px;max-height:78vh}
.sea{fill:var(--primary-color);opacity:.05}
.ring{fill:none;stroke:var(--divider-color,rgba(127,127,127,.35));stroke-width:1}
.axis{stroke:var(--divider-color,rgba(127,127,127,.35));stroke-width:1;stroke-dasharray:2 6}
.rl{font-size:11px;fill:var(--secondary-text-color);font-variant-numeric:tabular-nums}
.cp{font-size:13px;font-weight:600;fill:var(--secondary-text-color);text-anchor:middle}
.home{fill:var(--primary-color)}
.homering{fill:none;stroke:var(--primary-color);stroke-width:1.5;opacity:.5}
.h{fill:var(--hull)}.s{fill:var(--sup)}
.h,.s{stroke:rgba(0,0,0,.3);stroke-width:.6;stroke-linejoin:round}
.ship{cursor:pointer;outline:none}
.ship.still .sil{opacity:.72}
.hit{fill:transparent;stroke:none}
.ship:focus-visible .hit{stroke:var(--primary-color);stroke-width:2}
.water{stroke:var(--secondary-text-color);stroke-opacity:.35;stroke-width:1.5}
.wake{stroke:var(--secondary-text-color);stroke-opacity:.6;stroke-width:1.5;stroke-dasharray:4 3}
.leader{stroke:var(--secondary-text-color);stroke-opacity:.4;stroke-width:1}
.dot{fill:var(--secondary-text-color);opacity:.6}
.selring{fill:none;stroke:var(--primary-color);stroke-width:1.5;stroke-dasharray:3 3}
.lbl{font-size:12px;fill:var(--primary-text-color);text-anchor:middle;paint-order:stroke;stroke:var(--card-background-color,#fff);stroke-width:3px}
.list{display:flex;flex-direction:column;margin-top:8px}
.row{display:grid;grid-template-columns:60px 1fr auto;grid-template-areas:"t n d" "t s d";column-gap:12px;align-items:center;text-align:left;width:100%;padding:8px 4px;background:none;border:0;border-bottom:1px solid var(--divider-color,rgba(127,127,127,.25));font:inherit;color:inherit;cursor:pointer}
.row:hover{background:rgba(127,127,127,.08)}
.row .thumb{grid-area:t;width:60px;height:24px}
.row b{grid-area:n;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row small{grid-area:s;color:var(--secondary-text-color);font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .ds{grid-area:d;text-align:right;font-variant-numeric:tabular-nums;font-size:.9rem}
.detail{margin-top:12px;padding:12px 14px;border-radius:10px;background:rgba(127,127,127,.1)}
.dh{display:flex;gap:12px;align-items:center}
.dh .thumb{width:72px;height:29px;flex:none}
.dh h3{margin:0;font-size:1rem;font-weight:600}
.dh p{margin:0;color:var(--secondary-text-color);font-size:.85rem}
.x{margin-left:auto;background:none;border:0;font-size:1.4rem;line-height:1;color:var(--secondary-text-color);cursor:pointer;padding:4px 8px}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:10px 0 0;font-size:.9rem}
dt{color:var(--secondary-text-color)}dd{margin:0;font-variant-numeric:tabular-nums}
dd a{color:var(--primary-color)}
`;

class ShipRadarCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    const defs = Object.entries(SIL).map(([k, v]) => `<symbol id="sil-${k}" viewBox="0 0 100 40">${v}</symbol>`).join("");
    this.shadowRoot.innerHTML = `<style>${CSS}</style><svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${defs}</defs></svg><ha-card><div id="b"></div></ha-card>`;
    this._sel = null;
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.closest && e.target.closest("[data-m]")) {
        e.preventDefault();
        this._onClick(e);
      }
    });
  }

  setConfig(config) {
    this._cfg = {
      entity: "sensor.ship_radar", title: "Ships nearby", view: "radar", units: "nm",
      scale: "sqrt", labels: false, show_moored: true, max_age: 30, range_nm: null, ...config,
    };
    if (typeof this._cfg.entity !== "string") throw new Error("entity must be a sensor id, e.g. sensor.ship_radar");
    this._view = this._cfg.view === "list" ? "list" : "radar";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const st = hass.states[this._cfg.entity];
    if (st !== this._st) {
      this._st = st;
      this._render();
    }
  }

  getCardSize() { return 7; }
  static getStubConfig() { return { entity: "sensor.ship_radar" }; }

  _onClick(e) {
    const tab = e.target.closest("[data-tab]");
    if (tab) { this._view = tab.dataset.tab; return this._render(); }
    if (e.target.closest("[data-close]")) { this._sel = null; return this._render(); }
    const m = e.target.closest("[data-m]");
    if (m) {
      const id = Number(m.dataset.m);
      this._sel = this._sel === id ? null : id;
      this._render();
    }
  }

  // ---- helpers -------------------------------------------------------------
  _dist(nm) { return this._cfg.units === "km" ? `${(nm * 1.852).toFixed(1)} km` : `${nm.toFixed(1)} nm`; }
  _still(s) { return [1, 5, 6].includes(s.status) || (s.sog ?? 0) < 0.5; }
  _motion(s) {
    if (STATUS_LONG[s.status]) return STATUS_LONG[s.status];
    if ((s.sog ?? 0) < 0.5) return "Stationary";
    return `${s.sog.toFixed(1)} kn${s.cog != null ? ` heading ${cardinal(s.cog)}` : ""}`;
  }
  _ago(sec) {
    if (sec < 90) return "just now";
    if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
    return `${(sec / 3600).toFixed(1)} h ago`;
  }
  _size(s) { return s.len ? Math.max(28, Math.min(70, 26 + Math.sqrt(s.len) * 2.4)) : 38; }
  _use(s, w) {
    const c = CATS[s.cat] || CATS.unknown;
    return `<use href="#sil-${c.sil}" width="${w}" height="${w * 0.4}" style="--hull:${c.hull};--sup:${c.sup}"/>`;
  }
  _thumb(s, cls = "thumb") {
    return `<svg class="${cls}" viewBox="0 0 100 40" aria-hidden="true">${this._use(s, 100)}</svg>`;
  }

  // ---- layout --------------------------------------------------------------
  _place(ships, range) {
    const R = 262, C = 300;
    const items = ships.map((s) => {
      const f = this._cfg.scale === "sqrt" ? Math.sqrt(s.dist / range) : s.dist / range;
      const a = (s.brg * Math.PI) / 180;
      const tx = C + R * f * Math.sin(a), ty = C - R * f * Math.cos(a);
      const h = (s.hdg != null ? s.hdg : s.cog);
      return { s, tx, ty, x: tx, y: ty, w: this._size(s), face: h != null && Math.sin((h * Math.PI) / 180) < 0 ? -1 : 1 };
    });
    // nudge overlapping silhouettes apart while keeping them near their true position
    for (let it = 0; it < 150; it++) {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const minX = (a.w + b.w) * 0.5, minY = (a.w + b.w) * 0.24;
          const ox = minX - Math.abs(dx), oy = minY - Math.abs(dy);
          if (ox > 0 && oy > 0) {
            if (ox / minX < oy / minY) { const p = (ox / 2) * (dx >= 0 ? 1 : -1); a.x -= p; b.x += p; }
            else { const p = (oy / 2) * (dy >= 0 ? 1 : -1); a.y -= p; b.y += p; }
          }
        }
      }
      for (const a of items) {
        a.x += (a.tx - a.x) * 0.015; a.y += (a.ty - a.y) * 0.015;
        a.x = Math.max(24, Math.min(576, a.x)); a.y = Math.max(24, Math.min(576, a.y));
      }
    }
    return items;
  }

  // ---- views ---------------------------------------------------------------
  _radar(ships, range) {
    const C = 300, R = 262;
    const rad = (d) => (this._cfg.scale === "sqrt" ? Math.sqrt(d / range) : d / range) * R;
    const sq = this._cfg.scale === "sqrt";
    const nice = (d) => (d >= 2 ? Math.round(d * 2) / 2 : Math.round(d * 10) / 10) || 0.1;
    const rings = [0.25, 0.5, 0.75, 1].map((f) => {
      const d = f === 1 ? range : nice(range * (sq ? f * f : f));
      const r = rad(d);
      return `<circle class="ring" cx="${C}" cy="${C}" r="${r}"/><text class="rl" x="${C + r * 0.7071 + 4}" y="${C - r * 0.7071 - 3}">${this._dist(d).replace(/\.0(?= )/, "")}</text>`;
    }).join("");
    const items = this._place(ships, range);
    // decide which names fit without colliding: selected ship first, then the biggest
    const shown = new Set(), boxes = [];
    const wantLabel = (it) => it.s.mmsi === this._sel || this._cfg.labels;
    [...items].filter(wantLabel).sort((p, q) => (q.s.mmsi === this._sel) - (p.s.mmsi === this._sel) || q.w - p.w).forEach((it) => {
      const lw = it.s.name.length * 6.6, x0 = it.x - lw / 2, y0 = it.y + it.w * 0.04 + 3, y1 = y0 + 14;
      const clash = boxes.some((b) => x0 < b[2] && x0 + lw > b[0] && y0 < b[3] && y1 > b[1]);
      if (it.s.mmsi === this._sel || !clash) { shown.add(it.s.mmsi); boxes.push([x0, y0, x0 + lw, y1]); }
    });
    items.sort((p, q) => (p.s.mmsi === this._sel) - (q.s.mmsi === this._sel) || p.y - q.y);
    const body = items.map((it) => {
      const { s, w, face } = it, h = w * 0.4, sel = s.mmsi === this._sel, still = this._still(s);
      const moved = Math.hypot(it.x - it.tx, it.y - it.ty) > 8;
      const wake = still ? "" : `<line class="wake" x1="${-w / 2}" y1="${h * 0.1}" x2="${-w / 2 - Math.min(10 + (s.sog || 0) * 2.2, 46)}" y2="${h * 0.1}"/>`;
      const label = shown.has(s.mmsi) ? `<text class="lbl" y="${h * 0.1 + 15}">${esc(s.name)}</text>` : "";
      return `${moved ? `<line class="leader" x1="${it.tx}" y1="${it.ty}" x2="${it.x}" y2="${it.y}"/><circle class="dot" cx="${it.tx}" cy="${it.ty}" r="2"/>` : ""}
<g class="ship${still ? " still" : ""}" data-m="${s.mmsi}" tabindex="0" role="button" aria-label="${esc(s.name)}, ${this._dist(s.dist)} ${cardinal(s.brg)}" transform="translate(${it.x.toFixed(1)} ${it.y.toFixed(1)})">
<title>${esc(s.name)} - ${this._dist(s.dist)} ${cardinal(s.brg)}</title>
<rect class="hit" x="${-w / 2 - 4}" y="${-h * 0.85}" width="${w + 8}" height="${h * 1.15}" rx="4"/>
${sel ? `<ellipse class="selring" cx="0" cy="${-h * 0.3}" rx="${w * 0.62}" ry="${h * 0.85}"/>` : ""}
<g transform="scale(${face} 1)"><line class="water" x1="${-w * 0.6}" y1="${h * 0.1}" x2="${w * 0.6}" y2="${h * 0.1}"/>${wake}<g class="sil" transform="translate(${-w / 2} ${-h * 0.75})">${this._use(s, w)}</g></g>
${label}</g>`;
    }).join("");
    return `<svg class="radar" viewBox="0 0 600 600" role="img" aria-label="Ships around home">
<circle class="sea" cx="${C}" cy="${C}" r="${R}"/>
<line class="axis" x1="${C}" y1="${C - R}" x2="${C}" y2="${C + R}"/><line class="axis" x1="${C - R}" y1="${C}" x2="${C + R}" y2="${C}"/>
${rings}
<text class="cp" x="${C}" y="22">N</text><text class="cp" x="580" y="${C + 5}">E</text><text class="cp" x="${C}" y="595">S</text><text class="cp" x="20" y="${C + 5}">W</text>
<circle class="homering" cx="${C}" cy="${C}" r="10"/><circle class="home" cx="${C}" cy="${C}" r="4.5"><title>Home</title></circle>
${body}</svg>`;
  }

  _list(ships) {
    return `<div class="list">${ships.map((s) => {
      const cat = CATS[s.cat] || CATS.unknown;
      return `<button class="row" data-m="${s.mmsi}">${this._thumb(s)}<b>${esc(s.name)}</b><small>${cat.label}${s.flag ? ` ${flagEmoji(s.flag)}` : ""} - ${this._motion(s)}</small><span class="ds">${this._dist(s.dist)} ${cardinal(s.brg)}</span></button>${s.mmsi === this._sel ? this._detail(s) : ""}`;
    }).join("")}</div>`;
  }

  _detail(s) {
    const cat = CATS[s.cat] || CATS.unknown;
    const rows = [
      ["Distance", `${this._dist(s.dist)} ${cardinal(s.brg)} (${s.brg}\u00b0)`],
      ["Movement", this._motion(s)],
      s.len ? ["Size", `${s.len}${s.beam ? ` \u00d7 ${s.beam}` : ""} m`] : null,
      s.dest ? ["Destination", esc(s.dest)] : null,
      ["MMSI", `<a href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${s.mmsi}" target="_blank" rel="noopener noreferrer">${s.mmsi}</a>`],
      ["Last heard", this._ago(s.age)],
    ].filter(Boolean);
    return `<section class="detail" aria-live="polite"><div class="dh">${this._thumb(s)}<div><h3>${esc(s.name)}</h3><p>${cat.label}${s.flag ? ` \u00b7 ${flagEmoji(s.flag)} ${esc(s.flag)}` : ""}</p></div><button class="x" data-close aria-label="Close details">\u00d7</button></div><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></section>`;
  }

  // ---- render --------------------------------------------------------------
  _render() {
    if (!this._cfg || !this._hass) return;
    const a0 = this.shadowRoot.activeElement;
    const refocus = a0 && a0.dataset ? (a0.dataset.m ? `[data-m="${a0.dataset.m}"]` : a0.dataset.tab ? `[data-tab="${a0.dataset.tab}"]` : null) : null;

    const st = this._st;
    let note = "", content = "", sub = "";
    if (!st) {
      note = `Entity <b>${esc(this._cfg.entity)}</b> was not found. Install and start the Ship Radar app, then check the entity name.`;
    } else {
      const at = st.attributes || {};
      const range = this._cfg.range_nm || at.radius_nm || 30;
      const ships = (at.ships || []).filter((s) => s.dist <= range && s.age <= this._cfg.max_age * 60 && (this._cfg.show_moored || !this._still(s)));
      const moving = ships.filter((s) => !this._still(s)).length;
      sub = ships.length ? `${ships.length} in range \u00b7 ${moving} under way` : "";
      const stale = at.updated ? (Date.now() - Date.parse(at.updated)) / 60000 : 0;
      if (at.error === "no_api_key") note = "Add your free AISStream API key in the Ship Radar app options, then restart the app.";
      else if (at.error === "no_location") note = "Set your Home Assistant home location, or enter latitude and longitude in the Ship Radar app options.";
      else if (at.error) note = `AISStream reported: ${esc(at.error)}. Check the API key in the app options.`;
      else if (stale > 10) note = `No update from the Ship Radar app for ${Math.round(stale)} minutes. Check that the app is running.`;
      else if (at.connected === false) note = "Connecting to AISStream\u2026";
      if (!ships.length && !note) note = `No ships heard in the last ${at.expire_minutes || 20} minutes. AISStream relies on volunteer receivers, so quiet stretches are normal in some areas.`;
      if (ships.length) {
        if (this._view === "list") content = this._list(ships);
        else content = this._radar(ships, range) + (this._sel && ships.find((s) => s.mmsi === this._sel) ? this._detail(ships.find((s) => s.mmsi === this._sel)) : "");
      }
    }
    const tab = (v, label) => `<button data-tab="${v}" aria-pressed="${this._view === v}">${label}</button>`;
    this.shadowRoot.getElementById("b").innerHTML = `<div class="top"><div><h2>${esc(this._cfg.title)}</h2><div class="sub">${sub}</div></div><div class="tabs">${tab("radar", "Radar")}${tab("list", "List")}</div></div>${note ? `<p class="note">${note}</p>` : ""}${content}`;
    if (refocus) { const el = this.shadowRoot.querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
  }
}

if (!customElements.get("ship-radar-card")) customElements.define("ship-radar-card", ShipRadarCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "ship-radar-card",
  name: "Ship Radar",
  description: "Ships near your home, drawn as silhouettes on a radar. Needs the Ship Radar app.",
});
console.info(`%c SHIP-RADAR-CARD %c ${VERSION} `, "background:#2f6f8f;color:#fff", "");
