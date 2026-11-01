/* Interprete delle spese: frasi dettate in italiano e testo letto dagli scontrini.
   Nessun servizio esterno: tutto gira sul telefono. */
(function (root) {
  "use strict";

  const pad = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };

  const MESI = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
  const GIORNI = ["domenica","lunedì","martedì","mercoledì","giovedì","venerdì","sabato"];
  const GIORNI_RX = ["domenica","luned[iì]","marted[iì]","mercoled[iì]","gioved[iì]","venerd[iì]","sabato"];

  // ---- categorie per parole chiave ----
  const KEYS = {
    spesa: ["supermercat", "spesa", "esselunga", "coop", "conad", "carrefour", "lidl", "eurospin", "pam ", "panorama", "bennet",
      "iper", "despar", "eurospar", "aldi", "penny", "crai", "tigre", "famila", "basko", "unes", "naturasi", "md ", "in's",
      "alimentari", "mercato", "panetteria", "panificio", "forno", "macelleria", "salumeria", "pescheria", "fruttivendolo",
      "frutta", "verdura", "latte", "pane", "drogheria", "gastronomia", "discount"],
    pasti: ["ristorante", "pizzeria", "pizza", "trattoria", "osteria", "bar ", "bar,", "caffè", "caffe", "colazione", "pranzo",
      "cena", "aperitivo", "apericena", "sushi", "kebab", "mcdonald", "burger", "panino", "piadina", "gelato", "gelateria",
      "pasticceria", "asporto", "deliveroo", "glovo", "just eat", "justeat", "tavola calda", "rosticceria", "coperto", "birreria", "pub"],
    casa: ["bolletta", "luce", "gas", "acqua", "enel", "iren", "hera", "a2a", "eni plenitude", "tari", "condominio", "ferramenta",
      "leroy", "brico", "obi", "ikea", "mondo convenienza", "arredamento", "mobili", "detersiv", "pulizia", "elettricista",
      "idraulico", "riparazione", "manutenzione", "lampadin", "casalinghi", "internet", "fibra", "tim ", "fastweb", "vodafone casa"]
  };
  function guessCat(text, fallback) {
    const t = " " + String(text).toLowerCase() + " ";
    let best = null, score = 0;
    for (const [cat, words] of Object.entries(KEYS)) {
      let s = 0; for (const w of words) if (t.includes(w)) s++;
      if (s > score) { score = s; best = cat; }
    }
    return best || fallback || "extra";
  }

  // ---- date nelle frasi ----
  function resolveDay(day, month, year, today) {
    let y = year != null ? year : today.getFullYear();
    let m = month != null ? month : today.getMonth();
    let d = new Date(y, m, day);
    if (d.getMonth() !== m || d.getDate() !== day) return null;
    if (d > today && year == null) {
      if (month == null) d = new Date(y, m - 1, day); else d = new Date(y - 1, m, day);
    }
    if (d > today) return null;
    return d;
  }

  // Cerca un'espressione di data nel testo; restituisce {date, rest} dove rest è il testo senza la data.
  function takeDate(text, today) {
    let t = text;
    const rules = [
      [/\b(?:l['’ ]?\s*altro\s*ieri|altroieri|avantieri)\b/i, () => addDays(today, -2)],
      [/\bieri\b/i, () => addDays(today, -1)],
      [/\boggi\b/i, () => today],
      [new RegExp(`(?<![a-zà-ù])(?:(?:il|la|lo)\\s+)?(?:(?:scors[oa])\\s+)?(${GIORNI_RX.join("|")})(?![a-zà-ù])(?:\\s+scors[oa]\\b)?`, "i"), m => {
        const word = m[1].toLowerCase();
        let idx = GIORNI_RX.findIndex(g => new RegExp(`^${g}$`, "i").test(word));
        if (idx < 0) return null;
        let diff = (today.getDay() - idx + 7) % 7;
        if (/scors/i.test(m[0]) && diff === 0) diff = 7;
        return addDays(today, -diff);
      }],
      [/\b(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\s*[\/.\-]\s*(\d{2,4}))?\b/, m => {
        let y = m[3] ? +m[3] : null; if (y != null && y < 100) y += 2000;
        return resolveDay(+m[1], +m[2] - 1, y, today);
      }],
      [new RegExp(`\\b(?:il\\s+|l['’]\\s*)?(\\d{1,2})\\s+(?:di\\s+)?(${MESI.join("|")})\\b`, "i"), m =>
        resolveDay(+m[1], MESI.indexOf(m[2].toLowerCase()), null, today)],
      [/\b(?:il\s+giorno|il|l['’])\s*(\d{1,2})\b(?!\s*(?:euro|eur|€|[,.]\d))/i, m => resolveDay(+m[1], null, null, today)]
    ];
    for (const [rx, fn] of rules) {
      const m = t.match(rx);
      if (!m) continue;
      const d = fn(m);
      if (!d) continue;
      t = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length);
      return { date: iso(d), rest: t };
    }
    return { date: null, rest: t };
  }

  // ---- importi ----
  // 38 | 38,50 | 38.50 | 1.200 | 38 euro | 38 euro e 50 | 62 e 40 | 38€
  const AMT = /(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2})(?!\d))?(?:\s*(euro|eur|€)(?:\s+e\s+(\d{1,2})(?!\d)(?!\s*(?:euro|eur|€))(?:\s*(?:centesimi|cent))?)?|\s+e\s+(\d{1,2})(?!\d)(?!\s*(?:euro|eur|€))(?:\s*(?:centesimi|cent))?)?/gi;
  const NUM_WORDS = { "un": 1, "uno": 1, "una": 1, "due": 2, "tre": 3, "quattro": 4, "cinque": 5, "sei": 6, "sette": 7, "otto": 8, "nove": 9, "dieci": 10,
    "venti": 20, "trenta": 30, "quaranta": 40, "cinquanta": 50, "cento": 100 };

  function amountsIn(text) {
    const out = []; let m;
    AMT.lastIndex = 0;
    while ((m = AMT.exec(text))) {
      const euros = parseInt(m[1].replace(/\./g, ""), 10);
      const centsStr = m[2] || m[4] || m[5];
      let cents = euros * 100;
      if (centsStr) cents += centsStr.length === 1 ? parseInt(centsStr, 10) * 10 : parseInt(centsStr, 10);
      out.push({ cents, start: m.index, end: m.index + m[0].length, strong: !!(m[2] || m[3] || m[4] || m[5]) });
    }
    return out;
  }

  const FILLER = /^(?:e|ed|poi|anche|ho|speso|pagato|ho speso|ho pagato|spesi|per|di|da|al|alla|allo|ai|alle|agli|il|la|lo|le|i|gli|un|una|uno|in|a|con|euro|totale|più|piu|circa)$/i;
  function cleanNote(s) {
    let words = s.replace(/[€:;()"]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    while (words.length && FILLER.test(words[0])) words.shift();
    while (words.length && FILLER.test(words[words.length - 1])) words.pop();
    const note = words.join(" ").slice(0, 40);
    return note ? note[0].toUpperCase() + note.slice(1) : "";
  }

  // ---- chi ha pagato e come si divide (spese di coppia) ----
  const L = "(?<![a-zà-ù])", R = "(?![a-zà-ù])";
  const NOMI = { alice: "(?:ali|alice)", matteo: "(?:matteo|matte|teo)" };
  const rx = s => new RegExp(L + s + R, "i");
  const PAYER = [
    ["comune", rx("(?:pagat[aoei]\\s+)?(?:(?:da|dal|dalla|con|col|con\\s+il|con\\s+la|sul)\\s+)?(?:il\\s+|la\\s+)?(?:conto|carta)\\s+(?:in\\s+)?(?:comune|cointestat[ao])")],
    ["comune", rx("(?:dal|col|con\\s+il)\\s+comune")],
    ["alice", rx("(?:pagat[aoei]\\s+da\\s+" + NOMI.alice + "|" + NOMI.alice + "\\s+ha\\s+pagato|(?:l['’]\\s*)?ha\\s+pagat[aoei]\\s+" + NOMI.alice + ")")],
    ["matteo", rx("(?:pagat[aoei]\\s+da\\s+" + NOMI.matteo + "|" + NOMI.matteo + "\\s+ha\\s+pagato|(?:l['’]\\s*)?ha\\s+pagat[aoei]\\s+" + NOMI.matteo + ")")],
    ["me", rx("(?:pagat[aoei]\\s+da\\s+me|(?:l['’]\\s*)?ho\\s+pagat[aoei](?:\\s+io)?|pago\\s+io|ho\\s+pagato)")]
  ];
  const SPLIT = [
    ["alice", rx("(?:tutt[aoei]\\s+(?:di|a|ad|per)\\s+" + NOMI.alice + "|(?:spetta|tocca)\\s+(?:tutt[aoei]\\s+)?(?:ad?\\s+)?" + NOMI.alice + "|solo\\s+(?:di|per)\\s+" + NOMI.alice + "|è\\s+(?:tutt[ao]\\s+)?di\\s+" + NOMI.alice + "|intero\\s+importo\\s+(?:ad?|per)\\s+" + NOMI.alice + ")")],
    ["matteo", rx("(?:tutt[aoei]\\s+(?:di|a|per)\\s+" + NOMI.matteo + "|(?:spetta|tocca)\\s+(?:tutt[aoei]\\s+)?a\\s+" + NOMI.matteo + "|solo\\s+(?:di|per)\\s+" + NOMI.matteo + "|è\\s+(?:tutt[ao]\\s+)?di\\s+" + NOMI.matteo + "|intero\\s+importo\\s+(?:a|per)\\s+" + NOMI.matteo + ")")],
    ["me", rx("(?:tutt[aoei]\\s+(?:mia|mio|mie|miei|a\\s+me|per\\s+me)|(?:spetta|tocca)\\s+(?:tutt[aoei]\\s+)?a\\s+me|solo\\s+mi[ao]|è\\s+(?:tutt[ao]\\s+)?mi[ao])")],
    ["meta", rx("(?:a\\s+met[àa]|met[àa]\\s+(?:ciascuno|a\\s+testa|per\\s+uno)|in\\s+parti\\s+uguali|equamente|in\\s+due|dividi(?:amo|amola|la|amolo|lo)?|50\\s*(?:e|-|\\/|%)\\s*50)")]
  ];
  // trova chi ha pagato e la divisione in una frase; li toglie dal testo
  function takeWho(text, me) {
    let t = text, payer, split, first = Infinity;
    for (const [k, r] of PAYER) { const m = t.match(r); if (m) { payer = k === "me" ? me : k; first = Math.min(first, m.index); t = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length); break; } }
    for (const [k, r] of SPLIT) { const m = t.match(r); if (m) { split = k === "me" ? me : k; first = Math.min(first, m.index); t = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length); break; } }
    return { payer: payer || undefined, split: split || undefined, rest: t, first };
  }

  // Frasi dettate o scritte: "ieri pizzeria 38 euro, oggi supermercato 62 e 40"
  // opts.me = "matteo" o "alice" per capire "pagata da me", "tutta mia"
  function parseText(input, today, opts) {
    opts = opts || {};
    today = today || new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let text = " " + String(input || "").replace(/\s+/g, " ") + " ";
    // numeri scritti in lettere semplici ("venti euro")
    text = text.replace(/\b(un|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|venti|trenta|quaranta|cinquanta|cento)\s+(euro)\b/gi,
      (all, w, e) => NUM_WORDS[w.toLowerCase()] + " " + e);
    const chunks = text.split(/[;\n]|,(?!\d)|\.\s|\b(?:e poi|poi|dopo)\b/i);
    const out = [];
    let carryDate = iso(today), carryPayer, carrySplit, lastChunk = [];
    for (let chunk of chunks) {
      if (!chunk.trim()) continue;
      const who = takeWho(chunk, opts.me);
      chunk = who.rest;
      const dt = takeDate(chunk, today);
      if (dt.date) carryDate = dt.date;
      chunk = dt.rest;
      const amts = amountsIn(chunk);
      // una frase senza importi ("pagate da Ali:") vale per quelle che seguono
      if (!amts.length) {
        // "…, tutta di Matteo" dopo una spesa vale per quella; prima di tutte vale per quelle che seguono
        if (lastChunk.length) {
          for (const o of lastChunk) { if (who.payer && !o.payer) o.payer = who.payer; if (who.split && !o.split) o.split = who.split; }
        } else { if (who.payer) carryPayer = who.payer; if (who.split) carrySplit = who.split; }
        continue;
      }
      lastChunk = [];
      // "pagate da Ali: bar 5, pane 3" all'inizio vale anche per le spese che seguono
      if (!out.length && who.first < amts[0].start) { if (who.payer) carryPayer = who.payer; if (who.split) carrySplit = who.split; }
      const payer = who.payer || carryPayer, split = who.split || carrySplit;
      let prevEnd = 0;
      amts.forEach((a, i) => {
        const before = chunk.slice(prevEnd, a.start);
        const nextStart = i + 1 < amts.length ? amts[i + 1].start : chunk.length;
        const after = chunk.slice(a.end, nextStart);
        let note = cleanNote(before);
        if (note) prevEnd = a.end;
        else { note = cleanNote(after); prevEnd = nextStart; }
        if (a.cents <= 0) return;
        const o = { date: carryDate, cents: a.cents, cat: guessCat(note || chunk, "extra"), note };
        if (payer) o.payer = payer;
        if (split) o.split = split;
        out.push(o); lastChunk.push(o);
      });
    }
    return out;
  }

  // ---- scontrini (testo dall'OCR) ----
  const PRICE = /(\d{1,3}(?:[.\s]\d{3})*)\s?[,.]\s?(\d{2})(?!\d)/g;
  function pricesIn(line) {
    const out = []; let m; PRICE.lastIndex = 0;
    while ((m = PRICE.exec(line))) out.push(parseInt(m[1].replace(/[.\s]/g, ""), 10) * 100 + parseInt(m[2], 10));
    return out;
  }
  const RECEIPT_HINT = /tot(?:ale)?\b|iva|scontrino|documento commerciale|p\.?\s?iva|contante|bancomat|pagamento|resto|euro\s*$|importo/i;

  function parseReceipt(raw, today) {
    today = today || new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const lines = String(raw || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const isReceipt = RECEIPT_HINT.test(lines.join("\n"));
    if (!isReceipt) {
      // una lista di spese scritta: una voce per riga
      return parseText(lines.join("\n"), today);
    }
    // totale
    let total = null;
    const tests = [
      /totale\s+complessivo/i, /tot(?:ale)?\.?\s*(?:euro|eur|€)/i, /importo\s+pagato|da\s+pagare|netto\s+a\s+pagare/i,
      /^(?!.*sub).*\btot(?:ale)?\b/i, /pagamento\s+(?:elettronico|carta|bancomat|pos)|carta\s+di\s+credito|bancomat/i
    ];
    outer: for (const rx of tests) {
      for (let i = 0; i < lines.length; i++) {
        if (!rx.test(lines[i]) || /sub\s*tot/i.test(lines[i])) continue;
        let p = pricesIn(lines[i]);
        if (!p.length && lines[i + 1]) p = pricesIn(lines[i + 1]);
        if (p.length) { total = p[p.length - 1]; break outer; }
      }
    }
    if (total == null) {
      // ripiego: l'importo più alto escludendo contanti e resto
      const all = [];
      for (const l of lines) if (!/contant|resto|ricevut/i.test(l)) all.push(...pricesIn(l));
      if (all.length) total = Math.max(...all);
    }
    if (!total) return [];
    // data
    let date = iso(today);
    for (const l of lines) {
      const m = l.match(/\b(\d{1,2})\s?[\/.\-]\s?(\d{1,2})\s?[\/.\-]\s?(\d{2,4})\b/);
      if (!m) continue;
      let y = +m[3]; if (y < 100) y += 2000;
      const d = resolveDay(+m[1], +m[2] - 1, y, today);
      if (d) { date = iso(d); break; }
    }
    // negozio: la prima riga con parole vere
    let store = "";
    for (const l of lines.slice(0, 6)) {
      const letters = l.replace(/[^A-Za-zÀ-ÿ' ]/g, "").replace(/\s+/g, " ").trim();
      if (letters.length >= 3 && letters.length >= l.length * 0.6 && !/documento|commerciale|scontrino|vendita|p\s?iva/i.test(letters)) {
        store = letters.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).slice(0, 40); break;
      }
    }
    return [{ date, cents: total, cat: guessCat(raw, "spesa"), note: store || "Scontrino" }];
  }

  const api = { parseText, parseReceipt, guessCat, iso };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SpeseParse = api;
})(typeof window !== "undefined" ? window : this);
