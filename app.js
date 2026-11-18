/* O Centolo – Erinnerungen (Handy-App). Interviews aufnehmen, Fotos und Texte sammeln; Abgleich über die Drive-Brücke. */
'use strict';
const VER = 'v1';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
const p2 = n => String(n).padStart(2, '0');
const heute = () => { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
const mmss = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + p2(m) : m) + ':' + p2(s % 60); };
const datDE = s => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : (s || ''); };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
function msg(s, err) { const e = $('#toast'); e.textContent = s; e.className = err ? 'err' : ''; e.style.display = 'block'; clearTimeout(msg.t); msg.t = setTimeout(() => e.style.display = 'none', err ? 7000 : 2500); }
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };

const ROLLEN = ['Familie', 'Früher im Betrieb', 'Gast', 'Nachbar / Ort', 'Sonstige'];

/* ---------- Daten ---------- */
const leer = () => ({ format: 'centolo', version: 1, stand: 0, eintraege: [], geloescht: [] });
let D = (() => { const j = lsGet('oc_data', null); return j && Array.isArray(j.eintraege) ? j : leer(); })();
let QUIET = false;
function save() { D.stand = Date.now(); try { localStorage.setItem('oc_data', JSON.stringify(D)); } catch (e) { msg('Der Speicher im Handy ist voll. Bitte Platz schaffen.', 1); } if (!QUIET) drvSoon(4000); }
const find = id => D.eintraege.find(e => e.id === id);
const titelVon = e => e.titel || e.person || ('Eintrag vom ' + datDE(e.datum));

