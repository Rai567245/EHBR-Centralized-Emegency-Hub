'use strict';
(async () => {
  if (!EH.init()) return;
  const { $, esc, api, ago, fail, toast, confirmBox } = EH;

  const PAGE_SIZE = 5; // cards per page (view only – nothing is removed from the data)
  const CATS = {
    alert:    { pill: 'red',  label: 'Alert',    hint: 'Urgent – affects safety right now.' },
    advisory: { pill: 'blue', label: 'Advisory', hint: 'Weather updates and preparedness tips.' },
    event:    { pill: 'gray', label: 'Event',    hint: 'Community news and activities.' },
  };
  const FILTERS = [['all', 'All'], ['alert', 'Alert'], ['advisory', 'Advisory'], ['event', 'Event']];
  const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;

  const feed = $('#anFeed');
  const state = { all: [], filter: 'all', page: 1 };
  let listMax = 0; // tallest list height seen so far (desktop)

  /* ------------------------------------------------------------------
     Feed: filter chips + 5 cards per page + Prev / "1 of N" / Next
     ------------------------------------------------------------------ */
  function counts() {
    const c = { all: state.all.length, alert: 0, advisory: 0, event: 0 };
    state.all.forEach((a) => { if (c[a.category] !== undefined) c[a.category]++; });
    return c;
  }

  function cardHTML(a) {
    const cat = CATS[a.category] || { pill: 'gray', label: a.category || 'Notice' };
    const thumb = a.imageUrl
      ? `<button type="button" class="anx-thumb" data-zoom="${esc(a.imageUrl)}" aria-label="View image for ${esc(a.title)}"><img src="${esc(a.imageUrl)}" alt="" loading="lazy"></button>`
      : '';
    return `<article class="anx-card${a.imageUrl ? ' has-img' : ''}">${thumb}
      <div class="anx-main">
        <div class="anx-meta">
          <span class="pill pill--${cat.pill} pill--sm pill--caps">${esc(cat.label)}</span>
          <time>${esc(ago(a.createdAt))}</time>
          <button type="button" class="anx-del" data-del="${esc(a.id)}" title="Delete announcement" aria-label="Delete announcement: ${esc(a.title)}">${icon('i-trash')}</button>
        </div>
        <h3 class="anx-title">${esc(a.title)}</h3>
        <p class="anx-body is-clamped">${esc(a.body)}</p>
        <button type="button" class="anx-more" data-more aria-expanded="false" hidden>Read more</button>
      </div></article>`;
  }

  function render() {
    if (!state.all.length) {
      feed.innerHTML = '<div class="empty"><b>No announcements yet</b>Write one on the left – residents see it in the app’s News tab right away.</div>';
      return;
    }
    const c = counts();
    const list = state.filter === 'all' ? state.all : state.all.filter((a) => a.category === state.filter);
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), pages);
    const from = (state.page - 1) * PAGE_SIZE;
    const slice = list.slice(from, from + PAGE_SIZE);

    const chips = FILTERS.map(([k, label]) =>
      `<button type="button" class="chip${state.filter === k ? ' is-on' : ''}" data-filter="${k}" aria-pressed="${state.filter === k}">${label} ${c[k]}</button>`).join('');
    const range = list.length ? `${from + 1}–${from + slice.length} of ${list.length}` : '0';

    const body = slice.length
      ? slice.map(cardHTML).join('')
      : `<div class="empty"><b>No ${esc((CATS[state.filter] || {}).label || '')} announcements</b>Try another filter.</div>`;

    const pager = pages > 1 ? `
      <nav class="bk__pager anx-pager" aria-label="Announcement pages">
        <button type="button" class="btn btn--fit" data-page="prev"${state.page <= 1 ? ' disabled' : ''}>${icon('i-chev-l')}Prev</button>
        <span class="bk__pager-info">${state.page} of ${pages}</span>
        <button type="button" class="btn btn--fit" data-page="next"${state.page >= pages ? ' disabled' : ''}>Next${icon('i-chev-r')}</button>
      </nav>` : '';

    feed.innerHTML = `<div class="anx-bar">
        <div class="anx-head"><h2 class="card__title">Sent announcements</h2><span class="anx-count">${range}</span></div>
        <div class="anx-chips">${chips}</div></div>
      <div class="anx-list">${body}</div>${pager}`;

    // Keep the list as tall as the tallest page seen, so the card (and the pager) never jumps between pages.
    const listEl = feed.querySelector('.anx-list');
    if (listEl) {
      if (window.matchMedia('(min-width: 1101px)').matches) {
        listMax = Math.max(listMax, listEl.offsetHeight);
        listEl.style.minHeight = listMax + 'px';
      }
    }

    // Only offer "Read more" where the message is actually cut off.
    requestAnimationFrame(() => {
      feed.querySelectorAll('.anx-card').forEach((card) => {
        const p = card.querySelector('.anx-body'), m = card.querySelector('.anx-more');
        if (p && m && p.scrollHeight > p.clientHeight + 1) m.hidden = false;
      });
    });
  }

  async function load() {
    const list = await api('/announcements');
    state.all = Array.isArray(list) ? list : [];
    render();
  }

  // ---- Lightbox for thumbnails ----
  const lb = $('#anLb');
  function zoom(src) {
    if (!lb || typeof lb.showModal !== 'function') { return; }
    $('#anLbImg').src = src;
    lb.showModal();
  }
  if (lb) {
    lb.addEventListener('click', (e) => { if (e.target === lb || e.target.closest('#anLbX')) lb.close(); });
    lb.addEventListener('close', () => $('#anLbImg').removeAttribute('src'));
  }

  feed.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-del],[data-filter],[data-page],[data-more],[data-zoom]');
    if (!t || !feed.contains(t)) return;

    if (t.dataset.filter) {
      state.filter = t.dataset.filter; state.page = 1; render(); return;
    }
    if (t.dataset.page) {
      state.page += t.dataset.page === 'next' ? 1 : -1;
      render();
      feed.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (t.hasAttribute('data-more')) {
      const p = t.closest('.anx-main').querySelector('.anx-body');
      const open = p.classList.toggle('is-clamped') === false;
      t.setAttribute('aria-expanded', String(open));
      t.textContent = open ? 'Show less' : 'Read more';
      return;
    }
    if (t.dataset.zoom) { zoom(t.dataset.zoom); return; }

    if (t.dataset.del) {
      if (!(await confirmBox('Delete this announcement?', 'Residents will no longer see it in the app.', 'Delete'))) return;
      try {
        await api('/admin/announcements/' + encodeURIComponent(t.dataset.del), { method: 'DELETE' });
        toast('Announcement deleted', 'ok');
        await load(); // re-renders and clamps the current page if it became empty
      } catch (x) { fail(x); }
    }
  });

  /* ------------------------------------------------------------------
     Form
     ------------------------------------------------------------------ */
  const form = $('#anForm');
  const errEl = $('#anErr');
  const setErr = (msg) => { errEl.textContent = msg || ''; errEl.hidden = !msg; };

  // Category hint
  form.addEventListener('change', (e) => {
    if (e.target.name === 'anCat') $('#anCatHint').textContent = (CATS[e.target.value] || {}).hint || '';
  });

  // Character counters
  const bindCount = (input, out, max) => {
    const upd = () => { out.textContent = `${input.value.length}/${max}`; };
    input.addEventListener('input', upd); upd();
  };
  bindCount($('#anTitle'), $('#anTitleN'), 100);
  bindCount($('#anBody'), $('#anBodyN'), 2000);

  // ---- Live preview (mirrors the card residents get) ----
  function updatePreview() {
    const cat = form.querySelector('input[name="anCat"]:checked');
    const c = CATS[cat ? cat.value : 'alert'];
    const title = $('#anTitle').value.trim();
    const text = $('#anBody').value.trim();
    $('#anPrev').innerHTML = `<article class="anx-card${imageData ? ' has-img' : ''}">${imageData ? `<div class="anx-thumb"><img src="${esc(imageData)}" alt=""></div>` : ''}
      <div class="anx-main">
        <div class="anx-meta"><span class="pill pill--${c.pill} pill--sm pill--caps">${esc(c.label)}</span><time>Just now</time></div>
        <h3 class="anx-title${title ? '' : ' is-ph'}">${esc(title || 'Your title appears here')}</h3>
        <p class="anx-body is-clamped${text ? '' : ' is-ph'}">${esc(text || 'Your message appears here.')}</p>
      </div></article>`;
  }
  ['#anTitle', '#anBody'].forEach((s) => $(s).addEventListener('input', updatePreview));
  form.addEventListener('change', (e) => { if (e.target.name === 'anCat') updatePreview(); });

  // ---- Optional image: resized in the browser, sent as a JPEG data URL ----
  let imageData = null;
  const MAX_FILE = 8 * 1024 * 1024; // 8 MB picked file
  const MAX_SIDE = 1280;            // longest side after resize

  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  function clearImage() {
    imageData = null;
    $('#anImg').value = '';
    $('#anImgPrev').removeAttribute('src');
    $('#anImgBox').hidden = true;
    $('#anImgPick').hidden = false;
    updatePreview();
  }
  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * s));
        c.height = Math.max(1, Math.round(img.height * s));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // flatten transparency
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image')); };
      img.src = url;
    });
  }
  async function handleFile(f) {
    if (!f) return;
    setErr('');
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { clearImage(); setErr('Choose a PNG, JPG or WebP image'); return; }
    if (f.size > MAX_FILE) { clearImage(); setErr('Image is too large (max 8 MB)'); return; }
    try {
      imageData = await resizeImage(f);
      $('#anImgPrev').src = imageData;
      $('#anImgName').textContent = f.name;
      $('#anImgSize').textContent = fmtSize(f.size);
      $('#anImgBox').hidden = false;
      $('#anImgPick').hidden = true;
      updatePreview();
    } catch (x) { clearImage(); setErr(x.message); }
  }

  const pick = $('#anImgPick');
  pick.addEventListener('click', () => $('#anImg').click());
  $('#anImgClear').addEventListener('click', clearImage);
  $('#anImg').addEventListener('change', (e) => handleFile(e.target.files && e.target.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => pick.addEventListener(ev, (e) => { e.preventDefault(); pick.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => pick.addEventListener(ev, (e) => { e.preventDefault(); pick.classList.remove('is-over'); }));
  pick.addEventListener('drop', (e) => handleFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]));

  updatePreview();

  // ---- Submit ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setErr('');
    const cat = form.querySelector('input[name="anCat"]:checked');
    const body = {
      category: cat ? cat.value : 'alert',
      title: $('#anTitle').value.trim(),
      body: $('#anBody').value.trim(),
      push: $('#anPush').checked,
    };
    if (!body.title || !body.body) { setErr('Title and message are required'); return; }
    if (imageData) body.image = imageData;

    const btn = $('#anSend');
    btn.disabled = true;
    try {
      await api('/admin/announcements', { method: 'POST', body });
      $('#anTitle').value = ''; $('#anBody').value = '';
      $('#anTitle').dispatchEvent(new Event('input')); $('#anBody').dispatchEvent(new Event('input'));
      clearImage();
      toast('Announcement sent', 'ok');
      state.filter = 'all'; state.page = 1; // newest shows first
      await load();
    } catch (x) { setErr(x.message); }
    finally { btn.disabled = false; }
  });

  async function pushStatus() {
    try {
      const s = await api('/admin/push-status');
      const box = $('#anPush'), el = $('#pushStatus');
      if (s.enabled) {
        el.textContent = `Push is on · ${s.devices} phone${s.devices === 1 ? '' : 's'} registered. Residents also see every announcement under the bell icon in the app.`;
      } else {
        box.checked = false; box.disabled = true;
        $('#anPushBox').classList.add('is-off');
        el.textContent = 'Push is not set up yet, so phones will not buzz. Residents still see this under the bell icon in the app. To switch push on, follow “Push notifications” in the README.';
      }
    } catch (e) { fail(e); }
  }

  try { await Promise.all([load(), pushStatus()]); } catch (e) { fail(e); }
})();
