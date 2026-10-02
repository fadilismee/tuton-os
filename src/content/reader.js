// src/content/reader.js — Skill agent: baca tab, daftar field/klik, isi + klik.
// Disuntik via chrome.scripting HANYA setelah klik user (activeTab/tabs).
// Pesan: TUTON_READ_TAB | TUTON_FIELDS | TUTON_FILL | TUTON_CLICK
// Catatan: TIDAK bisa jalan di chrome://, edge://, Web Store, halaman
// extension lain, dan PDF viewer bawaan — Chrome memblokir inject di sana
// (vAi memberi pesan jelas per kasus, bukan "gagal" generik).
(() => {
  if (window.__tutonReader) return;
  window.__tutonReader = true;

  function visibleText(max = 20000) {
    const parts = [];
    let walker;
    try {
      walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    } catch { return ''; }
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (t.length > 2 && n.parentElement?.offsetParent !== null) parts.push(t);
      if (parts.join(' ').length > max) break;
    }
    return parts.join('\n').slice(0, max);
  }

  // Selector stabil untuk sebuah elemen (id > name unik > nth-of-type path).
  function selOf(el) {
    if (!el || el === document.body) return 'body';
    try {
      if (el.id) return '#' + CSS.escape(el.id);
    } catch { /* lanjut fallback */ }
    const name = el.getAttribute && el.getAttribute('name');
    if (name && /^(input|textarea|select)$/i.test(el.tagName)) {
      try {
        if (document.querySelectorAll(`[name="${CSS.escape(name)}"]`).length === 1) {
          return `${el.tagName.toLowerCase()}[name="${name}"]`;
        }
      } catch { /* lanjut */ }
    }
    const path = [];
    let cur = el;
    while (cur && cur !== document.body && path.length < 5) {
      const tag = cur.tagName.toLowerCase();
      let idx = 1;
      let sib = cur.previousElementSibling;
      while (sib) { if (sib.tagName === cur.tagName) idx++; sib = sib.previousElementSibling; }
      path.unshift(idx > 1 ? `${tag}:nth-of-type(${idx})` : tag);
      cur = cur.parentElement;
    }
    return path.join(' > ');
  }

  function labelOf(el) {
    try {
      const id = el.id;
      if (id) {
        const lb = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lb) return lb.textContent.trim().slice(0, 80);
      }
      const wrap = el.closest && el.closest('label');
      if (wrap) return wrap.textContent.trim().slice(0, 80);
    } catch { /* abaikan */ }
    return ((el.getAttribute && (el.getAttribute('placeholder') || el.getAttribute('name'))) || el.textContent || el.tagName).trim().slice(0, 80);
  }

  function flash(el) {
    try {
      const old = el.style.outline;
      el.style.outline = '2px solid #00e68a';
      el.style.outlineOffset = '2px';
      setTimeout(() => { try { el.style.outline = old; el.style.outlineOffset = ''; } catch {} }, 1200);
    } catch { /* abaikan */ }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    (async () => {
      if (msg.type === 'TUTON_PING') { send({ ok: true }); return; }
      if (msg.type === 'TUTON_READ_TAB') {
        send({
          ok: true,
          url: location.href,
          title: document.title,
          selection: window.getSelection()?.toString().slice(0, 5000) || '',
          text: visibleText(),
        });
      } else if (msg.type === 'TUTON_FIELDS') {
        // Field isian (max 40) + elemen bisa-klik (max 30) agar AI tahu
        // selector untuk isi MAUPUN klik.
        const els = [...document.querySelectorAll('input, textarea, select')].filter((el) => {
          if (el.disabled || el.type === 'hidden') return false;
          return el.offsetParent !== null;
        }).slice(0, 40);
        const clicks = [...document.querySelectorAll('button, a[href], [role="button"], input[type="submit"], input[type="button"]')].filter((el) => {
          if (el.disabled) return false;
          if (el.offsetParent === null) return false;
          const t = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
          return t.length > 0;
        }).slice(0, 30);
        send({
          ok: true,
          url: location.href,
          title: document.title,
          fields: els.map((el) => ({
            selector: selOf(el),
            tag: el.tagName.toLowerCase(),
            type: el.type || '',
            label: labelOf(el),
            value: String(el.value || '').slice(0, 200),
          })),
          clickables: clicks.map((el) => ({
            selector: selOf(el),
            text: (el.textContent || el.value || '').trim().slice(0, 60),
          })),
        });
      } else if (msg.type === 'TUTON_FILL') {
        // actions: [{selector, value}] — user sudah konfirmasi di sidepanel
        // sesuai mode (otomatis/semi/manual).
        const out = [];
        for (const a of msg.actions || []) {
          try {
            const el = document.querySelector(a.selector);
            if (!el) { out.push({ selector: a.selector, ok: false, error: 'not-found' }); continue; }
            try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
            flash(el);
            el.focus();
            const tag = el.tagName.toLowerCase();
            if (el.type === 'checkbox') {
              el.checked = !!a.value;
            } else if (tag === 'select' && /^\d+$/.test(String(a.value))) {
              el.selectedIndex = Number(a.value);
            } else if (tag === 'select') {
              const opt = [...el.options].find((o) => o.text.trim() === String(a.value).trim() || o.value === String(a.value));
              if (opt) el.selectedIndex = opt.index;
              else { out.push({ selector: a.selector, ok: false, error: 'option-tidak-cocok' }); continue; }
            } else {
              // Setter native agar framework reaktif (React/Vue) ikut update.
              const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              try {
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (setter) setter.call(el, a.value ?? '');
                else el.value = a.value ?? '';
              } catch { el.value = a.value ?? ''; }
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            out.push({ selector: a.selector, ok: true });
          } catch (e) {
            out.push({ selector: a.selector, ok: false, error: e.message });
          }
        }
        send({ ok: true, filled: out });
      } else if (msg.type === 'TUTON_CLICK') {
        // {selector} — klik satu elemen (scroll + highlight + klik beneran).
        try {
          const el = document.querySelector(msg.selector);
          if (!el) return send({ ok: false, error: 'not-found' });
          try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
          flash(el);
          await new Promise((r) => setTimeout(r, 350));
          el.click();
          send({ ok: true, clicked: msg.selector });
        } catch (e) {
          send({ ok: false, error: e.message });
        }
      } else {
        send({ ok: false, error: 'unknown' });
      }
    })();
    return true;
  });
})();