/* ---------- Speicher für Aufnahmen und Fotos (IndexedDB) ---------- */
let _db;
const db = () => _db || (_db = new Promise((res, rej) => { const r = indexedDB.open('oc', 1); r.onupgradeneeded = () => { r.result.createObjectStore('blobs'); r.result.createObjectStore('chunks'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
const idb = async (st, mode, f) => { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction(st, mode); const q = f(tx.objectStore(st)); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); };
const bPut = (k, v) => idb('blobs', 'readwrite', s => s.put(v, k));
const bGet = k => idb('blobs', 'readonly', s => s.get(k));
const bDel = k => idb('blobs', 'readwrite', s => s.delete(k));
const cPut = (k, v) => idb('chunks', 'readwrite', s => s.put(v, k));
const cDel = k => idb('chunks', 'readwrite', s => s.delete(k));
async function cAll() { const d = await db(); return new Promise(res => { const o = {}; const tx = d.transaction('chunks'); const r = tx.objectStore('chunks').openCursor(); r.onsuccess = () => { const c = r.result; if (c) { o[c.key] = c.value; c.continue(); } }; tx.oncomplete = () => res(o); tx.onerror = () => res(o); }); }

/* ---------- Ansicht ---------- */
let TAB = 'liste', Q = '';
function render() {
  $('#hs').textContent = 'Stoffsammlung · ' + VER;
  $('#nv').innerHTML = [['liste', '🎙 Sammlung'], ['abgleich', '☁ Abgleich']].map(([k, n]) => `<button class="${TAB === k ? 'on' : ''}" onclick="TAB='${k}';render()">${n}</button>`).join('');
  $('#m').innerHTML = TAB === 'liste' ? viewListe() : viewAbgleich();
  if (TAB === 'abgleich') drvShow();
}
function viewListe() {
  const n = D.eintraege.length, mitA = D.eintraege.filter(e => e.audio).length, mitT = D.eintraege.filter(e => (e.transkript || '').trim()).length;
  const q = Q.trim().toLowerCase();
  const L = D.eintraege.filter(e => !q || [e.titel, e.person, e.thema, e.rolle, e.notiz, e.transkript].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || (b.erstellt || 0) - (a.erstellt || 0));
  return `<button class="btn big rot" onclick="recOpen()">🎙 Interview aufnehmen</button>
  <div class="row"><button class="btn alt" style="flex:1" onclick="neuText()">✏️ Erinnerung notieren</button></div>
  ${n ? `<div class="sum">${n} ${n === 1 ? 'Eintrag' : 'Einträge'} · ${mitA} mit Aufnahme · ${mitT} mit Text</div>` : `<div class="sum">Noch nichts gesammelt. Tippe oben auf „Interview aufnehmen“, sobald das Gespräch beginnt.</div>`}
  ${n > 4 ? `<input id="q" placeholder="Suchen …" value="${esc(Q)}" oninput="Q=this.value;listeNeu()">` : ''}
  <div id="liste">${listeHtml(L)}</div>`;
}
function listeHtml(L) {
  if (!L.length) return D.eintraege.length ? '<p class="mu">Keine Treffer.</p>' : '';
  return L.map(e => `<div class="card" onclick="openDetail('${e.id}')"><b>${esc(titelVon(e))}</b><div class="mu">${datDE(e.datum)}${e.rolle ? ' · ' + esc(e.rolle) : ''}${e.thema ? ' · ' + esc(e.thema) : ''}</div>
    <div>${e.audio ? `<span class="tag">🎙 ${mmss(e.audio.sek)}</span>` : ''}${(e.transkript || '').trim() ? '<span class="tag">📝 Text</span>' : (e.audio ? '<span class="tag">noch ohne Text</span>' : '')}${(e.fotos || []).length ? `<span class="tag">📷 ${e.fotos.length}</span>` : ''}</div></div>`).join('');
}
function listeNeu() { const q = Q.trim().toLowerCase(); const L = D.eintraege.filter(e => !q || [e.titel, e.person, e.thema, e.rolle, e.notiz, e.transkript].join(' ').toLowerCase().includes(q)).sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || (b.erstellt || 0) - (a.erstellt || 0)); $('#liste').innerHTML = listeHtml(L); }
function neuEintrag(o) { const e = Object.assign({ id: uid(), titel: '', person: '', rolle: '', datum: heute(), thema: '', notiz: '', transkript: '', audio: null, fotos: [], erstellt: Date.now(), geaendert: Date.now() }, o || {}); D.eintraege.push(e); save(); return e; }
function neuText() { const e = neuEintrag(); openDetail(e.id, true); }

/* ---------- Overlay ---------- */
function ovShow(h) { const o = $('#ov'); o.innerHTML = `<div class="sheet">${h}</div>`; o.style.display = 'block'; o.scrollTop = 0; document.body.style.overflow = 'hidden'; }
function ovClose() { const o = $('#ov'); o.style.display = 'none'; o.innerHTML = ''; document.body.style.overflow = ''; if (DET && DET.url) URL.revokeObjectURL(DET.url); (DET && DET.fotoUrls || []).forEach(u => URL.revokeObjectURL(u)); DET = null; render(); }

/* ---------- Aufnahme ---------- */
let REC = { on: false };
function pickMime() { if (!window.MediaRecorder) return ''; for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported(m)) return m; return ''; }
const extOf = m => /mp4|aac|m4a/.test(m) ? 'm4a' : /ogg/.test(m) ? 'ogg' : /mpeg|mp3/.test(m) ? 'mp3' : /wav/.test(m) ? 'wav' : 'webm';
function recOpen() {
  ovShow(`<h2 style="margin-top:4px">Neues Interview</h2>
  <label>Wer spricht? (kann auch später ergänzt werden)</label><input id="rp" placeholder="Name der Person" autocomplete="off">
  <p class="mu">Das Handy bitte zwischen die Gesprächspartner legen und die App geöffnet lassen. Der Bildschirm bleibt dann an.</p>
  <div class="zeit" id="rz">0:00</div><div class="pegel"><i id="rl"></i></div>
  <div id="rb"><button class="btn big rot" onclick="recStart()">● Aufnahme starten</button><div class="row"><button class="btn grau" style="flex:1" onclick="ovClose()">Abbrechen</button></div></div>`);
}
async function recStart() {
  const person = ($('#rp') || {}).value || '';
  if (!navigator.mediaDevices || !window.MediaRecorder) { msg('Dieses Handy kann hier nicht aufnehmen. Bitte Chrome oder Safari verwenden.', 1); return; }
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); } catch (e) { msg('Das Mikrofon ist nicht freigegeben. Bitte die Freigabe erlauben und noch einmal tippen.', 1); return; }
  const mime = pickMime(); let mr;
  try { mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 }); } catch (e) { mr = new MediaRecorder(stream); }
  REC = { on: true, stream, mr, id: uid(), n: 0, parts: [], pp: [], t0: Date.now(), acc: 0, paused: false, person, mime: mr.mimeType || mime || 'audio/webm' };
  mr.ondataavailable = e => { if (e.data && e.data.size) { REC.parts.push(e.data); REC.pp.push(cPut(REC.id + ':' + String(REC.n++).padStart(6, '0'), e.data).catch(() => { })); } };
  mr.onstop = recFinish; mr.start(5000);
  try { const AC = window.AudioContext || window.webkitAudioContext; REC.ac = new AC(); const src = REC.ac.createMediaStreamSource(stream); REC.an = REC.ac.createAnalyser(); REC.an.fftSize = 512; src.connect(REC.an); REC.buf = new Uint8Array(REC.an.fftSize); } catch (e) { }
  try { REC.wl = await navigator.wakeLock.request('screen'); } catch (e) { }
  REC.timer = setInterval(recTick, 200);
  $('#rb').innerHTML = `<div class="row"><button class="btn big rot" onclick="recStop()">■ Aufnahme beenden</button></div><div class="row"><button class="btn alt" style="flex:1" id="rpz" onclick="recPause()">⏸ Pause</button></div>`;
  $('#rp').disabled = true;
}
const recSek = () => (REC.acc + (REC.paused ? 0 : Date.now() - REC.t0)) / 1000;
function recTick() {
  const z = $('#rz'); if (z) z.textContent = mmss(recSek());
  if (REC.an) { REC.an.getByteTimeDomainData(REC.buf); let m = 0; for (const v of REC.buf) m = Math.max(m, Math.abs(v - 128)); const l = $('#rl'); if (l) l.style.width = Math.min(100, m * 1.6) + '%'; }
}
function recPause() {
  if (!REC.on) return;
  if (!REC.paused) { REC.mr.pause(); REC.acc += Date.now() - REC.t0; REC.paused = true; $('#rpz').textContent = '▶ Weiter aufnehmen'; }
  else { REC.mr.resume(); REC.t0 = Date.now(); REC.paused = false; $('#rpz').textContent = '⏸ Pause'; }
}
function recStop() { if (!REC.on) return; const s = Math.round(recSek()); REC.sek = s; REC.on = false; clearInterval(REC.timer); try { if (REC.mr.state !== 'inactive') REC.mr.stop(); } catch (e) { recFinish(); } }
async function recFinish() {
  const R = REC; try { R.stream.getTracks().forEach(t => t.stop()); } catch (e) { } try { R.ac && R.ac.close(); } catch (e) { } try { R.wl && R.wl.release(); } catch (e) { }
  await Promise.all(R.pp);
  const blob = new Blob(R.parts, { type: R.mime.split(';')[0] });
  if (!blob.size) { msg('Es wurde nichts aufgenommen.', 1); ovClose(); return; }
  const aid = uid(), ext = extOf(R.mime);
  const e = neuEintrag({ person: R.person, audio: { id: aid, name: 'aufnahme-' + aid + '.' + ext, mime: blob.type, size: blob.size, sek: R.sek || 0 } });
  await bPut(aid, blob);
  for (let i = 0; i < R.n; i++) await cDel(R.id + ':' + String(i).padStart(6, '0')).catch(() => { });
  REC = { on: false };
  msg('Aufnahme gespeichert.'); openDetail(e.id);
}
async function recRetten() {
  const all = await cAll(), ids = {};
  for (const k of Object.keys(all)) { const [r] = k.split(':'); (ids[r] = ids[r] || []).push(k); }
  for (const r of Object.keys(ids)) {
    if (REC.on && REC.id === r) continue;
    const keys = ids[r].sort();
    if (D.eintraege.some(e => e.audio && e.audio.id === r) || await bGet(r)) { for (const k of keys) await cDel(k).catch(() => { }); continue; }
    const blob = new Blob(keys.map(k => all[k]), { type: all[keys[0]].type || 'audio/webm' });
    if (!blob.size) continue;
    const e = neuEintrag({ titel: 'Gerettete Aufnahme', audio: { id: r, name: 'aufnahme-' + r + '.' + extOf(blob.type), mime: blob.type, size: blob.size, sek: Math.round(blob.size / 4000) } });
    await bPut(r, blob); for (const k of keys) await cDel(k).catch(() => { });
    msg('Eine unterbrochene Aufnahme wurde gerettet.');
  }
  render();
}

