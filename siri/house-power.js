// House Power: Sunsynk live power for Siri, Shortcuts and a home-screen widget.
// Runs in the Scriptable app (iOS). Your Sunsynk Connect login is stored in the iPhone
// Keychain the first time you run it; nothing is stored in this file.
//
// Siri / Shortcuts: returns a spoken summary as the shortcut result.
// Widget: shows solar, battery, grid and house, refreshing about every 5 minutes.
// Pass "reset" as the shortcut parameter (or run it in the app and choose Log out) to clear the saved login.

const API = "https://api.sunsynk.net";
const KC = { user: "sunsynk_user", pass: "sunsynk_pass", token: "sunsynk_token", plant: "sunsynk_plant" };

// ---------- small helpers ----------
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const truthy = v => v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
const pad = n => String(n).padStart(2, "0");
const dayKey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const kcGet = k => (Keychain.contains(k) ? Keychain.get(k) : null);

function spokenPower(w) {
  w = Math.abs(w);
  if (w < 1000) return Math.round(w) + " watts";
  const kw = (w / 1000).toFixed(1).replace(/\.0$/, "");
  return kw + (kw === "1" ? " kilowatt" : " kilowatts");
}
function shortPower(w) {
  w = Math.abs(w);
  return w < 1000 ? Math.round(w) + " W" : (w / 1000).toFixed(1) + " kW";
}
// same rules as the dashboard: tiny power is idle, then the direction flags, then the sign
function battDir(f) {
  const p = num(f.battPower);
  if (Math.abs(p) < 30) return "idle";
  if (truthy(f.toBat)) return "charging";
  if (truthy(f.batTo)) return "discharging";
  return p < 0 ? "charging" : "discharging";
}
function gridDir(f) {
  const p = num(f.gridOrMeterPower);
  if (Math.abs(p) < 30) return "idle";
  if (truthy(f.gridTo)) return "importing";
  if (truthy(f.toGrid)) return "exporting";
  return p > 0 ? "importing" : "exporting";
}

// ---------- login ----------
// MD5 and RSA aren't built into Scriptable, so they run in a hidden web view with two
// well-known libraries from cdnjs (the same ones the dashboard uses).
let cryptoView = null;
async function webCrypto(js) {
  if (!cryptoView) {
    cryptoView = new WebView();
    await cryptoView.loadHTML(
      '<script src="https://cdnjs.cloudflare.com/ajax/libs/jsencrypt/3.3.2/jsencrypt.min.js"></script>' +
      '<script src="https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js"></script>'
    );
  }
  return await cryptoView.evaluateJavaScript(js);
}
const md5 = s => webCrypto("CryptoJS.MD5(" + JSON.stringify(s) + ").toString()");

async function askLogin() {
  const a = new Alert();
  a.title = "Sunsynk Connect login";
  a.message = "Saved in your iPhone Keychain, only used to talk to Sunsynk.";
  a.addTextField("Email", kcGet(KC.user) || "");
  a.addSecureTextField("Password", "");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  if ((await a.presentAlert()) === -1) throw new Error("Login cancelled.");
  Keychain.set(KC.user, a.textFieldValue(0).trim());
  Keychain.set(KC.pass, a.textFieldValue(1));
}