/* ---------- Eintrag ansehen und bearbeiten ---------- */
let DET = null;
async function openDetail(id) {
  const e = find(id); if (!e) return;
  const blob = e.audio ? await bGet(e.audio.id).catch(() => null) : null;
  DET = { id, blob, url: blob ? URL.createObjectURL(blob) : '', file: blob ? new File([blob], e.audio.name, { type: blob.type || e.audio.mime }) : null, fotoUrls: [], fotoSrc: {} };
  for (const f of e.fotos || []) { const b = await bGet(f.id).catch(() => null); if (b) { const u = URL.createObjectURL(b); DET.fotoUrls.push(u); DET.fotoSrc[f.id] = u; } }
  detHtml();
}
function detHtml() {
  const e = find(DET.id); if (!e) return;
  const audio = e.audio ? (DET.blob ? `<audio controls preload="metadata" src="${DET.url}"></audio><div class="row"><button class="btn alt s" onclick="detSenden()">Aufnahme senden / speichern</button></div>`
    : `<div class="sum">Die Aufnahme liegt auf dem Gerät, mit dem sie gemacht wurde, und in Google Drive (${esc(e.audio.name)}).</div>`)
    : `<div class="row"><label class="btn alt s" style="margin:0">🎙 Aufnahme aus Datei hinzufügen<input type="file" accept="audio/*,video/*" style="display:none" onchange="detAudioDatei(this)"></label></div>`;
  ovShow(`<div class="row"><button class="btn s" onclick="ovClose()">← Fertig</button><span class="mu" style="flex:1;text-align:right">wird von selbst gespeichert</span></div>
  <label>Überschrift</label><input value="${esc(e.titel)}" placeholder="${esc(titelVon(e))}" oninput="dSet('titel',this.value)">
  <label>Wer spricht?</label><input value="${esc(e.person)}" oninput="dSet('person',this.value)" placeholder="Name der Person">
  <div class="row"><div style="flex:1;min-width:140px"><label>Wer ist das?</label><select onchange="dSet('rolle',this.value)"><option value="">–</option>${ROLLEN.map(r => `<option ${e.rolle === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
  <div style="flex:1;min-width:140px"><label>Datum</label><input type="date" value="${esc(e.datum)}" onchange="dSet('datum',this.value)"></div></div>
  <label>Thema / Zeit</label><input value="${esc(e.thema)}" oninput="dSet('thema',this.value)" placeholder="z. B. Die erste Bar, 1968">
  <h3 style="margin:22px 0 4px">Aufnahme</h3>${audio}
  <h3 style="margin:22px 0 4px">Text</h3>
  <p class="mu" style="margin:0 0 6px">Aufnahme bei Gemini hochladen, den fertigen Text kopieren und hier einfügen.</p>
  <div class="row"><button class="btn alt s" onclick="detEinfuegen()">📋 Text einfügen</button></div>
  <textarea id="dt" style="min-height:220px" oninput="dSet('transkript',this.value)" placeholder="Hier steht der Text des Gesprächs oder die Erinnerung zum Eintippen.">${esc(e.transkript)}</textarea>
  <h3 style="margin:22px 0 4px">Fotos</h3>
  <div id="df">${fotosHtml(e)}</div>
  <div class="row"><label class="btn alt s" style="margin:0">📷 Foto hinzufügen<input type="file" accept="image/*" multiple style="display:none" onchange="detFoto(this)"></label></div>
  <label>Notizen (nur für uns)</label><textarea oninput="dSet('notiz',this.value)" placeholder="Was war wichtig? Was nachfragen?">${esc(e.notiz)}</textarea>
  <div class="row" style="margin-top:26px"><button class="btn grau s" id="dl" onclick="detLoeschen()">Eintrag löschen</button></div>`);
}
const fotosHtml = e => (e.fotos || []).map(f => `<div class="foto">${DET.fotoSrc[f.id] ? `<img src="${DET.fotoSrc[f.id]}">` : '<div class="mu" style="width:84px">Foto auf anderem Gerät</div>'}<div style="flex:1"><input value="${esc(f.text)}" placeholder="Wer oder was ist zu sehen? Jahr?" oninput="fSet('${f.id}',this.value)"><button class="btn grau s" style="margin-top:6px" onclick="fDel('${f.id}')">Foto entfernen</button></div></div>`).join('');
let dT; function dSet(k, v) { const e = find(DET.id); if (!e) return; e[k] = v; e.geaendert = Date.now(); clearTimeout(dT); dT = setTimeout(save, 400); }
function fSet(id, v) { const e = find(DET.id); const f = e.fotos.find(x => x.id === id); if (f) { f.text = v; e.geaendert = Date.now(); clearTimeout(dT); dT = setTimeout(save, 400); } }
async function fDel(id) { const e = find(DET.id); e.fotos = e.fotos.filter(x => x.id !== id); e.geaendert = Date.now(); await bDel(id).catch(() => { }); save(); $('#df').innerHTML = fotosHtml(e); }
async function detEinfuegen() {
  let tx = ''; try { tx = await navigator.clipboard.readText(); } catch (e) { msg('Das Einfügen wurde vom Handy nicht erlaubt. Bitte lange in das Textfeld tippen und „Einfügen“ wählen.', 1); return; }
  if (!tx.trim()) { msg('In der Zwischenablage steht kein Text.', 1); return; }
  const e = find(DET.id), a = $('#dt'); e.transkript = (e.transkript || '').trim() ? e.transkript.replace(/\s+$/, '') + '\n\n' + tx : tx; a.value = e.transkript; e.geaendert = Date.now(); save(); msg('Text eingefügt.');
}
function detSenden() {
  const e = find(DET.id), f = DET.file;
  if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f], title: titelVon(e) }).catch(() => { }); return; }
  const a = document.createElement('a'); a.href = DET.url; a.download = e.audio.name; document.body.appendChild(a); a.click(); a.remove(); msg('Die Aufnahme wurde im Handy gespeichert (Ordner „Downloads“).');
}
async function detAudioDatei(inp) {
  const f = inp.files[0]; if (!f) return; const e = find(DET.id), aid = uid();
  const ext = extOf(f.type || f.name), name = 'aufnahme-' + aid + '.' + ext;
  await bPut(aid, f); const sek = await dauer(f);
  e.audio = { id: aid, name, mime: f.type || 'audio/' + ext, size: f.size, sek }; e.geaendert = Date.now(); save(); msg('Aufnahme hinzugefügt.'); openDetail(e.id);
}
function dauer(b) { return new Promise(res => { const a = new Audio(), u = URL.createObjectURL(b); a.preload = 'metadata'; a.onloadedmetadata = () => { res(isFinite(a.duration) ? Math.round(a.duration) : 0); URL.revokeObjectURL(u); }; a.onerror = () => { res(0); URL.revokeObjectURL(u); }; a.src = u; setTimeout(() => res(0), 4000); }); }
function verkleinern(file, max) {
  return new Promise((res, rej) => { const u = URL.createObjectURL(file), im = new Image(); im.onload = () => { const s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob(b => b ? res(b) : rej(new Error('Foto')), 'image/jpeg', 0.85); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Foto')); }; im.src = u; });
}
async function detFoto(inp) {
  const e = find(DET.id);
  for (const f of [...inp.files]) {
    try { const b = await verkleinern(f, 2048), id = uid(); await bPut(id, b); e.fotos = e.fotos || []; e.fotos.push({ id, name: 'foto-' + id + '.jpg', text: '' }); const u = URL.createObjectURL(b); DET.fotoUrls.push(u); DET.fotoSrc[id] = u; } catch (x) { msg('Ein Foto konnte nicht gelesen werden.', 1); }
  }
  e.geaendert = Date.now(); save(); $('#df').innerHTML = fotosHtml(e); inp.value = '';
}
function detLoeschen() {
  const b = $('#dl'); if (b.dataset.s !== '1') { b.dataset.s = '1'; b.textContent = 'Wirklich löschen? Nochmal tippen'; b.style.color = '#b3261e'; setTimeout(() => { if (b && b.isConnected) { b.dataset.s = ''; b.textContent = 'Eintrag löschen'; b.style.color = ''; } }, 4000); return; }
  const e = find(DET.id); if (e.audio) bDel(e.audio.id).catch(() => { }); (e.fotos || []).forEach(f => bDel(f.id).catch(() => { }));
  D.eintraege = D.eintraege.filter(x => x.id !== e.id); D.geloescht.push({ id: e.id, t: Date.now() }); save(); ovClose(); msg('Gelöscht.');
}

/* ---------- Abgleich mit Google Drive ---------- */
const URL0 = 'https://script.google.com/macros/s/AKfycbwXl6wvYj9gMHTHwL0wfTCqcwdtAe8Tp5fnYUGtbuVEzkg8leIUlgnIh4cj-wyznfE/exec';
const DRV = { app: 'centolo', url: (() => { try { return localStorage.getItem('oc_url') || URL0; } catch (e) { return URL0; } })(), busy: false, t: null, st: '' };
const drvPost = async b => { const r = await fetch(DRV.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ app: DRV.app }, b)) }); const j = await r.json(); if (!j.ok) throw new Error(j.err || 'Fehler'); return j; };
const drvGetF = async f => { const r = await fetch(DRV.url + (DRV.url.includes('?') ? '&' : '?') + 'a=get&app=' + DRV.app + '&f=' + encodeURIComponent(f) + '&_=' + Date.now()); const j = await r.json(); return j.ok ? JSON.parse(j.text) : null; };
const toB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
function drvSoon(ms) { if (!DRV.url) return; clearTimeout(DRV.t); DRV.t = setTimeout(() => drvSync(), ms || 3000); }
function drvShow() { const e = $('#drvst'); if (e) e.textContent = DRV.st; }
function viewAbgleich() {
  return `<div class="sum"><b>Automatischer Abgleich mit Google Drive</b><div class="mu" id="drvst">${esc(DRV.st || (DRV.url ? '' : 'Noch nicht verbunden.'))}</div>
  <p class="mu">Aufnahmen, Fotos und Texte wandern von selbst in den Drive-Ordner „Centolo-Interviews“. Zu jedem Eintrag liegt dort eine Textdatei mit dem Transkript.</p>
  <label>Verbindungsadresse (einmalig eintragen)</label><input id="drvurl" value="${esc(DRV.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off" autocorrect="off" spellcheck="false">
  <div class="row"><button class="btn" onclick="drvSetze()">${DRV.url ? 'Jetzt abgleichen' : 'Verbinden'}</button></div></div>`;
}
function drvSetze() {
  const u = ($('#drvurl').value || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) { msg('Das ist keine gültige Verbindungsadresse.', 1); return; }
  DRV.url = u; try { localStorage.setItem('oc_url', u); } catch (e) { } DRV.st = 'Abgleich läuft …'; drvShow(); drvSync(true);
}
const mdText = e => {
  const L = ['# ' + titelVon(e), '', '- Person: ' + (e.person || ''), '- Rolle: ' + (e.rolle || ''), '- Datum: ' + datDE(e.datum), '- Thema: ' + (e.thema || '')];
  if (e.audio) L.push('- Aufnahme: ' + e.audio.name + ' (' + mmss(e.audio.sek) + ')');
  (e.fotos || []).forEach(f => L.push('- Foto: ' + f.name + (f.text ? ' – ' + f.text : '')));
  if ((e.notiz || '').trim()) L.push('', '## Notizen', '', e.notiz.trim());
  L.push('', '## Transkript', '', (e.transkript || '').trim() || '(noch kein Text)', '');
  return L.join('\n');
};
function mergeMaster(m) {
  let ch = false;
  for (const g of m.geloescht || []) { if (!D.geloescht.some(x => x.id === g.id)) { D.geloescht.push(g); ch = true; } const l = find(g.id); if (l && (l.geaendert || 0) <= g.t) { D.eintraege = D.eintraege.filter(x => x.id !== g.id); ch = true; } }
  for (const r of m.eintraege || []) {
    if (D.geloescht.some(g => g.id === r.id && g.t >= (r.geaendert || 0))) continue;
    const l = find(r.id);
    if (!l) { D.eintraege.push(r); ch = true; } else if ((r.geaendert || 0) > (l.geaendert || 0)) { Object.assign(l, r); ch = true; }
  }
  return ch;
}
async function drvSync(manuell) {
  if (!DRV.url || DRV.busy || (document.hidden && !manuell)) return;
  if (REC.on) return;
  if (DET) { clearTimeout(DRV.t); DRV.t = setTimeout(() => drvSync(), 6000); return; }
  DRV.busy = true; let neu = false;
  try {
    DRV.st = 'Abgleich läuft …'; drvShow();
    const m = await drvGetF('centolo-daten.json');
    if (m && Array.isArray(m.eintraege)) { QUIET = true; neu = mergeMaster(m); if (neu) save(); QUIET = false; }
    const P = lsGet('oc_pf', {});
    for (const e of D.eintraege) {
      if (e.audio) { const k = e.audio.name + ':' + e.audio.size; if (!P[k]) { const b = await bGet(e.audio.id).catch(() => null); if (b) { DRV.st = 'Aufnahme wird übertragen …'; drvShow(); await drvPost({ name: e.audio.name, b64: await toB64(b) }); P[k] = 1; lsSet('oc_pf', P); } } }
      for (const f of e.fotos || []) { if (!P[f.name]) { const b = await bGet(f.id).catch(() => null); if (b) { await drvPost({ name: f.name, b64: await toB64(b) }); P[f.name] = 1; lsSet('oc_pf', P); } } }
    }
    const H = lsGet('oc_pushed', {});
    for (const e of D.eintraege) { const md = mdText(e), h = hash(md); if (H[e.id] !== h) { await drvPost({ name: 'interview-' + e.id + '.md', text: md }); H[e.id] = h; lsSet('oc_pushed', H); } }
    const mh = hash(JSON.stringify({ e: D.eintraege, g: D.geloescht }));
    if (lsGet('oc_mpushed', '') !== mh) { await drvPost({ name: 'centolo-daten.json', text: JSON.stringify(D) }); lsSet('oc_mpushed', mh); }
    const z = new Date(); DRV.st = 'Verbunden. Letzter Abgleich: ' + p2(z.getHours()) + ':' + p2(z.getMinutes());
    if (neu && !DET && !REC.on) render();
  } catch (e) { QUIET = false; DRV.st = 'Verbindung fehlgeschlagen: ' + (e && e.message || e); }
  DRV.busy = false; drvShow();
}

/* ---------- Start ---------- */
render();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }
recRetten().catch(() => { });
setTimeout(() => drvSync(), 1500); setInterval(() => drvSync(), 45000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) drvSoon(800); });