async function login() {
  let user = kcGet(KC.user), pass = kcGet(KC.pass);
  if (!user || !pass) {
    if (config.runsInWidget || config.runsWithSiri) throw new Error("Open the House Power script in Scriptable once to log in.");
    await askLogin();
    user = kcGet(KC.user); pass = kcGet(KC.pass);
  }
  // 1) public key
  const n1 = Date.now();
  const r1 = new Request(API + "/anonymous/publicKey?source=sunsynk&nonce=" + n1 + "&sign=" + (await md5("nonce=" + n1 + "&source=sunsynkPOWER_VIEW")));
  const j1 = await r1.loadJSON();
  if (j1.code !== 0 || typeof j1.data !== "string") throw new Error("Couldn't reach Sunsynk (" + (j1.msg || "no key") + ").");
  const key = j1.data;
  // 2) encrypt the password and sign the request
  const n2 = Date.now();
  const pem = "-----BEGIN PUBLIC KEY-----\n" + key + "\n-----END PUBLIC KEY-----";
  const enc = await webCrypto("(function(){var e=new JSEncrypt();e.setPublicKey(" + JSON.stringify(pem) + ");return e.encrypt(" + JSON.stringify(pass) + ")||''})()");
  if (!enc) throw new Error("Couldn't encrypt the password.");
  const sign = await md5("nonce=" + n2 + "&source=sunsynk" + key.slice(0, 10));
  const r2 = new Request(API + "/oauth/token/new");
  r2.method = "POST";
  r2.headers = { "Content-Type": "application/json" };
  r2.body = JSON.stringify({ client_id: "csp-web", grant_type: "password", username: user, password: enc, source: "sunsynk", nonce: n2, sign });
  const j2 = await r2.loadJSON();
  if (!j2.data || !j2.data.access_token) {
    if (j2.code === 102) Keychain.remove(KC.pass); // wrong email/password: ask again next time
    throw new Error("Sunsynk login failed: " + (j2.msg || "unknown error") + ".");
  }
  const tok = { t: j2.data.access_token, exp: Date.now() + (num(j2.data.expires_in) || 86400) * 1000 - 60000 };
  Keychain.set(KC.token, JSON.stringify(tok));
  return tok.t;
}

async function token(force) {
  if (!force) {
    try { const s = JSON.parse(kcGet(KC.token) || "null"); if (s && s.t && s.exp > Date.now()) return s.t; } catch (e) {}
  }
  return await login();
}

async function api(path, retried) {
  const r = new Request(API + path);
  r.headers = { "Content-Type": "application/json", Authorization: "Bearer " + (await token(retried)) };
  let j;
  try { j = await r.loadJSON(); } catch (e) { j = {}; }
  const status = r.response && r.response.statusCode;
  if ((status === 401 || j.code === 401 || (j.code !== 0 && /token|auth|login/i.test(j.msg || ""))) && !retried) return api(path, true);
  if (j.code !== 0 && j.success !== true) throw new Error("Sunsynk: " + (j.msg || "HTTP " + status));
  return j.data;
}

async function plantId() {
  const saved = kcGet(KC.plant);
  if (saved) return saved;
  const d = await api("/api/v1/plants?page=1&limit=20&name=&status=");
  const p = d && d.infos && d.infos[0];
  if (!p) throw new Error("No plant found on this Sunsynk account.");
  Keychain.set(KC.plant, String(p.id));
  return String(p.id);
}

// today's kWh so far, from the month totals
async function todayTotals(id) {
  const now = new Date(), ym = dayKey(now).slice(0, 7), today = dayKey(now);
  const d = await api("/api/v1/plant/energy/" + id + "/month?lan=en&date=" + ym + "&id=" + id);
  const out = {};
  (d && d.infos || []).forEach(s => {
    const l = String(s.label || "").toLowerCase();
    const f = /discharg/.test(l) ? "dis" : /charg/.test(l) ? "chg" : /export|sell/.test(l) ? "sell"
            : /import|buy|purchas/.test(l) ? "buy" : /pv|solar|production/.test(l) ? "pv" : /load|consum/.test(l) ? "load" : null;
    if (!f) return;
    (s.records || []).forEach(rec => {
      let t = String(rec.time || "");
      if (/^\d{1,2}$/.test(t)) t = ym + "-" + pad(t);
      if (t.slice(0, 10) === today) out[f] = num(rec.value);
    });
  });
  return out;
}

// ---------- build the summary ----------
async function summary() {
  const id = await plantId();
  const f = await api("/api/v1/plant/energy/" + id + "/flow?date=" + dayKey(new Date()));
  let tot = {};
  try { tot = await todayTotals(id); } catch (e) {}
  const pv = num(f.pvPower), load = num(f.loadOrEpsPower), batt = num(f.battPower), grid = num(f.gridOrMeterPower), soc = Math.round(num(f.soc));
  const b = battDir(f), g = gridDir(f);

  const parts = [];
  parts.push(pv > 50 ? "Solar is producing " + spokenPower(pv) + "." : "There's no solar right now.");
  parts.push("The battery is at " + soc + " percent" + (b === "idle" ? " and idle." : " and " + b + " at " + spokenPower(batt) + "."));
  parts.push(g === "idle" ? (grid > 10 ? "The grid is only trickling " + spokenPower(grid) + "." : "The grid is idle.")
                          : "The grid is " + (g === "importing" ? "supplying " : "taking ") + spokenPower(grid) + ".");
  parts.push("The house is using " + spokenPower(load) + ".");
  if (tot.pv != null || tot.buy != null) {
    const k = v => (v == null ? "?" : (Math.round(v * 10) / 10).toString().replace(/\.0$/, ""));
    parts.push("Today so far: " + k(tot.pv) + " kilowatt-hours of solar and " + k(tot.buy) + " from the grid.");
  }
  return { text: parts.join(" "), pv, load, batt, grid, soc, b, g, tot };
}

// ---------- widget ----------
function buildWidget(s, err) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#151514");
  w.setPadding(14, 14, 14, 14);
  const title = w.addText("HOME SOLAR");
  title.font = Font.semiboldSystemFont(10); title.textColor = new Color("#8d8c85");
  w.addSpacer(6);
  if (err) {
    const t = w.addText(err); t.font = Font.systemFont(12); t.textColor = new Color("#f0efec");
  } else {
    const row = (label, value, color) => {
      const st = w.addStack(); st.centerAlignContent();
      const dot = st.addText("●"); dot.font = Font.systemFont(9); dot.textColor = new Color(color);
      st.addSpacer(5);
      const l = st.addText(label); l.font = Font.systemFont(12); l.textColor = new Color("#c3c2b7");
      st.addSpacer();
      const v = st.addText(value); v.font = Font.mediumSystemFont(13); v.textColor = new Color("#f0efec");
      w.addSpacer(4);
    };
    row("Solar", shortPower(s.pv), "#c98500");
    row("Battery " + s.soc + "%", (s.b === "charging" ? "▲ " : s.b === "discharging" ? "▼ " : "") + shortPower(s.batt), "#199e70");
    row("Grid", s.g === "idle" && s.grid <= 10 ? "idle" : shortPower(s.grid), "#9085e9");
    row("House", shortPower(s.load), "#f0efec");
  }
  w.addSpacer();
  const u = w.addDate(new Date()); u.applyTimeStyle(); u.font = Font.systemFont(9); u.textColor = new Color("#8d8c85");
  w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);
  w.url = "https://mjk1252.github.io/solar-dashboard/";
  return w;
}

// ---------- run ----------
const param = String(args.shortcutParameter || args.widgetParameter || "").toLowerCase();
if (param === "reset") {
  Object.values(KC).forEach(k => { if (Keychain.contains(k)) Keychain.remove(k); });
  Script.setShortcutOutput("House Power login cleared. Run the script in Scriptable to log in again.");
  Script.complete();
} else {
  let s = null, err = null;
  try { s = await summary(); } catch (e) { err = String(e.message || e); }

  if (config.runsInWidget) {
    Script.setWidget(buildWidget(s, err));
  } else if (config.runsWithSiri || config.runsFromShortcut) {
    Script.setShortcutOutput(err ? "Sorry, " + err : s.text);
  } else {
    // opened in the Scriptable app: show the result, offer a preview and log out
    const a = new Alert();
    a.title = err ? "House Power" : "House power now";
    a.message = err || s.text;
    a.addAction("OK");
    if (!err) a.addAction("Preview widget");
    a.addDestructiveAction("Log out");
    const i = await a.presentAlert();
    if (!err && i === 1) await buildWidget(s, null).presentSmall();
    if (i === (err ? 1 : 2)) Object.values(KC).forEach(k => { if (Keychain.contains(k)) Keychain.remove(k); });
  }
  Script.complete();
}
