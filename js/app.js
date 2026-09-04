(() => {
  'use strict';

  const S = window.MenuStars;
  const Sync = () => window.FoodMenusSync;
  const state = {
    catalog: null,
    restaurants: [],
    menus: null,
    byId: new Map(),
    byName: new Map(),
    processOutputs: new Set(),
    type: null,
    family: '__all__',
    stage: 'all',
    formFilter: '',
    lockerSearch: '',
    dishesSearch: '',
    processSearch: '',
    selected: [],
    unlockedOnly: true,
    dish: null,
    kept: [],
    detailIng: null,
    galleryMode: 'have',
    gallerySearch: '',
    artFiles: [],
    longPressTimer: null,
    dishName: '',
    dishNameManual: false,
    restaurantId: null,
    mode: 'dish',
    processData: null,
    processId: null,
    processOutput: '',
    processOutputManual: false,
    processSlots: [],
    processSlotFocus: 0,
    stationFilter: null,
    fiveStarArt: null,
    hqPlateGen: 0,
    recipeSlots: [],
    loadedRecipe: null,
    armedSlotId: null,
    brokenArt: new Set()
  };

  const FiveStar = () => window.FoodMenusFiveStar;

  const $ = (sel, root = document) => root.querySelector(sel);

  const SLOT_TYPES = [
    { type: 'Vegetable', label: 'Vegetable' },
    { type: 'Herb', label: 'Herb' },
    { type: 'Garnish', label: 'Garnish' },
    { type: 'Protein', label: 'Protein' },
    { type: 'Carb', label: 'Carb' }
  ];

  const RESTAURANTS = [
    { id: 'taqueria', name: 'Taqueria' },
    { id: 'pho', name: 'Pho Shop' },
    { id: 'ramen', name: 'Ramen Shop' },
    { id: 'diner', name: 'American Diner' },
    { id: 'finedining', name: 'Fine Dining' },
    { id: 'kitchen', name: 'Communal Kitchen' },
    { id: 'bakery', name: 'Bakery' },
    { id: 'sushi', name: 'Sushi Bar' }
  ];

  function restaurantById(id) {
    return RESTAURANTS.find((r) => r.id === id) || null;
  }

  function cookOrderRank(ing) {
    const t = ing?.uiType || '';
    if (t === 'Carb') return 0;
    if (t === 'Broth') return 1;
    if (t === 'Protein') return 2;
    if (t === 'Spice') return 3;
    if (t === 'Vegetable') return 4;
    return 5;
  }

  function servingLabel(ing) {
    const qty = ing?.servingQty;
    const unit = ing?.servingUnit || '';
    if (qty == null || qty === '') return '';
    const n = Number(qty);
    const q = Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)) : String(qty);
    return unit ? `${q} ${unit}` : q;
  }

  function sortedPlate(list) {
    return [...(list || [])].sort((a, b) => {
      const d = cookOrderRank(a) - cookOrderRank(b);
      return d || String(a.name).localeCompare(String(b.name));
    });
  }

  function normalizeRecipeSlots(slots) {
    return (slots || []).map((s, idx) => ({
      id: s.id || `slot-${idx}-${Date.now()}`,
      label: s.label || s.type || 'Slot',
      type: s.type || s.label || 'Custom',
      optionIds: [...new Set((s.optionIds || []).filter(Boolean))]
    }));
  }

  function corePlateIngredients(ingredients) {
    return S.recipeCores(ingredients || state.selected, state.recipeSlots);
  }

  function plateSatisfiesCurrentRecipe() {
    const slots = normalizeRecipeSlots(state.recipeSlots);
    const hasSlotOpts = slots.some((s) => (s.optionIds || []).length);
    if (!hasSlotOpts) return null;
    // Loaded kept recipe already had slots → recognize against its cores + current slot defs
    if (state.loadedRecipe?.slots?.some((s) => (s.optionIds || []).length)) {
      const cores = S.recipeCores(
        hydrateIngredients(state.loadedRecipe.ingredients || []),
        slots
      );
      return S.satisfiesRecipe(state.selected, { ingredients: cores, slots });
    }
    // Authoring new slots on a plate: cores are non-option plate items (always present);
    // Create dish is gated by covering each non-empty slot.
    return S.satisfiesRecipe(state.selected, {
      ingredients: corePlateIngredients(state.selected),
      slots
    });
  }

  function substituteGroupMembers(ing) {
    if (!ing || !state.catalog?.substituteGroups) return [];
    const groups = state.catalog.substituteGroups;
    const name = String(ing.name || '').toLowerCase();
    const out = [];
    Object.values(groups).forEach((g) => {
      const members = g.members || [];
      if (!members.some((m) => String(m).toLowerCase() === name)) return;
      members.forEach((m) => {
        const hit = state.byName.get(String(m).toLowerCase());
        if (hit) out.push(hit);
      });
    });
    return out;
  }

  function seedSlotFromSubstitutes(slot, seedIng) {
    if (!slot || !seedIng) return;
    const related = substituteGroupMembers(seedIng);
    related.forEach((ing) => {
      if (!slot.optionIds.includes(ing.id)) slot.optionIds.push(ing.id);
    });
  }

  function addRecipeSlot(type, label) {
    const cleanLabel = String(label || type || 'Slot').trim();
    if (!cleanLabel) return;
    const id = `slot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const slot = { id, label: cleanLabel, type: type || 'Custom', optionIds: [] };
    state.recipeSlots.push(slot);
    state.armedSlotId = id;
    renderSlots();
    renderRecipeList(state.selected);
    renderTray();
    renderGrid();
  }

  function removeRecipeSlot(slotId) {
    state.recipeSlots = state.recipeSlots.filter((s) => s.id !== slotId);
    if (state.armedSlotId === slotId) state.armedSlotId = null;
    renderSlots();
    renderRecipeList(state.selected);
    renderTray();
    renderGrid();
  }

  function armRecipeSlot(slotId) {
    if (!slotId || !state.recipeSlots.some((s) => s.id === slotId)) {
      state.armedSlotId = null;
    } else if (state.armedSlotId === slotId) {
      state.armedSlotId = null;
    } else {
      state.armedSlotId = slotId;
    }
    renderSlots();
    renderRecipeList(state.selected);
    renderTray();
    renderGrid();
  }

  function disarmRecipeSlot() {
    if (!state.armedSlotId) return;
    state.armedSlotId = null;
    renderSlots();
    renderRecipeList(state.selected);
    renderTray();
    renderGrid();
  }

  function addOptionToSlot(slotId, ing, { moveOffPlate = false } = {}) {
    if (!ing) return;
    const slot = state.recipeSlots.find((s) => s.id === slotId);
    if (!slot) return;
    if (!slot.optionIds.includes(ing.id)) slot.optionIds.push(ing.id);
    seedSlotFromSubstitutes(slot, ing);
    if (moveOffPlate) {
      state.selected = state.selected.filter((x) => x.id !== ing.id);
    }
    renderSlots();
    renderTray();
    renderGrid();
  }

  function removeOptionFromSlot(slotId, ingId) {
    const slot = state.recipeSlots.find((s) => s.id === slotId);
    if (!slot) return;
    slot.optionIds = slot.optionIds.filter((id) => id !== ingId);
    renderSlots();
    renderRecipeList(state.selected);
    renderTray();
  }

  function slotEmptyHint(armed) {
    if (armed) return 'Tap ingredients below to add';
    return 'Tap slot, then tap ingredients';
  }

  function wireSlotDropTarget(el, slotId) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/ing-id');
      const fromRecipe = e.dataTransfer.getData('text/from-recipe') === '1';
      const ing = state.byId.get(id);
      if (ing) addOptionToSlot(slotId, ing, { moveOffPlate: fromRecipe });
    });
  }

  function renderSlotAddRail() {
    const el = $('#slot-add-rail');
    if (!el) return;
    el.innerHTML = SLOT_TYPES.map((s) => `
      <button type="button" class="slot-add-chip" data-slot-type="${esc(s.type)}">${esc(s.label)}</button>
    `).join('');
    el.querySelectorAll('.slot-add-chip').forEach((btn) => {
      btn.addEventListener('click', () => addRecipeSlot(btn.dataset.slotType, btn.dataset.slotType));
    });
  }

  function renderSlots() {
    const wrap = $('#slots-section');
    const el = $('#recipe-slots');
    if (!wrap || !el) return;
    wrap.hidden = state.mode !== 'dish';
    if (state.armedSlotId && !state.recipeSlots.some((s) => s.id === state.armedSlotId)) {
      state.armedSlotId = null;
    }
    const slots = state.recipeSlots;
    el.innerHTML = slots.map((slot) => {
      const opts = (slot.optionIds || []).map((id) => state.byId.get(id)).filter(Boolean);
      const armed = state.armedSlotId === slot.id;
      return `
        <div class="recipe-slot ${armed ? 'armed' : ''}" data-slot-id="${esc(slot.id)}" data-drop="slot" role="button" tabindex="0" aria-pressed="${armed}" aria-label="${esc(slot.label)} slot${armed ? ', armed' : ''}">
          <div class="recipe-slot-head">
            <span class="recipe-slot-label">${esc(slot.label)}${armed ? ' · adding' : ''}</span>
            <div class="recipe-slot-head-actions">
              ${armed ? `<button type="button" class="recipe-slot-done" data-disarm-slot="${esc(slot.id)}">Done</button>` : ''}
              <button type="button" class="recipe-slot-remove" data-remove-slot="${esc(slot.id)}" aria-label="Remove slot">✕</button>
            </div>
          </div>
          <div class="recipe-slot-options">
            ${opts.map((ing) => `
              <button type="button" class="slot-opt-chip" data-slot-id="${esc(slot.id)}" data-opt-id="${esc(ing.id)}" title="${esc(ing.name)}" aria-label="Remove ${esc(ing.name)}">
                ${artHtml(ing)}
              </button>
            `).join('') || `<span class="slot-drop-hint">${esc(slotEmptyHint(armed))}</span>`}
          </div>
        </div>`;
    }).join('');

    el.querySelectorAll('.recipe-slot').forEach((row) => {
      const slotId = row.dataset.slotId;
      wireSlotDropTarget(row, slotId);
      row.addEventListener('click', (e) => {
        if (e.target.closest('.slot-opt-chip, .recipe-slot-remove, .recipe-slot-done')) return;
        armRecipeSlot(slotId);
      });
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target !== row) return;
        e.preventDefault();
        armRecipeSlot(slotId);
      });
    });
    el.querySelectorAll('[data-remove-slot]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeRecipeSlot(btn.dataset.removeSlot);
      });
    });
    el.querySelectorAll('[data-disarm-slot]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        disarmRecipeSlot();
      });
    });
    el.querySelectorAll('.slot-opt-chip').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeOptionFromSlot(btn.dataset.slotId, btn.dataset.optId);
      });
    });
    enhanceArtImages(el);
  }

  function syncDishNameField() {
    const input = $('#dish-name');
    if (!input) return;
    if (document.activeElement === input) return;
    input.value = state.dishName || '';
  }

  function refreshAutoName() {
    if (state.dishNameManual) {
      syncDishNameField();
      return;
    }
    const legal = legality();
    const shop = restaurantById(state.restaurantId);
    state.dishName = state.selected.length
      ? S.autoName(state.selected, legal.style, shop?.name)
      : '';
    syncDishNameField();
  }

  function syncRestaurantFromPlate() {
    const lock = S.restaurantLock(state.selected.map((i) => i.name));
    if (lock?.only) {
      state.restaurantId = lock.id;
    } else if (state.restaurantId === 'ramen' || state.restaurantId === 'pho') {
      // Clear exclusive shop if noodles removed
      const still = S.restaurantLock(state.selected.map((i) => i.name));
      if (!still) state.restaurantId = null;
    }
  }

  function loadKept() {
    try { state.kept = JSON.parse(localStorage.getItem('food-menus-kept-v1') || '[]'); }
    catch { state.kept = []; }
    // Merge dish SoT cache (sheet / prior saves) — newer updatedAt wins per id
    try {
      const fromStore = Sync().keptFromStore(Sync().loadCache());
      const byId = new Map(state.kept.map((d) => [d.id, d]));
      fromStore.forEach((d) => {
        const cur = byId.get(d.id);
        if (!cur) byId.set(d.id, d);
        else {
          const a = Date.parse(cur.updatedAt || cur.exportedAt || 0) || 0;
          const b = Date.parse(d.updatedAt || 0) || 0;
          if (b >= a) byId.set(d.id, { ...cur, ...d, ingredients: hydrateIngredients(d.ingredients || cur.ingredients) });
        }
      });
      state.kept = [...byId.values()];
    } catch { /* sync module optional during early boot */ }
    $('#kept-count').textContent = String(state.kept.length);
  }

  function hydrateIngredients(list) {
    return (list || []).map((row) => {
      const full = state.byId.get(row.id);
      // Prefer live catalog name so renames resolve on plate / kept dishes.
      return full
        ? { ...full, ...row, name: full.name || row.name, art: row.art || full.art || '' }
        : row;
    });
  }

  function saveKept() {
    localStorage.setItem('food-menus-kept-v1', JSON.stringify(state.kept));
    $('#kept-count').textContent = String(state.kept.length);
    // Mirror into bidirectional SoT cache as dirty dish rows
    Sync().syncDishesFromKept(state.kept, { dirty: true });
  }

  function rebuildIndexes() {
    state.byId.clear();
    state.byName.clear();
    state.catalog.ingredients.forEach((ing) => {
      state.byId.set(ing.id, ing);
      state.byName.set(ing.name.toLowerCase(), ing);
    });
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** Icon-only unless art missing — then show name. Stations use CSS/SVG glyph + name. */
  function artHtml(ing, cls = '') {
    if (ing?.isStation || ing?.glyph) {
      const glyph = ing.glyph === 'oven' ? 'oven' : 'gear';
      return `<span class="station-glyph ${glyph}" aria-hidden="true"></span>`;
    }
    const art = normalizeArtPath(ing?.art);
    if (art && !isArtBroken(art) && !isArtDeleted(art)) {
      const src = resolveArtSrc(art);
      const sizeCls = `art-fit art-${artSizeClass(art)}`;
      return `<img class="${esc((cls ? `${cls} ` : '') + sizeCls)}" src="${esc(src)}" alt="" draggable="false" loading="lazy" decoding="async" data-art="${esc(art)}" />`;
    }
    if (art && (isArtBroken(art) || isArtDeleted(art))) {
      return `<span class="name-fallback art-broken" title="${esc(art)}">?</span>`;
    }
    return `<span class="name-fallback">${esc(ing?.name || '?')}</span>`;
  }

  function isArtBroken(path) {
    const p = normalizeArtPath(path);
    return Boolean(p && state.brokenArt.has(p));
  }

  /** Empty art OR broken/404 art OR client-deleted art — Gallery Missing set + detail reassign targets. */
  function ingredientNeedsArt(ing) {
    if (!ing || ing.isStation) return false;
    const art = normalizeArtPath(ing.art);
    return !art || isArtBroken(art) || isArtDeleted(art);
  }

  function missingArtIngredients() {
    return (state.catalog.ingredients || [])
      .filter(ingredientNeedsArt)
      .slice()
      .sort((a, b) => {
        const d = galleryTypeRank(a.uiType || a.group) - galleryTypeRank(b.uiType || b.group);
        return d || String(a.name).localeCompare(String(b.name));
      });
  }

  function markArtBroken(path, img) {
    const p = normalizeArtPath(path);
    if (!p) return;
    const already = state.brokenArt.has(p);
    state.brokenArt.add(p);
    if (img?.parentElement) {
      img.hidden = true;
      if (!img.parentElement.querySelector('.art-broken, .name-fallback')) {
        const span = document.createElement('span');
        span.className = 'name-fallback art-broken';
        span.textContent = '?';
        span.title = p;
        img.parentElement.appendChild(span);
      }
      img.closest('.gal-tile, .ing-tile, .detail-hero')?.classList.add('broken-art');
    }
    if (!already && state.galleryMode === 'miss') renderGallery();
  }

  /* —— art visual size: bowls larger, condiments smaller, bbox-normalized —— */
  const ART_FILL = { bowl: 0.93, default: 0.78, condiment: 0.62 };
  const artBBoxCache = new Map(); // path → opaque fill ratio (0–1)

  function artSizeClass(path) {
    const p = normalizeArtPath(path).toLowerCase();
    const stem = artStem(p).toLowerCase();
    const hq = stem.match(/^hq-(\d+)$/);
    if (hq) {
      const n = Number(hq[1]);
      if (n >= 1 && n <= 24) return 'bowl';
      if (n >= 65 && n <= 73) return 'condiment';
    }
    if (/\b(bowl|ramen|pho|pie|loaf|mound|stew|soup|platter|plate)\b/.test(stem.replace(/_/g, ' ')) ||
        /(bowl|ramen|pho|pie|loaf|mound|stew|soup)/.test(stem)) {
      return 'bowl';
    }
    if (/(lime|lemon|sauce|wedge|herb|scallion|cilantro|chili|flake|garnish|sesame_seed)/.test(stem) ||
        /(lime|lemon|sauce|wedge|herb|scallion|cilantro)/.test(p)) {
      return 'condiment';
    }
    return 'default';
  }

  function measureOpaqueRatio(img) {
    const key = normalizeArtPath(img.getAttribute('data-art') || img.currentSrc || img.src);
    if (artBBoxCache.has(key)) return Promise.resolve(artBBoxCache.get(key));
    return new Promise((resolve) => {
      const run = () => {
        try {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          if (!w || !h) {
            artBBoxCache.set(key, 1);
            resolve(1);
            return;
          }
          const maxSide = 128;
          const scale = Math.min(1, maxSide / Math.max(w, h));
          const cw = Math.max(1, Math.round(w * scale));
          const ch = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, cw, ch);
          const data = ctx.getImageData(0, 0, cw, ch).data;
          let minX = cw;
          let minY = ch;
          let maxX = -1;
          let maxY = -1;
          for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
              if (data[(y * cw + x) * 4 + 3] > 12) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
              }
            }
          }
          let ratio = 1;
          if (maxX >= minX && maxY >= minY) {
            const bw = (maxX - minX + 1) / cw;
            const bh = (maxY - minY + 1) / ch;
            ratio = Math.max(bw, bh);
          }
          ratio = Math.min(1, Math.max(0.12, ratio));
          artBBoxCache.set(key, ratio);
          resolve(ratio);
        } catch {
          artBBoxCache.set(key, 1);
          resolve(1);
        }
      };
      if (img.complete && img.naturalWidth) run();
      else img.addEventListener('load', run, { once: true });
    });
  }

  function fitArtImage(img) {
    if (!img) return;
    const path = img.getAttribute('data-art') || img.getAttribute('src') || '';
    const cls = artSizeClass(path);
    img.classList.add('art-fit');
    img.classList.remove('art-bowl', 'art-condiment', 'art-default');
    img.classList.add(`art-${cls}`);
    if (!img.getAttribute('data-art') && path) img.setAttribute('data-art', path);
    if (!img.dataset.artErrorBound) {
      img.dataset.artErrorBound = '1';
      img.addEventListener('error', () => {
        markArtBroken(img.getAttribute('data-art') || path, img);
      });
    }
    if (img.complete && img.naturalWidth === 0 && img.currentSrc) {
      markArtBroken(img.getAttribute('data-art') || path, img);
      return;
    }
    const target = ART_FILL[cls] || ART_FILL.default;
    // CSS class sets a sensible base; refine with opaque bbox so padded PNGs enlarge.
    measureOpaqueRatio(img).then((ratio) => {
      if (img.hidden || isArtBroken(img.getAttribute('data-art') || path)) return;
      const pct = Math.min(1.12, Math.max(0.42, target / Math.max(ratio, 0.18)));
      img.style.width = `${Math.round(pct * 1000) / 10}%`;
      img.style.height = `${Math.round(pct * 1000) / 10}%`;
      img.dataset.artFitBound = '1';
      img.dataset.sizeClass = cls;
    });
  }

  function enhanceArtImages(root = document) {
    const nodes = root === document
      ? root.querySelectorAll('.ing-tile img[src], .gal-thumb img[src], .ring-item img[src]')
      : root.querySelectorAll('img[src]');
    nodes.forEach(fitArtImage);
  }

  function stationGlyphHtml(station) {
    if (!station) return '';
    const glyph = station.glyph === 'oven' ? 'oven' : 'gear';
    return `<span class="station-glyph ${glyph}" aria-hidden="true"></span>`;
  }

  function resolveChainIngs(ing) {
    const names = ing.chain?.length ? ing.chain : [ing.name];
    return names.map((n) => state.byName.get(String(n).toLowerCase()) || { name: n, art: '', id: n });
  }

  function showView(id) {
    ['view-home', 'view-dish', 'view-kept', 'view-gallery', 'view-dishes'].forEach((v) => {
      $(`#${v}`)?.classList.toggle('hidden', v !== id);
    });
  }

  /** Process-catalog outputs + multi-step processed items — not butchered primary cuts. */
  function isMade(ing) {
    if (!ing || ing.isStation) return false;
    const name = String(ing.name || '').toLowerCase();
    if (state.processOutputs.has(name)) return true;
    if (ing.stage === 'processed' && (ing.chain?.length || 0) > 1) return true;
    return false;
  }

  function ingredientUseKind(ing) {
    const SyncApi = Sync();
    if (SyncApi?.resolveIngredientUseKind) return SyncApi.resolveIngredientUseKind(ing);
    const k = String(ing?.useKind || ing?.kind || '').trim().toLowerCase();
    return (k === 'dish' || k === 'processed' || k === 'fresh' || k === 'raw') ? k : '';
  }

  const USE_KIND_HINTS = {
    dish: 'Plated / finished food',
    processed: 'Processed ingredient — still needs cooking',
    fresh: 'Can be added to a dish or consumed as-is',
    raw: 'Must be cooked before eating'
  };

  const USE_KIND_OPTIONS = [
    { value: 'dish', label: 'Dish' },
    { value: 'processed', label: 'Processed (cook further)' },
    { value: 'fresh', label: 'Fresh (ready)' },
    { value: 'raw', label: 'Raw (must cook)' }
  ];

  function matchesLockerSearch(ing, q) {
    if (!q) return true;
    return String(ing.name || '').toLowerCase().includes(q);
  }

  function rebuildProcessOutputs() {
    const set = new Set();
    const Proc = window.FoodMenusProcess;
    const byOutput = state.processData?.byOutput || {};
    Object.keys(byOutput).forEach((n) => set.add(String(n).toLowerCase()));
    Object.values(state.processData?.catalog || {}).forEach((proc) => {
      (Proc?.primaryOutputs(proc) || []).forEach((n) => set.add(String(n).toLowerCase()));
    });
    state.processOutputs = set;
  }

  function selectedIds() {
    return new Set(state.selected.map((i) => i.id));
  }

  function legality() {
    return S.detectStyle(state.selected.map((i) => i.name));
  }

  /* —— plate ring (ingredients on perimeter; optional cooked center) —— */
  function ingredientSizeClass(ing) {
    if (ing?.art) return artSizeClass(ing.art);
    const name = String(ing?.name || '');
    const type = String(ing?.uiType || ing?.group || '');
    if (/spice|herb/i.test(type) || /lime|lemon|cilantro|scallion|herb|sauce|chili|garnish/i.test(name)) {
      return 'condiment';
    }
    if (/broth|carb/i.test(type) || /bowl|ramen|pho|soup|stew|pie|loaf|noodle/i.test(name)) {
      return 'bowl';
    }
    return artSizeClass(name);
  }

  function namedDishArtsFromCatalog() {
    const out = [];
    (state.catalog?.ingredients || []).forEach((ing) => {
      const art = normalizeArtPath(ing.art);
      if (!art || !/\/dishes\//.test(art)) return;
      out.push({ id: ing.id, name: ing.name, file: art });
    });
    return out;
  }

  function renderPlateStack(el, ingredients, { highlightId = null, centerHtml = '' } = {}) {
    if (!el) return;
    const ings = ingredients || [];
    const n = ings.length;
    const center = centerHtml
      || `<div class="plate-center plate-center-empty" aria-hidden="true"></div>`;
    // Radius as % of the plate-well — left/top % are parent-relative (unlike translate %).
    const radius = 42;
    const ring = ings.map((ing, idx) => {
      const angleDeg = n ? ((360 * idx) / n) - 90 : 0;
      const rad = (angleDeg * Math.PI) / 180;
      const x = 50 + radius * Math.cos(rad);
      const y = 50 + radius * Math.sin(rad);
      const size = ingredientSizeClass(ing);
      const hi = highlightId && ing.id === highlightId ? 'highlight' : '';
      return `
        <div class="ring-item art-${size} ${hi}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;z-index:${idx + 2}">
          ${artHtml(ing)}
        </div>`;
    }).join('');
    el.innerHTML = `${center}${ring}`;
    el.classList.toggle('has-ring', n > 0);
    enhanceArtImages(el);
  }

  function setPlateCenter(stack, file, alt) {
    if (!stack) return;
    let center = stack.querySelector('.plate-center');
    if (!center) {
      center = document.createElement('div');
      center.className = 'plate-center';
      stack.prepend(center);
    }
    center.classList.remove('plate-center-empty');
    center.innerHTML = `<img class="plate-center-img hq-dish-img" src="${esc(file)}" alt="${esc(alt || 'plated dish')}" draggable="false" />`;
  }

  function clearHqChrome(bowl) {
    if (!bowl) return;
    bowl.classList.remove('hq-plate', 'hq-has-photo', 'has-center-dish');
    bowl.querySelectorAll('.hq-cue').forEach((n) => n.remove());
  }

  function hqContext(ingredients, extra = {}) {
    const score = extra.score || S.scoreDish(ingredients, state.catalog);
    const shop = restaurantById(extra.restaurantId ?? state.restaurantId);
    return {
      ingredients,
      score,
      starsTotal: score.stars?.total || 0,
      dishName: extra.dishName ?? state.dishName,
      name: extra.dishName ?? state.dishName,
      restaurantId: extra.restaurantId ?? state.restaurantId,
      restaurantName: extra.restaurantName ?? shop?.name ?? '',
      restaurant: extra.restaurantName ?? shop?.name ?? '',
      style: extra.style ?? legality().style
    };
  }

  /**
   * Perimeter ingredient ring + optional cooked-dish center (existing assets only).
   * Never invents art; empty center if no mapped hero/hq/dish PNG loads.
   */
  function renderHqOrStack(bowl, stack, ingredients, extra = {}) {
    if (!bowl || !stack) return;
    clearHqChrome(bowl);
    const gen = ++state.hqPlateGen;
    const ings = ingredients || [];
    renderPlateStack(stack, ings, extra);
    if (!ings.length) return;

    const FS = FiveStar();
    const artMap = state.fiveStarArt;
    if (!FS || !artMap) return;

    const ctx = hqContext(ings, extra);
    const resolved = FS.resolveCandidates(ctx, artMap, {
      namedDishArts: namedDishArtsFromCatalog()
    });

    if (resolved.quality) {
      bowl.classList.add('hq-plate');
      const cue = document.createElement('span');
      cue.className = 'hq-cue';
      cue.textContent = resolved.cue || '5-star quality';
      bowl.appendChild(cue);
    }

    FS.pickLoadable(resolved.candidates).then((cand) => {
      if (gen !== state.hqPlateGen) return;
      if (!cand?.file) return; // keep quiet empty center + ring
      bowl.classList.add('has-center-dish');
      if (resolved.quality) bowl.classList.add('hq-has-photo');
      setPlateCenter(stack, cand.file, ctx.dishName || 'plated dish');
    });
  }

  function renderMiniPlate(el, ingredients, extra = {}) {
    if (!el) return;
    const ings = ingredients || [];
    renderPlateStack(el, ings, extra);
    const FS = FiveStar();
    const artMap = state.fiveStarArt;
    if (!FS || !artMap || !ings.length) return;
    const ctx = hqContext(ings, extra);
    const resolved = FS.resolveCandidates(ctx, artMap, {
      namedDishArts: namedDishArtsFromCatalog()
    });
    FS.pickLoadable(resolved.candidates).then((cand) => {
      if (!cand?.file || !el.isConnected) return;
      setPlateCenter(el, cand.file, ctx.dishName || '');
      el.classList.add('has-center-dish');
    });
  }

  function renderGlyphMeters(el, ingredients) {
    const score = S.scoreDish(ingredients, state.catalog);
    const hearts = Math.max(0, Math.round(Number(score.flavor.happiness) || 0));
    const kcal = score.hunger?.kcal || 0;
    el.innerHTML = `
      <button type="button" class="glyph-meter stars" data-meter="stars">
        <span class="g-label">Stars</span>
        <span class="g-vis">${esc(score.stars.display)}</span>
        <span class="g-num">${esc(score.stars.label)}</span>
      </button>
      <button type="button" class="glyph-meter hunger" data-meter="hunger">
        <span class="g-label">Hunger</span>
        <span class="g-vis"><span class="g-fill" style="width:${score.hunger.pct}%"></span></span>
        <span class="g-num">${esc(score.hunger.label)}</span>
        <span class="g-kcal">${esc(String(kcal))} kcal</span>
      </button>
      <button type="button" class="glyph-meter flavor" data-meter="flavor">
        <span class="g-label">Flavor</span>
        <span class="g-vis"><span class="g-fill" style="width:${score.flavor.pct}%"></span></span>
        <span class="hearts">${'♥'.repeat(Math.min(5, Math.max(1, hearts))) || '♡'}</span>
      </button>
    `;
    el.querySelectorAll('.glyph-meter').forEach((btn) => {
      btn.addEventListener('click', () => openMeters(btn.dataset.meter, ingredients, score));
    });
    return score;
  }

  function openMeters(focus, ingredients, score) {
    const titles = { stars: 'Quality stars', hunger: 'Hunger + calories', flavor: 'Flavor → happiness / health' };
    $('#meters-dialog-title').textContent = titles[focus] || 'Meters';
    const parts = score[focus]?.parts || [];
    const box = $('#meters-breakdown');
    if (!parts.length && focus !== 'hunger') {
      box.innerHTML = `<p class="muted">Nothing on the plate for this meter yet.</p>`;
    } else {
      box.innerHTML = parts.map((p) => `
        <div class="star-row">
          <div class="ico">${artHtml(p.ingredient)}</div>
          <div class="pts">${
            focus === 'stars'
              ? `+${S.formatStars(p.value)}★`
              : focus === 'hunger'
                ? `${p.kcal ? `${p.kcal} kcal` : ''}${p.value ? ` · fill ${p.value}` : ''}`
                : `+${p.value}`
          }</div>
        </div>
      `).join('') || `<p class="muted">Nothing on the plate for this meter yet.</p>`;
    }
    if (focus === 'hunger' && score.hunger) {
      box.insertAdjacentHTML('beforeend',
        `<p class="muted" style="margin-top:0.5rem">${esc(String(score.hunger.kcal || 0))} kcal total · type fill ${esc(String(score.hunger.typeFill ?? ''))} · kcal fill ${esc(String(score.hunger.kcalFill ?? ''))}</p>`);
    }
    if (focus === 'flavor' && score.flavor) {
      box.insertAdjacentHTML('beforeend',
        `<p class="muted" style="margin-top:0.5rem">${'♥'.repeat(Math.min(5, Math.round(score.flavor.happiness) || 0))} happiness · health ${esc(score.flavor.health)}</p>`);
    }
    $('#meters-dialog').showModal();
  }

  function renderRecipeList(ingredients) {
    const el = $('#recipe-list');
    if (!el) return;
    // Fixed required lines only — slot options live in the Slots section
    const rows = sortedPlate(corePlateIngredients(ingredients));
    if (!rows.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = rows.map((ing) => `
      <li class="recipe-row ${state.armedSlotId ? 'slot-arm-target' : ''}" data-ing-id="${esc(ing.id)}" draggable="true">
        <span class="recipe-ico">${artHtml(ing)}</span>
        <span class="recipe-qty">${esc(servingLabel(ing))}</span>
        <span class="recipe-name">${esc(ing.name)}</span>
      </li>
    `).join('');
    el.querySelectorAll('.recipe-row').forEach((row) => {
      row.addEventListener('dragstart', (e) => {
        row.classList.add('dragging');
        e.dataTransfer.setData('text/ing-id', row.dataset.ingId);
        e.dataTransfer.setData('text/from-recipe', '1');
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('click', () => {
        if (!state.armedSlotId) return;
        const ing = state.byId.get(row.dataset.ingId);
        if (ing) addOptionToSlot(state.armedSlotId, ing, { moveOffPlate: true });
      });
    });
    enhanceArtImages(el);
  }

  function renderRestaurantRail() {
    const el = $('#restaurant-rail');
    if (!el) return;
    const lock = S.restaurantLock(state.selected.map((i) => i.name));
    el.innerHTML = RESTAURANTS.map((r) => {
      const blocked = lock?.only && lock.id !== r.id;
      const active = state.restaurantId === r.id;
      return `<button type="button" class="restaurant-chip ${active ? 'active' : ''} ${blocked ? 'blocked' : ''}"
        data-rest="${esc(r.id)}" ${blocked ? 'disabled' : ''} aria-pressed="${active}">${esc(r.name)}</button>`;
    }).join('');
    el.querySelectorAll('.restaurant-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const id = btn.dataset.rest;
        state.restaurantId = state.restaurantId === id ? null : id;
        refreshAutoName();
        renderRestaurantRail();
      });
    });
  }

  /* —— locker —— */
  function renderStageRail() {
    const el = $('#stage-rail');
    if (!el) return;
    el.querySelectorAll('.stage-chip').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.stage === state.stage);
      btn.onclick = () => {
        state.stage = btn.dataset.stage || 'all';
        renderStageRail();
        renderGrid();
      };
    });
  }

  function renderFormRail() {
    const el = $('#form-rail');
    if (!el) return;
    el.querySelectorAll('.form-chip').forEach((btn) => {
      const form = btn.dataset.form || '';
      const on = state.formFilter === form;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.onclick = () => {
        state.formFilter = on ? '' : form;
        renderFormRail();
        renderGrid();
      };
    });
  }

  function renderTypeRail() {
    const order = state.catalog.typeOrder;
    $('#type-rail').innerHTML = order.map((t) => `
      <button type="button" class="type-chip ${t === state.type ? 'active' : ''}" data-type="${esc(t)}">${esc(t)}</button>
    `).join('');
    $('#type-rail').querySelectorAll('.type-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.type = btn.dataset.type;
        state.family = '__all__';
        renderTypeRail();
        renderFamilies();
        renderGrid();
      });
    });
  }

  function renderFamilies() {
    const fams = Object.keys(state.catalog.hierarchy[state.type] || {});
    const allLabel = `All ${state.type || ''}`.trim();
    $('#family-tabs').innerHTML = [
      `<button type="button" class="family-tab ${state.family === '__all__' ? 'active' : ''}" data-family="__all__">${esc(allLabel)}</button>`,
      ...fams.map((f) => `
        <button type="button" class="family-tab ${f === state.family ? 'active' : ''}" data-family="${esc(f)}">${esc(f)}</button>
      `)
    ].join('');
    $('#family-tabs').querySelectorAll('.family-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.family = btn.dataset.family;
        renderFamilies();
        renderGrid();
      });
    });
  }

  function passStage(ing) {
    if (state.stage === 'all') return true;
    // Legacy Made ≈ Processed for filter continuity
    const want = state.stage === 'made' ? 'processed' : state.stage;
    const kind = ingredientUseKind(ing);
    if (!kind) return false;
    return kind === want;
  }

  /**
   * Among ingredients sharing one art file, pick the locker tile identity.
   * Prefer a name that matches the filename stem (Tomatoes ← 1_supply_tomatoes);
   * otherwise the shortest name. Catalog rows are left intact.
   */
  function pickCanonicalLockerIngredient(ings, artPath) {
    const list = (ings || []).filter(Boolean);
    if (list.length <= 1) return list[0] || null;
    const stemTitle = humanizeArtStem(artStem(artPath)).toLowerCase();
    const byStem = list.filter((ing) => String(ing.name || '').trim().toLowerCase() === stemTitle);
    const pool = byStem.length ? byStem : list;
    return pool.slice().sort((a, b) => {
      const dn = String(a.name || '').length - String(b.name || '').length;
      if (dn) return dn;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })[0];
  }

  /** One locker tile per food object (shared art / same object key). Empty holes fold into a painted sibling when one exists. */
  function dedupeLockerByArt(ings) {
    const list = (ings || []).filter(Boolean);
    const parent = new Map();
    const find = (k) => {
      if (!parent.has(k)) parent.set(k, k);
      const p = parent.get(k);
      if (p !== k) {
        const root = find(p);
        parent.set(k, root);
        return root;
      }
      return k;
    };
    const union = (a, b) => {
      if (!a || !b) return;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };

    list.forEach((ing) => {
      const id = `ing:${ing.id}`;
      union(id, `title:${String(ing.name || '').trim().toLowerCase()}`);
      union(id, `obj:${objectKeyFromLabel(ing.name)}`);
      const art = normalizeArtPath(ing.art);
      if (art && !isArtDeleted(art)) union(id, `art:${art}`);
      (ing.aliases || []).forEach((al) => {
        const a = String(al || '').trim();
        if (!a) return;
        union(id, `title:${a.toLowerCase()}`);
        union(id, `obj:${objectKeyFromLabel(a)}`);
      });
    });

    const groups = new Map();
    list.forEach((ing) => {
      const root = find(`ing:${ing.id}`);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(ing);
    });

    const out = [];
    const seenFace = new Set();
    groups.forEach((group) => {
      splitLockerGroupsByObjectKey(group).forEach((part) => {
        const withArt = part.filter((g) => artPathUsable(g.art));
        const withAnyArt = part.filter((g) => normalizeArtPath(g.art) && !isArtDeleted(g.art));
        const pool = withArt.length ? withArt : (withAnyArt.length ? withAnyArt : part);
        const face = pool.slice().sort((a, b) => (
          scoreFaceCandidate({ art: b.art, label: b.name, fromCatalog: true })
          - scoreFaceCandidate({ art: a.art, label: a.name, fromCatalog: true })
        ))[0];
        if (!face || seenFace.has(face.id)) return;
        seenFace.add(face.id);
        out.push(face);
      });
    });
    return out;
  }

  function familyIngredients() {
    const q = (state.lockerSearch || '').trim().toLowerCase();
    const seen = new Set();
    const take = (ing) => {
      if (!ing || seen.has(ing.id)) return false;
      if (state.unlockedOnly && ing.unlocked === false) return false;
      if (!passStage(ing)) return false;
      if (!matchesLockerSearch(ing, q)) return false;
      seen.add(ing.id);
      return true;
    };

    // Search spans the whole locker so “ramen” finds noodles from any type chip.
    if (q) {
      return dedupeLockerByArt(
        state.catalog.ingredients.filter(take)
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      );
    }

    const hier = state.catalog.hierarchy[state.type] || {};
    let ids = [];
    if (state.family === '__all__') {
      Object.values(hier).forEach((arr) => { ids.push(...(arr || [])); });
    } else {
      ids = hier[state.family] || [];
    }
    return dedupeLockerByArt(ids.map((id) => state.byId.get(id)).filter(take));
  }

  /**
   * Long-press (~480ms) or double-click / second-tap-within-~350ms → open detail.
   * Single tap (after double-tap window) runs onSingleTap when provided (locker add/arm).
   * Long-press must not also fire the single-tap action.
   */
  function bindPressOpenDetail(el, openFn, { onSingleTap = null } = {}) {
    let pressTimer = null;
    let longFired = false;
    let lastTapAt = 0;
    let singleTimer = null;

    const clearPress = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    };
    const clearSingle = () => {
      if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; }
    };
    const blockedTarget = (target) => Boolean(
      target?.closest?.('select, input, textarea, label.gal-miss-drop, a, menu button, .gal-flag-clear, .detail-flag')
    );

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    el.addEventListener('pointerdown', (e) => {
      if (blockedTarget(e.target)) return;
      longFired = false;
      try { el.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      pressTimer = setTimeout(() => {
        longFired = true;
        clearSingle();
        lastTapAt = 0;
        openFn();
      }, 480);
    });

    el.addEventListener('pointerup', (e) => {
      clearPress();
      if (longFired) return;
      if (blockedTarget(e.target)) return;
      const now = Date.now();
      if (lastTapAt && now - lastTapAt < 350) {
        lastTapAt = 0;
        clearSingle();
        openFn();
        return;
      }
      lastTapAt = now;
      if (!onSingleTap) return;
      clearSingle();
      singleTimer = setTimeout(() => {
        singleTimer = null;
        onSingleTap();
      }, 350);
    });

    el.addEventListener('pointercancel', () => {
      clearPress();
      clearSingle();
    });
    el.addEventListener('pointerleave', clearPress);

    el.addEventListener('dblclick', (e) => {
      if (blockedTarget(e.target)) return;
      e.preventDefault();
      clearPress();
      clearSingle();
      lastTapAt = 0;
      openFn();
    });

    el.addEventListener('dragstart', () => {
      clearPress();
      clearSingle();
      lastTapAt = 0;
      longFired = true; // suppress the following pointerup single-tap
    });
  }

  function bindTileGestures(btn, ing) {
    bindPressOpenDetail(
      btn,
      () => openDetail(ing, { forceChain: true }),
      {
        onSingleTap: () => {
          if (state.armedSlotId && state.mode === 'dish') {
            addOptionToSlot(state.armedSlotId, ing, { moveOffPlate: false });
            return;
          }
          addToPlate(ing);
        }
      }
    );

    // drag onto plate / slot (desktop)
    btn.addEventListener('dragstart', (e) => {
      btn.classList.add('dragging');
      e.dataTransfer.setData('text/ing-id', ing.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    btn.addEventListener('dragend', () => btn.classList.remove('dragging'));
    btn.setAttribute('draggable', 'true');
  }

  function sectionHeadHtml(label) {
    return `<div class="ing-section-head" role="presentation">${esc(label)}</div>`;
  }

  function groupInOrder(items, keyFn) {
    const order = [];
    const map = new Map();
    (items || []).forEach((item) => {
      const key = keyFn(item) || 'Other';
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key).push(item);
    });
    return order.map((key) => ({ key, items: map.get(key) }));
  }

  function lockerSectionLabel(ing) {
    if (state.family === '__all__') {
      return ing.uiFamily || ing.category || 'Other';
    }
    return ing.category || ing.uiFamily || state.family || 'Other';
  }

  function renderGrid() {
    const ings = applyLockerFormFilter(familyIngredients());
    const sel = selectedIds();
    const armed = Boolean(state.armedSlotId && state.mode === 'dish');
    const emptyMsg = state.lockerSearch.trim()
      ? 'No ingredients match'
      : (state.formFilter
        ? `No ${state.formFilter} forms here`
        : (state.stage !== 'all' ? `No ${state.stage} ingredients here` : 'Empty family'));
    const grid = $('#ingredient-grid');
    grid.classList.toggle('slot-arming', armed);

    if (!ings.length) {
      grid.innerHTML = `<p class="muted" style="grid-column:1/-1;text-align:center">${esc(emptyMsg)}</p>`;
      return;
    }

    const groups = groupInOrder(ings, lockerSectionLabel);
    const showHeads = groups.length > 1;
    grid.innerHTML = groups.map(({ key, items }) => `
      ${showHeads ? sectionHeadHtml(key) : ''}
      ${items.map((ing) => {
        const faceForm = ing._formFace || inferPaintingForm(ing.art, ing._formLabel || ing.name);
        const badge = (faceForm && faceForm !== 'whole') ? formBadgeHtml(faceForm, 'on-tile') : '';
        return `
        <button type="button" class="ing-tile ${sel.has(ing.id) ? 'selected' : ''} ${ingredientNeedsArt(ing) ? 'missing-art' : ''} ${isArtBroken(ing.art) ? 'broken-art' : ''} ${isMade(ing) ? 'is-made' : ''}"
          data-id="${esc(ing.id)}" aria-label="${esc(ing.name)}">
          ${isMade(ing) ? '<span class="chain-cue" title="Process chain" aria-hidden="true"></span>' : ''}
          ${ingredientHasFlaggedArt(ing) ? '<span class="ing-flag-badge" title="Flagged" aria-label="Flagged">⚑</span>' : ''}
          ${badge}
          ${artHtml(ing)}
        </button>`;
      }).join('')}
    `).join('');

    grid.querySelectorAll('.ing-tile').forEach((btn) => {
      const ing = state.byId.get(btn.dataset.id);
      bindTileGestures(btn, ing);
    });
    enhanceArtImages(grid);
  }

  function addToPlate(ing) {
    if (!ing) return;
    if (state.mode === 'ingredient') {
      fillProcessSlot(ing);
      return;
    }
    if (selectedIds().has(ing.id)) {
      // tap again removes
      state.selected = state.selected.filter((x) => x.id !== ing.id);
      renderTray();
      renderGrid();
      return;
    }
    if (state.selected.length >= (state.catalog.maxDishIngredients || 5)) {
      $('#tray-hint').textContent = `Plate full (${state.catalog.maxDishIngredients})`;
      return;
    }
    state.selected.push(ing);
    const legal = legality();
    $('#tray-hint').textContent = legal.ok ? '' : `Blocked: ${legal.reason}`;
    renderTray();
    renderGrid();
  }

  const DETAIL_NEW_FAMILY = '__new_family__';

  function detailTypeOptions(currentType) {
    const order = Array.isArray(state.catalog?.typeOrder) ? state.catalog.typeOrder.slice() : [];
    const cur = String(currentType || '').trim();
    if (cur && !order.includes(cur)) order.push(cur);
    return order;
  }

  function detailFamilyOptions(uiType, currentFamily) {
    const fams = Object.keys((state.catalog?.hierarchy || {})[uiType] || {});
    const cur = String(currentFamily || '').trim();
    if (cur && !fams.includes(cur)) fams.push(cur);
    fams.sort((a, b) => a.localeCompare(b));
    return fams;
  }

  /** Type + Family + Kind selects for catalog ingredients only (drives locker placement). */
  function detailCategoryControlsHtml(ing) {
    if (!ing?.id || !state.byId.has(ing.id)) return '';
    const curType = String(ing.uiType || ing.group || '').trim() || 'Other';
    const curFamily = String(ing.uiFamily || ing.category || '').trim();
    const curKind = ingredientUseKind(ing);
    const typeOpts = detailTypeOptions(curType).map((t) =>
      `<option value="${esc(t)}"${t === curType ? ' selected' : ''}>${esc(t)}</option>`
    ).join('');
    const familyOpts = detailFamilyOptions(curType, curFamily).map((f) =>
      `<option value="${esc(f)}"${f === curFamily ? ' selected' : ''}>${esc(f)}</option>`
    ).join('');
    const kindOpts = [
      ...(!curKind ? ['<option value="" selected>—</option>'] : []),
      ...USE_KIND_OPTIONS.map((o) =>
        `<option value="${esc(o.value)}"${o.value === curKind ? ' selected' : ''}>${esc(o.label)}</option>`
      )
    ].join('');
    const hint = USE_KIND_HINTS[curKind] || 'Not on the use tree (pantry input / livestock) — pick a kind to include';
    return `
      <div class="detail-category" data-ing-id="${esc(ing.id)}">
        <label class="detail-cat-field">
          <span class="detail-cat-label">Type</span>
          <select class="detail-cat-select" id="detail-ui-type" aria-label="Type">${typeOpts}</select>
        </label>
        <label class="detail-cat-field">
          <span class="detail-cat-label">Family</span>
          <select class="detail-cat-select" id="detail-ui-family" aria-label="Family">
            ${familyOpts}
            <option value="${DETAIL_NEW_FAMILY}">＋ New family</option>
          </select>
        </label>
        <label class="detail-cat-field detail-cat-new-family" id="detail-new-family-wrap" hidden>
          <span class="detail-cat-label">New family</span>
          <input type="text" class="detail-cat-input" id="detail-new-family" placeholder="Family name" maxlength="48" autocomplete="off" />
        </label>
        <label class="detail-cat-field detail-cat-kind">
          <span class="detail-cat-label">Kind</span>
          <select class="detail-cat-select" id="detail-use-kind" aria-label="Kind">${kindOpts}</select>
        </label>
        <p class="detail-kind-hint" id="detail-kind-hint">${esc(hint)}</p>
      </div>`;
  }

  function persistIngredientMeta(ing) {
    persistIngredientArt(ing);
  }

  function applyIngredientCategory(ingId, uiType, uiFamily) {
    const ing = state.byId.get(ingId);
    if (!ing) return null;
    const type = String(uiType || '').trim() || 'Other';
    const family = String(uiFamily || '').trim() || 'Misc';
    ing.uiType = type;
    ing.uiFamily = family;
    ing.group = type;
    ing.category = family;
    ensureIngredientInHierarchy(ing);
    persistIngredientMeta(ing);
    rebuildIndexes();
    renderTypeRail();
    renderFamilies();
    renderGrid();
    renderGallery();
    return ing;
  }

  function applyIngredientUseKind(ingId, useKind) {
    const ing = state.byId.get(ingId);
    if (!ing) return null;
    const next = Sync().normalizeUseKind
      ? Sync().normalizeUseKind(useKind)
      : String(useKind || '').trim().toLowerCase();
    ing.useKind = next;
    persistIngredientMeta(ing);
    rebuildIndexes();
    renderGrid();
    renderGallery();
    return ing;
  }

  /** Migrate face-art + flag metadata when objectKey changes with a rename. */
  function migrateObjectKeyMeta(oldName, newName) {
    const oldKey = objectKeyFromLabel(oldName);
    const newKey = objectKeyFromLabel(newName);
    if (!oldKey || !newKey || oldKey === newKey) return;

    const faceMap = loadFaceArtMap();
    if (faceMap[oldKey]) {
      if (!faceMap[newKey]) faceMap[newKey] = faceMap[oldKey];
      delete faceMap[oldKey];
      saveFaceArtMap(faceMap);
    }

    const flagMap = loadFlaggedArtMap();
    let flagsDirty = false;
    Object.keys(flagMap).forEach((path) => {
      const meta = flagMap[path];
      if (!meta) return;
      if (meta.objectKey === oldKey) {
        meta.objectKey = newKey;
        flagsDirty = true;
      }
      if (meta.label && String(meta.label).trim() === String(oldName).trim()) {
        meta.label = newName;
        flagsDirty = true;
      }
    });
    if (flagsDirty) saveFlaggedArtMap(flagMap);
  }

  function applyIngredientName(ingId, nextName) {
    const ing = state.byId.get(ingId);
    if (!ing) return null;
    const name = String(nextName || '').trim();
    if (!name) return null;
    const oldName = String(ing.name || '').trim();
    if (name === oldName) return ing;

    const clash = state.byName.get(name.toLowerCase());
    if (clash && clash.id !== ingId) return null;

    migrateObjectKeyMeta(oldName, name);
    ing.name = name;
    if (Array.isArray(ing.chain) && ing.chain.length) {
      ing.chain = ing.chain.map((c) => (String(c) === oldName ? name : c));
    } else {
      ing.chain = [name];
    }
    persistIngredientMeta(ing);
    rebuildIndexes();
    renderGrid();
    renderTray();
    renderGallery();
    return ing;
  }

  function refreshOpenDetail(ing, { forceChain = false } = {}) {
    const catalog = ing?.id ? state.byId.get(ing.id) : null;
    const base = catalog || ing;
    if (!base) return;
    const next = resolveGalleryObject({ ...base, name: base.name, art: base.art, _galleryObject: null });
    openDetail(next ? (ingredientForGalleryItem(next) || base) : base, { forceChain });
  }

  function detailNameHtml(ing, displayName) {
    const inCatalog = Boolean(ing?.id && state.byId.has(ing.id));
    if (!inCatalog) {
      return `<p class="detail-name">${esc(displayName)}</p>`;
    }
    return `
      <label class="detail-name-field" for="detail-food-name">
        <span class="sr-only">Name</span>
        <input type="text" class="detail-name-input" id="detail-food-name"
          value="${esc(displayName)}" maxlength="64" autocomplete="off"
          enterkeyhint="done" aria-label="Food name" />
      </label>`;
  }

  function bindDetailNameControl(ing, { forceChain = false } = {}) {
    if (!ing?.id || !state.byId.has(ing.id)) return;
    const input = $('#detail-food-name');
    if (!input) return;

    let committing = false;
    const commit = () => {
      if (committing) return;
      const next = String(input.value || '').trim();
      const catalog = state.byId.get(ing.id);
      const current = String(catalog?.name || '').trim();
      if (!next) {
        input.value = current;
        return;
      }
      if (next === current) {
        input.value = current;
        return;
      }
      const clash = state.byName.get(next.toLowerCase());
      if (clash && clash.id !== ing.id) {
        input.value = current;
        return;
      }
      committing = true;
      applyIngredientName(ing.id, next);
      refreshOpenDetail(ing, { forceChain });
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        const catalog = state.byId.get(ing.id);
        input.value = String(catalog?.name || '').trim();
        input.blur();
      }
    });
    // Keep Enter from submitting the method=dialog form (would close + Add).
    input.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    input.addEventListener('blur', commit);
  }

  function bindDetailCategoryControls(ing, { forceChain = false } = {}) {
    if (!ing?.id || !state.byId.has(ing.id)) return;
    const typeSel = $('#detail-ui-type');
    const famSel = $('#detail-ui-family');
    const kindSel = $('#detail-use-kind');
    const kindHint = $('#detail-kind-hint');
    const newWrap = $('#detail-new-family-wrap');
    const newInput = $('#detail-new-family');
    if (!typeSel || !famSel) return;

    let committing = false;
    const commitNewFamily = () => {
      if (committing) return;
      const name = String(newInput?.value || '').trim();
      if (!name) return;
      committing = true;
      applyIngredientCategory(ing.id, typeSel.value, name);
      refreshOpenDetail(ing, { forceChain });
    };

    typeSel.addEventListener('change', () => {
      const type = typeSel.value;
      if (famSel.value === DETAIL_NEW_FAMILY && !String(newInput?.value || '').trim()) {
        const catalogIng = state.byId.get(ing.id);
        const keepFamily = catalogIng?.uiFamily || catalogIng?.category || 'Misc';
        applyIngredientCategory(ing.id, type, keepFamily);
        refreshOpenDetail(ing, { forceChain });
        return;
      }
      const family = famSel.value === DETAIL_NEW_FAMILY
        ? String(newInput?.value || '').trim()
        : famSel.value;
      applyIngredientCategory(ing.id, type, family || 'Misc');
      refreshOpenDetail(ing, { forceChain });
    });

    famSel.addEventListener('change', () => {
      if (famSel.value === DETAIL_NEW_FAMILY) {
        if (newWrap) newWrap.hidden = false;
        newInput?.focus();
        return;
      }
      if (newWrap) newWrap.hidden = true;
      if (newInput) newInput.value = '';
      applyIngredientCategory(ing.id, typeSel.value, famSel.value);
      refreshOpenDetail(ing, { forceChain });
    });

    kindSel?.addEventListener('change', () => {
      const value = kindSel.value;
      applyIngredientUseKind(ing.id, value);
      if (kindHint) {
        kindHint.textContent = USE_KIND_HINTS[value]
          || 'Not on the use tree (pantry input / livestock) — pick a kind to include';
      }
      renderStageRail();
      renderGrid();
    });

    newInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitNewFamily();
      }
    });
    newInput?.addEventListener('blur', () => {
      if (famSel.value === DETAIL_NEW_FAMILY) commitNewFamily();
    });
  }

  /** Catalog names + paintings for this food object (detail-only; grid stays one tile). */
  function resolveGalleryObject(ing) {
    if (ing?._galleryObject) return ing._galleryObject;
    const items = paintedGalleryItems();
    const art = normalizeArtPath(ing?.art);
    const key = objectKeyFromLabel(ing?.name);
    return items.find((it) => (
      it.objectKey === key
      || (art && normalizeArtPath(it.art) === art)
      || (it.ingredients || []).some((x) => x.id === ing?.id)
      || (it.names || []).some((n) => String(n).toLowerCase() === String(ing?.name || '').toLowerCase())
    )) || null;
  }

  function showsDetailVariants(ing) {
    const obj = resolveGalleryObject(ing);
    const paintings = obj?.paintings || [];
    const names = obj?.names || sharedArtNames(ing);
    const holes = obj?.holes || [];
    return paintings.length > 1 || names.length > 1 || holes.length > 0;
  }

  function detailFlagControlsHtml(artPath, { label = '', objectKey = '' } = {}) {
    const path = normalizeArtPath(artPath);
    if (!path || isArtDeleted(path)) return '';
    const flag = getArtFlag(path);
    const attrs = `data-art="${esc(path)}" data-object-key="${esc(objectKey || '')}" data-label="${esc(label || '')}"`;
    const choices = `
      <div class="detail-flag-choices" hidden>
        <button type="button" class="detail-flag-reedit" data-kind="reedit" ${attrs}>Re-edit</button>
        <button type="button" class="detail-flag-regen" data-kind="regen" ${attrs}>Regen</button>
        <button type="button" class="detail-flag-cancel">Cancel</button>
      </div>`;
    if (flag) {
      const kindLabel = flag.kind === 'regen' ? 'Regen' : 'Re-edit';
      return `
        <div class="detail-flag is-flagged" ${attrs}>
          <button type="button" class="detail-flag-chip kind-${esc(flag.kind)}" ${attrs} aria-label="Change flag kind">${esc(kindLabel)}</button>
          <button type="button" class="detail-flag-clear" ${attrs}>Clear</button>
          ${choices}
        </div>`;
    }
    return `
      <div class="detail-flag" ${attrs}>
        <button type="button" class="detail-flag-start" ${attrs}>Flag</button>
        ${choices}
      </div>`;
  }

  function detailVariantsHtml(ing) {
    const obj = resolveGalleryObject(ing);
    const paintings = obj?.paintings || [];
    const names = obj?.names || sharedArtNames(ing);
    const holes = obj?.holes || [];
    if (paintings.length <= 1 && names.length <= 1 && !holes.length) return '';

    const faceArt = normalizeArtPath(ing?.art || obj?.art);
    const objectKey = obj?.objectKey || objectKeyFromLabel(ing?.name) || '';
    const paintRows = paintings.map((p) => {
      const isFace = normalizeArtPath(p.art) === faceArt;
      const status = !p.usable
        ? (p.broken ? 'broken' : 'unavailable')
        : (isFace ? 'grid face' : 'alt');
      const form = inferPaintingForm(p.art, p.label);
      const thumb = p.usable
        ? `<img class="art-fit" src="${esc(resolveArtSrc(p.art))}" alt="" draggable="false" data-art="${esc(p.art)}" />`
        : `<span class="name-fallback art-broken">?</span>`;
      const useBtn = p.usable
        ? `<button type="button" class="detail-variant-use" data-art="${esc(p.art)}" data-object-key="${esc(objectKey)}">Use as grid picture</button>`
        : '';
      const flagHtml = detailFlagControlsHtml(p.art, { label: p.label, objectKey });
      return `<div class="detail-variant-row" data-art="${esc(p.art)}">
        <div class="detail-variant-thumb">${thumb}${formBadgeHtml(form, 'on-variant')}</div>
        <div class="detail-variant-copy">
          <div class="detail-variant-name">${esc(p.label)}</div>
          <div class="detail-variant-meta">${esc(status)}</div>
          <div class="detail-variant-actions">
            ${useBtn}
            ${flagHtml}
            <button type="button" class="detail-variant-delete" data-art="${esc(p.art)}" data-object-key="${esc(objectKey)}">Delete</button>
          </div>
          <div class="detail-variant-delete-confirm" hidden>
            <p class="detail-delete-warn">Permanently hide this picture only. Other variants stay.</p>
            <button type="button" class="detail-variant-delete-confirm-btn" data-art="${esc(p.art)}" data-object-key="${esc(objectKey)}">Permanently delete</button>
            <button type="button" class="detail-variant-delete-cancel-btn">Cancel</button>
          </div>
        </div>
      </div>`;
    }).join('');

    const nameList = names.length
      ? `<p class="detail-shared">Names on this food:
          ${names.map((n) => esc(n)).join(', ')}
        </p>`
      : '';
    const holeList = holes.length
      ? `<p class="detail-shared">Needs a picture:
          ${holes.map((h) => esc(h.name)).join(', ')}
        </p>`
      : '';

    return `
      <div class="detail-variants">
        <h3>Pictures for this food</h3>
        ${nameList}
        ${holeList}
        <div class="detail-variant-list">${paintRows || '<p class="detail-reassign-empty">No paintings yet.</p>'}</div>
      </div>`;
  }

  function sharedArtNames(ing) {
    const obj = ing?._galleryObject;
    if (obj?.names?.length) return obj.names.slice();
    const art = normalizeArtPath(ing?.art);
    const names = [];
    const seen = new Set();
    const push = (n) => {
      const key = String(n || '').trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      names.push(String(n).trim());
    };
    if (art) {
      (state.catalog.ingredients || []).forEach((other) => {
        if (normalizeArtPath(other.art) === art) push(other.name);
      });
    }
    const key = objectKeyFromLabel(ing?.name);
    if (key) {
      (state.catalog.ingredients || []).forEach((other) => {
        if (objectKeyFromLabel(other.name) === key) push(other.name);
      });
    }
    if (!names.length) push(ing?.name);
    return names;
  }

  function detailReassignHtml(ing) {
    const artPath = normalizeArtPath(ing?.art);
    if (!artPath || isArtBroken(artPath) || isArtDeleted(artPath)) return '';
    const missing = missingArtIngredients().filter((m) => m.id !== ing.id);
    const list = missing.length
      ? missing.map((m) => {
        const bits = [m.uiType, m.uiFamily || m.category].filter(Boolean).join(' · ');
        const why = !normalizeArtPath(m.art) ? 'empty' : (isArtDeleted(m.art) ? 'deleted' : 'broken');
        return `<button type="button" class="detail-reassign-btn" data-missing-id="${esc(m.id)}">
          ${esc(m.name)}
          <span class="meta">${esc(bits || why)} · ${esc(why)}</span>
        </button>`;
      }).join('')
      : `<p class="detail-reassign-empty">No missing catalog names right now.</p>`;
    return `
      <div class="detail-reassign">
        <h3>Give this picture to a missing name</h3>
        <div class="detail-reassign-list">${list}</div>
      </div>`;
  }

  function detailDeleteHtml(ing) {
    const artPath = normalizeArtPath(ing?.art);
    if (!artPath || isArtDeleted(artPath)) return '';
    const obj = resolveGalleryObject(ing);
    const label = obj?.title || sharedArtNames(ing)[0] || ing?.name || '';
    const objectKey = obj?.objectKey || objectKeyFromLabel(label) || '';
    const flagHtml = showsDetailVariants(ing)
      ? ''
      : detailFlagControlsHtml(artPath, { label, objectKey });
    return `
      <div class="detail-delete">
        ${flagHtml}
        <button type="button" class="detail-delete-start" id="detail-delete-start">Delete picture</button>
        <div class="detail-delete-confirm" id="detail-delete-confirm" hidden>
          <p class="detail-delete-warn">Permanently hide this picture on this device. Shared names become Missing. Close stays safe.</p>
          <button type="button" class="detail-delete-confirm-btn" id="detail-delete-confirm-btn">Permanently delete</button>
          <button type="button" class="detail-delete-cancel-btn" id="detail-delete-cancel-btn">Cancel</button>
        </div>
      </div>`;
  }

  function openDetail(ing, { forceChain = false } = {}) {
    const obj = resolveGalleryObject(ing) || ing?._galleryObject || null;
    if (obj && !ing._galleryObject) {
      ing = { ...ing, art: obj.art || ing.art, name: obj.title || ing.name, _galleryObject: obj };
    }
    state.detailIng = ing;
    const onPlate = ing?.id && selectedIds().has(ing.id);
    const inCatalog = Boolean(ing?.id && state.byId.has(ing.id));
    const chain = resolveChainIngs(ing);
    const showChain = forceChain || isMade(ing) || chain.length > 1;
    const displayName = obj?.title || sharedArtNames(ing)[0] || ing?.name || '';

    $('#detail-body').innerHTML = `
      <div class="detail-hero">
        <div class="big-ico">${artHtml(ing)}</div>
        ${detailNameHtml(ing, displayName)}
        ${detailCategoryControlsHtml(ing)}
      </div>
      ${showChain ? `
        <div class="chain-row" aria-label="Process chain">
          ${chain.map((c, i) => `
            ${i ? '<span class="chain-arrow">→</span>' : ''}
            <div class="chain-step" title="${esc(c.name)}">${artHtml(c)}</div>
          `).join('')}
        </div>
      ` : ''}
      ${detailVariantsHtml(ing)}
      ${detailReassignHtml(ing)}
      ${detailDeleteHtml(ing)}
    `;

    const toggle = $('#detail-toggle');
    if (toggle) {
      toggle.hidden = !inCatalog;
      toggle.textContent = state.armedSlotId && state.mode === 'dish'
        ? 'Add to slot'
        : (onPlate ? 'Remove' : 'Add to plate');
    }

    $('#detail-body').querySelectorAll('.detail-reassign-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const missingId = btn.getAttribute('data-missing-id');
        const artPath = normalizeArtPath(ing.art);
        if (!missingId || !artPath) return;
        assignArtToIngredient(missingId, artPath);
        $('#detail-dialog')?.close();
      });
    });

    $('#detail-body').querySelectorAll('.detail-variant-use').forEach((btn) => {
      btn.addEventListener('click', () => {
        const artPath = btn.getAttribute('data-art');
        const objectKey = btn.getAttribute('data-object-key') || objectKeyFromLabel(displayName);
        if (!artPath || !objectKey) return;
        setFaceArtForObject(objectKey, artPath);
        // Prefer assigning the face onto the canonical catalog row when present
        const canonical = obj?.faceIng || obj?.ingredients?.[0];
        if (canonical?.id && state.byId.has(canonical.id)) {
          // Keep other catalog rows' own arts; only update face preference + display
          // If canonical has empty/broken art, fill it with the chosen painting.
          if (ingredientNeedsArt(canonical)) {
            assignArtToIngredient(canonical.id, artPath);
          } else {
            renderGrid();
            renderGallery();
          }
        } else {
          renderGrid();
          renderGallery();
        }
        const next = resolveGalleryObject({ ...ing, name: displayName, art: artPath, _galleryObject: null });
        openDetail(ingredientForGalleryItem(next) || { ...ing, art: artPath }, { forceChain });
      });
    });

    $('#detail-body').querySelectorAll('.detail-variant-row').forEach((row) => {
      const delBtn = row.querySelector('.detail-variant-delete');
      const confirmWrap = row.querySelector('.detail-variant-delete-confirm');
      const confirmBtn = row.querySelector('.detail-variant-delete-confirm-btn');
      const cancelBtn = row.querySelector('.detail-variant-delete-cancel-btn');
      const actions = row.querySelector('.detail-variant-actions');
      delBtn?.addEventListener('click', () => {
        if (confirmWrap) confirmWrap.hidden = false;
        if (actions) actions.hidden = true;
      });
      cancelBtn?.addEventListener('click', () => {
        if (confirmWrap) confirmWrap.hidden = true;
        if (actions) actions.hidden = false;
      });
      confirmBtn?.addEventListener('click', () => {
        const artPath = normalizeArtPath(confirmBtn.getAttribute('data-art'));
        const objectKey = confirmBtn.getAttribute('data-object-key') || obj?.objectKey || objectKeyFromLabel(displayName);
        if (!artPath) return;
        permanentlyDeleteArt(artPath, { objectKey });
        const next = resolveGalleryObject({
          name: displayName,
          art: '',
          _galleryObject: null,
          id: ing?.id
        });
        if (next?.paintings?.length) {
          openDetail(ingredientForGalleryItem(next), { forceChain });
        } else {
          $('#detail-dialog')?.close();
        }
      });
    });

    const refreshDetailAfterFlag = () => {
      const next = resolveGalleryObject({
        ...ing,
        name: displayName,
        art: ing.art,
        _galleryObject: null
      });
      openDetail(ingredientForGalleryItem(next) || ing, { forceChain });
      renderGallery();
      renderGrid();
    };

    $('#detail-body').querySelectorAll('.detail-flag').forEach((wrap) => {
      const choices = wrap.querySelector('.detail-flag-choices');
      const startBtn = wrap.querySelector('.detail-flag-start');
      const chipBtn = wrap.querySelector('.detail-flag-chip');
      const clearBtn = wrap.querySelector('.detail-flag-clear');
      const showChoices = () => {
        if (choices) choices.hidden = false;
        if (startBtn) startBtn.hidden = true;
        if (chipBtn) chipBtn.hidden = true;
        if (clearBtn) clearBtn.hidden = true;
      };
      const hideChoices = () => {
        if (choices) choices.hidden = true;
        if (startBtn) startBtn.hidden = false;
        if (chipBtn) chipBtn.hidden = false;
        if (clearBtn) clearBtn.hidden = false;
      };
      startBtn?.addEventListener('click', showChoices);
      chipBtn?.addEventListener('click', showChoices);
      wrap.querySelector('.detail-flag-cancel')?.addEventListener('click', hideChoices);
      wrap.querySelectorAll('.detail-flag-reedit, .detail-flag-regen').forEach((btn) => {
        btn.addEventListener('click', () => {
          const artPath = normalizeArtPath(btn.getAttribute('data-art') || wrap.getAttribute('data-art'));
          const kind = btn.getAttribute('data-kind');
          const label = btn.getAttribute('data-label') || wrap.getAttribute('data-label') || displayName;
          const objectKey = btn.getAttribute('data-object-key')
            || wrap.getAttribute('data-object-key')
            || obj?.objectKey
            || objectKeyFromLabel(displayName);
          if (!artPath || !kind) return;
          setArtFlag(artPath, kind, { label, objectKey });
          refreshDetailAfterFlag();
        });
      });
      clearBtn?.addEventListener('click', () => {
        const artPath = normalizeArtPath(clearBtn.getAttribute('data-art') || wrap.getAttribute('data-art'));
        if (!artPath) return;
        clearArtFlag(artPath);
        refreshDetailAfterFlag();
      });
    });

    const deleteStart = $('#detail-delete-start');
    const deleteConfirmWrap = $('#detail-delete-confirm');
    const deleteConfirmBtn = $('#detail-delete-confirm-btn');
    const deleteCancelBtn = $('#detail-delete-cancel-btn');
    deleteStart?.addEventListener('click', () => {
      if (deleteConfirmWrap) deleteConfirmWrap.hidden = false;
      if (deleteStart) deleteStart.hidden = true;
    });
    deleteCancelBtn?.addEventListener('click', () => {
      if (deleteConfirmWrap) deleteConfirmWrap.hidden = true;
      if (deleteStart) deleteStart.hidden = false;
    });
    deleteConfirmBtn?.addEventListener('click', () => {
      const artPath = normalizeArtPath(ing.art);
      const objectKey = obj?.objectKey || objectKeyFromLabel(displayName);
      if (!artPath) return;
      permanentlyDeleteArt(artPath, { objectKey });
      const next = resolveGalleryObject({
        name: displayName,
        art: '',
        _galleryObject: null,
        id: ing?.id
      });
      if (next?.paintings?.length) {
        openDetail(ingredientForGalleryItem(next), { forceChain });
      } else {
        $('#detail-dialog')?.close();
      }
    });

    bindDetailNameControl(ing, { forceChain });
    bindDetailCategoryControls(ing, { forceChain });

    enhanceArtImages($('#detail-body'));
    $('#detail-dialog').showModal();
  }

  function renderTray() {
    const bowl = $('#plate-bowl');
    const stack = $('#plate-stack');
    bowl.classList.toggle('has-food', state.selected.length > 0);
    const score = renderGlyphMeters($('#plate-meters'), state.selected);
    renderHqOrStack(bowl, stack, state.selected, {
      score,
      dishName: state.dishName,
      restaurantId: state.restaurantId,
      style: legality().style
    });
    renderRecipeList(state.selected);
    renderSlots();
    syncRestaurantFromPlate();
    renderRestaurantRail();
    refreshAutoName();

    const legal = legality();
    const core = S.coreReady(state.selected, state.catalog);
    const slotCheck = plateSatisfiesCurrentRecipe();
    const slotsOk = !slotCheck || slotCheck.ok;
    const canCreate = legal.ok && core.ok && state.selected.length >= 2 && slotsOk;
    const btn = $('#btn-create-dish');
    btn.disabled = !canCreate;
    btn.textContent = 'Create dish';

    const max = state.catalog.maxDishIngredients || 5;
    const hq = FiveStar()?.isFiveStarQuality(score?.stars?.total, state.fiveStarArt);
    const armed = state.recipeSlots.find((s) => s.id === state.armedSlotId);
    if (armed) {
      $('#tray-hint').textContent = `Adding to ${armed.label} · tap ingredients below`;
    } else if (!state.selected.length) {
      $('#tray-hint').textContent = '';
    } else if (!slotsOk && slotCheck?.missingSlots?.length) {
      const cue = slotCheck.missingSlots
        .map((s) => S.missingSlotCue(s, state.byId))
        .filter(Boolean)
        .slice(0, 2)
        .join(' · ');
      $('#tray-hint').textContent = cue ? `Need ${cue}` : 'Fill required slots';
    } else if (state.selected.length >= max && !canCreate) {
      $('#tray-hint').textContent = !legal.ok
        ? `Blocked: ${legal.reason}`
        : (!core.ok ? `Plate full (${max}) · need carb + protein` : `Plate full (${max})`);
    } else if (!legal.ok) $('#tray-hint').textContent = `Blocked: ${legal.reason}`;
    else if (!core.ok) $('#tray-hint').textContent = 'Need carb + protein on the plate';
    else {
      const shop = restaurantById(state.restaurantId);
      const base = shop
        ? `Ready · ${shop.name}`
        : (legal.style && legal.style !== 'general' ? `Ready · ${legal.style}` : 'Ready to create');
      $('#tray-hint').textContent = hq
        ? `${base} · 5-star quality`
        : base;
    }
  }

  function wirePlateDrop() {
    const bowl = $('#plate-bowl');
    bowl.addEventListener('dragover', (e) => {
      e.preventDefault();
      bowl.classList.add('drag-over');
    });
    bowl.addEventListener('dragleave', () => bowl.classList.remove('drag-over'));
    bowl.addEventListener('drop', (e) => {
      e.preventDefault();
      bowl.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/ing-id');
      const ing = state.byId.get(id);
      if (ing) addToPlate(ing);
    });
  }

  /* —— create / dish —— */
  function createDish() {
    const legal = legality();
    if (!legal.ok) return;
    if (!S.coreReady(state.selected, state.catalog).ok) return;
    const slotCheck = plateSatisfiesCurrentRecipe();
    if (slotCheck && !slotCheck.ok) return;
    const ingredients = state.selected.map((i) => ({ ...i }));
    const slots = normalizeRecipeSlots(state.recipeSlots);
    const shop = restaurantById(state.restaurantId);
    const name = (state.dishName || '').trim()
      || S.autoName(ingredients, legal.style, shop?.name);
    const score = S.scoreDish(ingredients, state.catalog);
    state.dish = {
      id: `dish-${Date.now()}`,
      name,
      style: legal.style,
      restaurant: shop?.name || '',
      restaurantId: state.restaurantId || '',
      ingredients,
      slots,
      score,
      variations: [],
      status: 'kept',
      updatedAt: Sync().nowIso()
    };
    // Commit basic dish to kept + Dishes SoT immediately
    const payload = serializeDish(state.dish);
    payload.status = 'kept';
    state.kept = state.kept.filter((k) => k.id !== payload.id);
    state.kept.unshift(payload);
    saveKept();
    setDriveStatus(`Created “${name}” · ${score.hunger?.kcal || 0} kcal · Save to sync sheet`);
    renderDish();
    showView('view-dish');
  }

  function renderDish() {
    const d = state.dish;
    if (!d) return;
    const hero = $('#dish-hero');
    const hqReady = FiveStar()?.isFiveStarQuality(d.score?.stars?.total, state.fiveStarArt);
    hero.innerHTML = `
      <div class="dish-plate-card ${hqReady ? 'hq-card' : ''}">
        <div class="plate-bowl has-food" id="dish-bowl">
          <div class="plate-rim"></div>
          <div class="plate-well" id="dish-stack"></div>
        </div>
        <p class="dish-title">${esc(d.name)}</p>
        <div class="plate-meters" id="dish-meters"></div>
        <ul class="recipe-list" id="dish-recipe-list"></ul>
        <div class="recipe-slots dish-recipe-slots" id="dish-slots-list"></div>
        <div class="dish-tags">
          ${d.restaurant ? `<span class="style-pill">${esc(d.restaurant)}</span>` : ''}
          <span class="style-pill">${esc(d.style || 'general')}</span>
          ${hqReady ? '<span class="style-pill hq-pill">5-star quality</span>' : ''}
        </div>
      </div>
    `;
    const score = renderGlyphMeters($('#dish-meters'), d.ingredients);
    renderHqOrStack($('#dish-bowl'), $('#dish-stack'), d.ingredients, {
      score: d.score || score,
      dishName: d.name,
      restaurantId: d.restaurantId,
      restaurantName: d.restaurant,
      style: d.style
    });
    // reuse recipe renderer into dish list — cores only
    const list = $('#dish-recipe-list');
    const rows = sortedPlate(S.recipeCores(d.ingredients, d.slots || []));
    list.innerHTML = rows.map((ing) => `
      <li class="recipe-row">
        <span class="recipe-ico">${artHtml(ing)}</span>
        <span class="recipe-qty">${esc(servingLabel(ing))}</span>
        <span class="recipe-name">${esc(ing.name)}</span>
      </li>
    `).join('');

    const slotsEl = $('#dish-slots-list');
    if (slotsEl) {
      const slots = normalizeRecipeSlots(d.slots);
      slotsEl.innerHTML = slots.map((slot) => {
        const opts = (slot.optionIds || []).map((id) => state.byId.get(id)).filter(Boolean);
        if (!opts.length) return '';
        return `
          <div class="recipe-slot readonly">
            <div class="recipe-slot-head">
              <span class="recipe-slot-label">${esc(slot.label)}</span>
            </div>
            <div class="recipe-slot-options">
              ${opts.map((ing) => `
                <span class="slot-opt-chip" title="${esc(ing.name)}">${artHtml(ing)}</span>
              `).join('')}
            </div>
          </div>`;
      }).join('');
      enhanceArtImages(slotsEl);
    }

    const varList = $('#variation-list');
    if (!d.variations.length) {
      varList.innerHTML = `<p class="muted" style="padding:0.5rem">No variations yet — tap ＋</p>`;
    } else {
      varList.innerHTML = d.variations.map((v, idx) => {
        const highlightId = v.highlightId || null;
        return `
          <article class="var-card">
            <div class="mini-plate" data-var-stack="${idx}"></div>
            <div class="mini-meters">${esc(v.score?.stars?.display || '')} · ${esc(v.score?.hunger?.label || '')}</div>
            <button type="button" class="remove-var" data-remove-var="${idx}">Remove</button>
          </article>
        `;
      }).join('');
      d.variations.forEach((v, idx) => {
        renderMiniPlate($(`.mini-plate[data-var-stack="${idx}"]`), v.ingredients, {
          highlightId: v.highlightId || null,
          dishName: d.name,
          restaurantId: d.restaurantId,
          restaurantName: d.restaurant,
          style: d.style,
          score: v.score
        });
      });
      varList.querySelectorAll('[data-remove-var]').forEach((btn) => {
        btn.addEventListener('click', () => {
          d.variations.splice(Number(btn.dataset.removeVar), 1);
          renderDish();
        });
      });
    }
  }

  function openVariationPicker() {
    const d = state.dish;
    if (!d) return;
    const baseIds = new Set(d.ingredients.map((i) => i.id));
    const options = [];

    d.ingredients.forEach((ing) => {
      const ids = (state.catalog.hierarchy[ing.uiType] || {})[ing.uiFamily] || [];
      ids.forEach((id) => {
        if (baseIds.has(id)) return;
        const alt = state.byId.get(id);
        if (!alt?.unlocked) return;
        options.push({ kind: 'swap', from: ing, to: alt });
      });
    });

    ['Spice', 'Vegetable'].forEach((type) => {
      Object.entries(state.catalog.hierarchy[type] || {}).forEach(([fam, ids]) => {
        if (!['Herb', 'Chile', 'Spice'].includes(fam) && type !== 'Spice') return;
        ids.forEach((id) => {
          if (baseIds.has(id)) return;
          const alt = state.byId.get(id);
          if (alt) options.push({ kind: 'add', to: alt });
        });
      });
    });
    ((state.catalog.hierarchy.Protein || {}).Egg || []).forEach((id) => {
      if (baseIds.has(id)) return;
      const alt = state.byId.get(id);
      if (alt) options.push({ kind: 'add', to: alt });
    });

    const box = $('#variation-options');
    box.innerHTML = options.slice(0, 60).map((opt, idx) => `
      <button type="button" class="var-opt-tile" data-opt="${idx}" aria-label="${esc(opt.to.name)}">
        ${artHtml(opt.to)}
      </button>
    `).join('') || `<p class="muted">No swaps available</p>`;

    box.querySelectorAll('.var-opt-tile').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyVariation(options[Number(btn.dataset.opt)]);
        $('#variation-dialog').close();
      });
    });
    $('#variation-dialog').showModal();
  }

  function applyVariation(opt) {
    const d = state.dish;
    let ings = d.ingredients.map((i) => ({ ...i }));
    let highlightId = opt.to.id;
    let note = '';
    if (opt.kind === 'swap') {
      ings = ings.map((i) => (i.id === opt.from.id ? { ...opt.to } : i));
      note = `swap ${opt.from.name} → ${opt.to.name}`;
    } else {
      if (ings.length >= (state.catalog.maxDishIngredients || 5)) {
        alert('Plate full');
        return;
      }
      ings.push({ ...opt.to });
      note = `add ${opt.to.name}`;
    }
    const legal = S.detectStyle(ings.map((i) => i.name));
    if (!legal.ok) {
      alert(`Blocked: ${legal.reason}`);
      return;
    }
    d.variations.push({
      id: `var-${Date.now()}`,
      name: S.autoName(ings, legal.style),
      style: legal.style,
      ingredients: ings,
      score: S.scoreDish(ings, state.catalog),
      note,
      highlightId
    });
    renderDish();
  }

  function serializeDish(d) {
    const slim = (list) => list.map((i) => ({
      id: i.id, name: i.name, uiType: i.uiType, uiFamily: i.uiFamily,
      art: i.art || '', starRoles: i.starRoles || [],
      hungerKey: i.hungerKey, flavorKey: i.flavorKey, chain: i.chain || [i.name],
      kcal: i.kcal, servingQty: i.servingQty, servingUnit: i.servingUnit,
      shelfDays: i.shelfDays
    }));
    const ts = Sync().nowIso();
    const score = S.scoreDish(d.ingredients, state.catalog);
    const slots = normalizeRecipeSlots(d.slots);
    return {
      id: d.id,
      name: d.name,
      style: d.style,
      restaurant: d.restaurant || restaurantById(d.restaurantId)?.name || '',
      restaurantId: d.restaurantId || '',
      status: d.status || 'kept',
      ingredients: slim(d.ingredients),
      slots,
      score,
      variations: (d.variations || []).map((v) => ({
        id: v.id, name: v.name, style: v.style, note: v.note, highlightId: v.highlightId,
        ingredients: slim(v.ingredients),
        slots: normalizeRecipeSlots(v.slots || d.slots),
        score: S.scoreDish(v.ingredients, state.catalog),
        updatedAt: ts
      })),
      exportedAt: ts,
      updatedAt: ts
    };
  }

  function keepDish() {
    if (!state.dish) return;
    const payload = serializeDish(state.dish);
    payload.status = 'kept';
    state.kept = state.kept.filter((k) => k.id !== payload.id);
    state.kept.unshift(payload);
    state.dish.status = 'kept';
    saveKept();
    renderDish();
    setDriveStatus(`Kept · ${Sync().dirtyCount(Sync().loadCache())} dirty row(s) · Save to sync sheet`);
  }

  function renderKept() {
    const list = $('#kept-list');
    if (!state.kept.length) {
      list.innerHTML = `<p class="muted" style="padding:1rem">No kept plates yet</p>`;
      return;
    }
    list.innerHTML = state.kept.map((d, idx) => `
      <article class="var-card">
        <div class="mini-plate" data-kept-stack="${idx}"></div>
        <div class="mini-meters">${esc(d.score?.stars?.display || '')}</div>
        <button type="button" class="remove-var" data-drop="${idx}">Drop</button>
      </article>
    `).join('');
    state.kept.forEach((d, idx) => {
      const ings = (d.ingredients || []).map((row) => state.byId.get(row.id) || row);
      renderMiniPlate($(`.mini-plate[data-kept-stack="${idx}"]`), ings, {
        dishName: d.name,
        restaurantId: d.restaurantId,
        restaurantName: d.restaurant,
        style: d.style,
        score: d.score
      });
    });
    list.querySelectorAll('[data-drop]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dropped = state.kept[Number(btn.dataset.drop)];
        if (dropped?.id) Sync().markDishStatus(dropped.id, 'trimmed');
        state.kept.splice(Number(btn.dataset.drop), 1);
        saveKept();
        renderKept();
        setDriveStatus('Trimmed locally · Save to sync sheet');
      });
    });
  }

  /* —— Dishes browse (kept + shop starters) —— */
  function resolveMenuChoice(name) {
    if (!name) return null;
    return state.byName.get(String(name).toLowerCase()) || null;
  }

  function buildShopStarters() {
    const max = state.catalog?.maxDishIngredients || 5;
    const restaurants = state.menus?.restaurants || [];
    const out = [];
    restaurants.forEach((rest) => {
      (rest.dishFamilies || []).forEach((fam) => {
        const names = [];
        (fam.slots || []).forEach((slot) => {
          const choice = slot.defaultChoice;
          if (choice) names.push(choice);
          const extras = choice && slot.choiceExtras?.[choice];
          if (Array.isArray(extras)) {
            extras.forEach((row) => {
              const n = Array.isArray(row) ? row[0] : row;
              if (n) names.push(n);
            });
          }
        });
        const ings = [];
        const seen = new Set();
        names.forEach((n) => {
          if (ings.length >= max) return;
          const ing = resolveMenuChoice(n);
          if (ing && !seen.has(ing.id)) {
            seen.add(ing.id);
            ings.push(ing);
          }
        });
        const legal = S.detectStyle(ings.map((i) => i.name));
        const score = ings.length ? S.scoreDish(ings, state.catalog) : null;
        out.push({
          id: `starter:${rest.id}:${fam.id}`,
          name: fam.label,
          restaurantId: rest.id,
          restaurant: rest.name,
          source: 'shop',
          style: legal?.style || 'general',
          score,
          ingredients: ings
        });
      });
    });
    return out;
  }

  function loadDishOntoPlate(dish) {
    if (!dish) return;
    setMode('dish');
    const max = state.catalog.maxDishIngredients || 5;
    const ings = hydrateIngredients(dish.ingredients || []).filter(Boolean).slice(0, max);
    state.selected = ings.map((i) => ({ ...i }));
    state.dishName = dish.name || '';
    state.dishNameManual = true;
    state.restaurantId = dish.restaurantId || null;
    state.recipeSlots = normalizeRecipeSlots(dish.slots);
    state.loadedRecipe = {
      id: dish.id,
      name: dish.name,
      ingredients: ings.map((i) => ({ ...i })),
      slots: normalizeRecipeSlots(dish.slots),
      variations: dish.variations || [],
      source: dish.source || ''
    };
    if (!state.restaurantId && dish.restaurant) {
      const hit = RESTAURANTS.find((r) => r.name === dish.restaurant);
      if (hit) state.restaurantId = hit.id;
    }
    renderTray();
    renderGrid();
    showView('view-home');
    const shop = restaurantById(state.restaurantId);
    setDriveStatus(shop
      ? `Loaded “${state.dishName}” · ${shop.name}`
      : `Loaded “${state.dishName}”`);
  }

  function dishCardHtml(d, { key, kind }) {
    const shop = d.restaurant || restaurantById(d.restaurantId)?.name || '';
    const stars = d.score?.stars?.display || '';
    return `
      <button type="button" class="dish-browse-card" data-kind="${esc(kind)}" data-key="${esc(key)}">
        <div class="mini-plate" data-dish-stack="${esc(kind)}-${esc(key)}"></div>
        <div class="dish-browse-meta">
          <span class="dish-browse-name">${esc(d.name || 'Untitled')}</span>
          ${shop ? `<span class="dish-browse-shop">${esc(shop)}</span>` : ''}
          ${stars ? `<span class="dish-browse-stars">${esc(stars)}</span>` : ''}
        </div>
      </button>`;
  }

  function renderDishesBrowse() {
    const el = $('#dishes-browse');
    if (!el) return;
    const q = (state.dishesSearch || '').trim().toLowerCase();
    const match = (d) => {
      if (!q) return true;
      const hay = `${d.name || ''} ${d.restaurant || ''} ${restaurantById(d.restaurantId)?.name || ''}`.toLowerCase();
      return hay.includes(q);
    };

    const kept = state.kept.filter(match);
    const starters = buildShopStarters().filter(match);

    el.innerHTML = `
      <section class="dishes-section">
        <h2 class="dishes-heading">Your plates</h2>
        ${kept.length
          ? `<div class="dishes-grid">${kept.map((d, i) => dishCardHtml(d, { key: String(i), kind: 'kept' })).join('')}</div>`
          : `<p class="muted dishes-empty">No kept plates yet — Create dish or pick a shop starter</p>`}
      </section>
      <section class="dishes-section">
        <h2 class="dishes-heading">Shop starters</h2>
        <div class="dishes-grid">${starters.map((d, i) => dishCardHtml(d, { key: String(i), kind: 'shop' })).join('')}</div>
      </section>
    `;

    kept.forEach((d, i) => {
      renderMiniPlate($(`.mini-plate[data-dish-stack="kept-${i}"]`), hydrateIngredients(d.ingredients), {
        dishName: d.name,
        restaurantId: d.restaurantId,
        restaurantName: d.restaurant,
        style: d.style,
        score: d.score
      });
    });
    starters.forEach((d, i) => {
      renderMiniPlate($(`.mini-plate[data-dish-stack="shop-${i}"]`), d.ingredients, {
        dishName: d.name,
        restaurantId: d.restaurantId,
        restaurantName: d.restaurant,
        style: d.style,
        score: d.score
      });
    });

    el.querySelectorAll('.dish-browse-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.kind;
        const idx = Number(btn.dataset.key);
        if (kind === 'kept') loadDishOntoPlate(kept[idx]);
        else loadDishOntoPlate(starters[idx]);
      });
    });
  }

  /* —— art gallery —— */
  const GALLERY_TYPE_ORDER = [
    'Vegetable', 'Fruit', 'Carb', 'Grain', 'Protein', 'Broth', 'Spice', 'Dairy', 'Fat', 'Other', 'Untitled'
  ];

  function artStem(path) {
    const base = String(path || '').split('/').pop() || '';
    return base.replace(/\.(png|jpe?g|webp|gif)$/i, '');
  }

  /** Generic HQ tile ids (hq-01, hq-74, hq-86, any hq-N) are codes, not dish names. */
  function isGenericHqStem(stem) {
    return /^hq-\d+$/i.test(String(stem || '').trim());
  }

  /**
   * Human title from a filename stem.
   * avocado → Avocado; 1_supply_whole-wheat-slices → Whole wheat slices.
   * hq-02 stays hq-02 (never invent a food name).
   */
  function humanizeArtStem(stem) {
    const raw = String(stem || '').trim();
    if (!raw) return '';
    if (isGenericHqStem(raw)) {
      return raw.toLowerCase();
    }
    let base = raw
      .replace(/^1_supply_/i, '')
      .replace(/^ingredient_/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!base) return raw;
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  function normalizeArtPath(path) {
    return String(path || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\//, '');
  }

  const LOCAL_ART_KEY = 'food-menus-local-art-v1';
  const DELETED_ART_KEY = 'food-menus-deleted-art-v1';
  const FLAGGED_ART_KEY = 'food-menus-flagged-art-v1';

  function loadLocalArtStore() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_ART_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function saveLocalArtStore(map) {
    localStorage.setItem(LOCAL_ART_KEY, JSON.stringify(map || {}));
  }

  function loadDeletedArtSet() {
    try {
      const arr = JSON.parse(localStorage.getItem(DELETED_ART_KEY) || '[]');
      return new Set((Array.isArray(arr) ? arr : []).map(normalizeArtPath).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  function saveDeletedArtSet(set) {
    localStorage.setItem(DELETED_ART_KEY, JSON.stringify([...set]));
  }

  function isArtDeleted(path) {
    const p = normalizeArtPath(path);
    return Boolean(p && loadDeletedArtSet().has(p));
  }

  function loadFlaggedArtMap() {
    try {
      const raw = JSON.parse(localStorage.getItem(FLAGGED_ART_KEY) || '{}') || {};
      const out = {};
      Object.entries(raw).forEach(([path, meta]) => {
        const p = normalizeArtPath(path);
        if (!p || !meta || typeof meta !== 'object') return;
        const kind = meta.kind === 'regen' ? 'regen' : (meta.kind === 'reedit' ? 'reedit' : '');
        if (!kind) return;
        out[p] = {
          kind,
          at: String(meta.at || ''),
          label: String(meta.label || ''),
          objectKey: String(meta.objectKey || '')
        };
      });
      return out;
    } catch {
      return {};
    }
  }

  function saveFlaggedArtMap(map) {
    localStorage.setItem(FLAGGED_ART_KEY, JSON.stringify(map || {}));
  }

  function getArtFlag(path) {
    const p = normalizeArtPath(path);
    if (!p || isArtDeleted(p)) return null;
    return loadFlaggedArtMap()[p] || null;
  }

  function setArtFlag(path, kind, { label = '', objectKey = '' } = {}) {
    const p = normalizeArtPath(path);
    const k = kind === 'regen' ? 'regen' : (kind === 'reedit' ? 'reedit' : '');
    if (!p || !k || isArtDeleted(p)) return false;
    const map = loadFlaggedArtMap();
    map[p] = {
      kind: k,
      at: new Date().toISOString(),
      label: String(label || '').trim(),
      objectKey: String(objectKey || '').trim()
    };
    saveFlaggedArtMap(map);
    return true;
  }

  function clearArtFlag(path) {
    const p = normalizeArtPath(path);
    if (!p) return false;
    const map = loadFlaggedArtMap();
    if (!Object.prototype.hasOwnProperty.call(map, p)) return false;
    delete map[p];
    saveFlaggedArtMap(map);
    return true;
  }

  function flaggedArtCount() {
    const map = loadFlaggedArtMap();
    return Object.keys(map).filter((p) => p && !isArtDeleted(p)).length;
  }

  function flaggedArtEntries() {
    const map = loadFlaggedArtMap();
    return Object.entries(map)
      .map(([path, meta]) => ({
        art: path,
        kind: meta.kind === 'regen' ? 'regen' : 'reedit',
        at: meta.at || '',
        label: meta.label || humanizeArtStem(artStem(path)) || path,
        objectKey: meta.objectKey || ''
      }))
      .filter((e) => e.art && !isArtDeleted(e.art))
      .sort((a, b) => {
        const ka = a.kind === 'regen' ? 0 : 1;
        const kb = b.kind === 'regen' ? 0 : 1;
        if (ka !== kb) return ka - kb;
        return String(a.label).localeCompare(String(b.label));
      });
  }

  function objectHasFlaggedArt(it) {
    const map = loadFlaggedArtMap();
    if (!Object.keys(map).length) return false;
    const paintings = it?.paintings || [];
    if (paintings.length) {
      return paintings.some((p) => {
        const path = normalizeArtPath(p.art);
        return Boolean(path && map[path] && !isArtDeleted(path));
      });
    }
    const art = normalizeArtPath(it?.art);
    if (art && map[art] && !isArtDeleted(art)) return true;
    const key = String(it?.objectKey || '').trim();
    if (!key) return false;
    return Object.values(map).some((m) => m && m.objectKey === key);
  }

  /** Cheap locker badge: face path or any flag sharing this object key. */
  function ingredientHasFlaggedArt(ing) {
    const map = loadFlaggedArtMap();
    if (!Object.keys(map).length) return false;
    const art = normalizeArtPath(ing?.art);
    if (art && map[art] && !isArtDeleted(art)) return true;
    const key = objectKeyFromLabel(ing?.name);
    if (!key) return false;
    return Object.values(map).some((m) => m && m.objectKey === key);
  }

  /** Resolve local-art/* keys (and data:/blob: URLs) for <img src>. */
  function resolveArtSrc(path) {
    const p = normalizeArtPath(path);
    if (!p) return '';
    if (isArtDeleted(p)) return '';
    if (/^(data:|blob:)/i.test(p)) return p;
    const local = loadLocalArtStore()[p];
    return local || p;
  }

  function normalizeArtKey(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/^1_supply_/, '')
      .replace(/^ingredient_/, '')
      .replace(/\.png$/i, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  function galleryTypeRank(type) {
    const i = GALLERY_TYPE_ORDER.indexOf(type || 'Other');
    return i < 0 ? GALLERY_TYPE_ORDER.length : i;
  }

  function inferUiTypeFromStem(stem) {
    return inferUiMetaFromStem(stem).type;
  }

  function inferUiMetaFromStem(stem) {
    const key = normalizeArtKey(stem);
    if (!key) return { type: 'Untitled', family: 'Extras' };
    let best = null;
    for (const ing of state.catalog.ingredients || []) {
      const idKey = normalizeArtKey(ing.id);
      const nameKey = normalizeArtKey(ing.name);
      if (key === idKey || key === nameKey || key.endsWith(idKey) || idKey && key.includes(idKey)) {
        const t = ing.uiType || ing.group || 'Other';
        const family = ing.uiFamily || ing.category || 'Extras';
        if (!best || String(ing.name).length > String(best.name).length) {
          best = { name: ing.name, type: t, family };
        }
      }
    }
    return best
      ? { type: best.type, family: best.family }
      : { type: 'Untitled', family: 'Extras' };
  }

  function referencedArtPaths() {
    const used = new Set();
    (state.catalog.ingredients || []).forEach((ing) => {
      const art = normalizeArtPath(ing.art);
      if (art) used.add(art);
    });
    return used;
  }

  function unusedArtFiles() {
    const used = referencedArtPaths();
    const seen = new Set();
    const out = [];
    (state.artFiles || []).forEach((path) => {
      const p = normalizeArtPath(path);
      if (!p || used.has(p) || seen.has(p) || isArtDeleted(p)) return;
      seen.add(p);
      out.push(p);
    });
    return out;
  }

  /** Untitled tab: unused generic hq-N codes only (not extras / produce / named files). */
  function isUntitledPoolPath(path) {
    return isGenericHqStem(artStem(path));
  }

  function untitledArtFiles() {
    return unusedArtFiles()
      .filter(isUntitledPoolPath)
      .sort((a, b) => artStem(a).localeCompare(artStem(b)));
  }

  /** Unused files with a readable name — belong on Painted, not Untitled. */
  function namedUnusedArtFiles() {
    return unusedArtFiles()
      .filter((path) => !isGenericHqStem(artStem(path)))
      .sort((a, b) => humanizeArtStem(artStem(a)).localeCompare(humanizeArtStem(artStem(b))));
  }

  function slugIngredientId(name) {
    const base = String(name || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'ingredient';
    let id = base;
    let n = 2;
    while (state.byId.has(id)) {
      id = `${base}-${n++}`;
    }
    return id;
  }

  function catalogNameOptionsHtml() {
    const ings = [...(state.catalog.ingredients || [])];
    ings.sort((a, b) => {
      const aEmpty = ingredientNeedsArt(a) ? 0 : 1;
      const bEmpty = ingredientNeedsArt(b) ? 0 : 1;
      if (aEmpty !== bEmpty) return aEmpty - bEmpty; // missing/broken first
      return String(a.name).localeCompare(String(b.name));
    });
    return [`<option value="">name this</option>`]
      .concat(ings.map((ing) => {
        const mark = !normalizeArtPath(ing.art) ? ' · empty' : (isArtBroken(ing.art) ? ' · broken' : '');
        return `<option value="${esc(ing.id)}">${esc(ing.name)}${mark}</option>`;
      }))
      .join('');
  }

  async function ensureArtFiles() {
    if (state.artFiles.length) {
      mergeLocalArtIntoInventory();
      purgeDeletedFromArtFiles();
      return state.artFiles;
    }
    try {
      const res = await fetch('data/art-files.txt');
      if (res.ok) {
        state.artFiles = (await res.text())
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'));
      }
    } catch { /* inventory optional */ }
    mergeLocalArtIntoInventory();
    purgeDeletedFromArtFiles();
    return state.artFiles;
  }

  function mergeLocalArtIntoInventory() {
    const local = loadLocalArtStore();
    Object.keys(local).forEach((path) => {
      const p = normalizeArtPath(path);
      if (p && !isArtDeleted(p) && !state.artFiles.includes(p)) state.artFiles.push(p);
    });
  }

  function purgeDeletedFromArtFiles() {
    state.artFiles = (state.artFiles || []).filter((p) => !isArtDeleted(p));
  }

  /** Unassign path everywhere, denylist it, drop from inventory — no git-rm. */
  function permanentlyDeleteArt(artPath, { objectKey = '' } = {}) {
    const path = normalizeArtPath(artPath);
    if (!path) return false;

    (state.catalog.ingredients || []).forEach((ing) => {
      if (normalizeArtPath(ing.art) === path) {
        ing.art = '';
        persistIngredientArt(ing);
      }
    });

    state.artFiles = (state.artFiles || []).filter((p) => normalizeArtPath(p) !== path);

    const deleted = loadDeletedArtSet();
    deleted.add(path);
    saveDeletedArtSet(deleted);

    clearArtFlag(path);

    const local = loadLocalArtStore();
    if (Object.prototype.hasOwnProperty.call(local, path)) {
      delete local[path];
      try { saveLocalArtStore(local); } catch { /* ignore quota */ }
    }

    state.brokenArt.delete(path);

    // Drop face prefs that pointed at the deleted painting; pick another if this object remains.
    const faceMap = loadFaceArtMap();
    let faceDirty = false;
    Object.keys(faceMap).forEach((k) => {
      if (normalizeArtPath(faceMap[k]) === path) {
        delete faceMap[k];
        faceDirty = true;
      }
    });
    if (faceDirty) saveFaceArtMap(faceMap);

    rebuildIndexes();
    renderGrid();
    renderTray();
    renderGallery();

    const key = String(objectKey || '').trim();
    if (key) {
      const obj = paintedGalleryItems().find((it) => it.objectKey === key);
      if (obj?.art && artPathUsable(obj.art)) {
        setFaceArtForObject(key, obj.art);
        renderGallery();
        renderGrid();
      }
    }
    return true;
  }

  /** If Pull/refresh reattaches a denylisted path, clear it again so Missing stays honest. */
  function applyDeletedArtDenylistToCatalog() {
    let changed = false;
    (state.catalog.ingredients || []).forEach((ing) => {
      const art = normalizeArtPath(ing.art);
      if (!art || !isArtDeleted(art)) return;
      ing.art = '';
      persistIngredientArt(ing);
      changed = true;
    });
    purgeDeletedFromArtFiles();
    return changed;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  /** Missing-tab: drop/pick an image file → local art for that catalog ingredient. */
  async function assignPickedImageToIngredient(ingId, file) {
    if (!ingId || !file || !String(file.type || '').startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(file);
    let dataUrl = '';
    try {
      dataUrl = await readFileAsDataUrl(file);
    } catch {
      dataUrl = '';
    }
    const safe = String(file.name || 'upload')
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'upload';
    const path = `local-art/${safe}-${Date.now()}.png`;
    const store = loadLocalArtStore();
    store[path] = dataUrl || objectUrl;
    try {
      saveLocalArtStore(store);
    } catch {
      // Quota: keep object URL for this session only
      store[path] = objectUrl;
      try { saveLocalArtStore({ ...loadLocalArtStore(), [path]: objectUrl }); } catch { /* ignore */ }
    }
    if (!state.artFiles.includes(path)) state.artFiles.push(path);
    assignArtToIngredient(ingId, path);
  }

  function persistIngredientArt(ing) {
    const ts = Sync().nowIso();
    ing.updatedAt = ts;
    Sync().upsertLocal('ingredients', Sync().ingredientFromCatalog(ing, ts), { dirty: true });
    Sync().upsertLocal('assets', Sync().assetFromIngredient(ing, ts), { dirty: true });
  }

  function ensureIngredientInHierarchy(ing) {
    const hier = state.catalog.hierarchy || (state.catalog.hierarchy = {});
    // Remove from every bucket first (same idea as Sync ensureCatalogHierarchy)
    Object.keys(hier).forEach((t) => {
      Object.keys(hier[t] || {}).forEach((f) => {
        hier[t][f] = (hier[t][f] || []).filter((id) => id !== ing.id);
      });
    });
    const type = ing.uiType || 'Other';
    const family = ing.uiFamily || 'Extras';
    if (!hier[type]) hier[type] = {};
    if (!hier[type][family]) hier[type][family] = [];
    if (!hier[type][family].includes(ing.id)) hier[type][family].push(ing.id);
    if (Array.isArray(state.catalog.typeOrder) && !state.catalog.typeOrder.includes(type)) {
      state.catalog.typeOrder.push(type);
    }
  }

  function assignArtToIngredient(ingId, artPath) {
    const ing = state.byId.get(ingId);
    const path = normalizeArtPath(artPath);
    if (!ing || !path) return;
    // One file → one catalog name: clear any other ingredient still pointing here
    (state.catalog.ingredients || []).forEach((other) => {
      if (other.id !== ingId && normalizeArtPath(other.art) === path) {
        other.art = '';
        persistIngredientArt(other);
      }
    });
    ing.art = path;
    // Reassigned path is treated as usable unless a later img error marks it again
    state.brokenArt.delete(path);
    persistIngredientArt(ing);
    rebuildIndexes();
    renderGrid();
    renderTray();
    renderGallery();
  }

  /** Create a local catalog row only when Melinda types a new name for bakery extras. */
  function createNamedIngredientForArt(name, artPath) {
    const trimmed = String(name || '').trim();
    const path = normalizeArtPath(artPath);
    if (!trimmed || !path) return null;
    const existing = state.byName.get(trimmed.toLowerCase());
    if (existing) {
      assignArtToIngredient(existing.id, path);
      return existing;
    }
    const ing = {
      id: slugIngredientId(trimmed),
      name: trimmed,
      group: 'Other',
      category: 'Extras',
      type: 'Extras',
      stage: 'primary',
      uiType: 'Other',
      uiFamily: 'Extras',
      art: path,
      unlocked: true,
      chain: [trimmed],
      starRoles: [],
      source: 'local-untitled'
    };
    // One file → one name
    (state.catalog.ingredients || []).forEach((other) => {
      if (normalizeArtPath(other.art) === path) {
        other.art = '';
        persistIngredientArt(other);
      }
    });
    state.catalog.ingredients.push(ing);
    ensureIngredientInHierarchy(ing);
    persistIngredientArt(ing);
    rebuildIndexes();
    renderTypeRail();
    renderFamilies();
    renderGrid();
    renderTray();
    renderGallery();
    return ing;
  }

  function objectKeyFromLabel(label) {
    let s = String(label || '')
      .toLowerCase()
      .replace(/½/g, ' half ')
      .replace(/[^a-z0-9\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return '';
    const strip = new Set([
      'wedges', 'wedge', 'slices', 'slice', 'sliced', 'slicing',
      'halves', 'half',
      'chopped', 'bunch', 'unit', 'whole', 'cracked', 'peeled',
      'diced', 'minced', 'grated', 'flakes', 'flake', 'strips', 'strip',
      'boiled', 'seasoned', 'dry', 'aged', 'dried', 'fresh', 'raw',
      'streusel', 'piece', 'pieces', 'cut', 'cuts'
    ]);
    const tokens = s.split(' ').filter(Boolean);
    const kept = tokens.filter((t) => !strip.has(t));
    let core = (kept.length ? kept : tokens).join('');
    core = core.replace(/chile/g, 'chili');
    if (core.endsWith('ies') && core.length > 4) core = `${core.slice(0, -3)}y`;
    else if (core.endsWith('ses') && core.length > 4) core = core.slice(0, -2);
    else if (core.endsWith('s') && !core.endsWith('ss') && !core.endsWith('us') && core.length > 3) {
      core = core.slice(0, -1);
    }
    return core;
  }

  function isFormishLabel(label) {
    return /\b(wedges?|sliced|slicing|slices?|halves?|chopped|flakes?|strips?|streusel|boiled|seasoned|½)\b/i.test(String(label || ''))
      || /^½/.test(String(label || ''));
  }

  /** Sliced / slicing form (not plain "slices" alone) — drives the knife badge. */
  function inferPaintingForm(art, label) {
    if (Sync()?.inferPaintingForm) return Sync().inferPaintingForm(art, label);
    const stem = String(artStem(art) || '');
    const human = humanizeArtStem(stem);
    const blob = `${label || ''} ${human} ${stem.replace(/[-_]+/g, ' ')}`.toLowerCase().replace(/½/g, ' half ');
    if (/\b(sliced|slices|slice|wedges|wedge|strips|strip)\b/.test(blob)) return 'sliced';
    if (
      /\b(unit|sprinkle|single|flakes|flake|pieces|piece|garnish)\b/.test(blob)
      || /\bhalves?\b/.test(blob)
      || /\bhalf\b/.test(blob)
    ) return 'unit';
    if (/\b(diced|chopped|mince|minced|shredded)\b/.test(blob)) return 'diced';
    return 'whole';
  }

  function isSlicedPainting(art, label) {
    return inferPaintingForm(art, label) === 'sliced';
  }

  function formBadgeHtml(form, extraClass = '') {
    const kind = String(form || '').toLowerCase();
    if (kind !== 'sliced' && kind !== 'diced' && kind !== 'unit') return '';
    const cls = ['form-badge', `form-${kind}`, extraClass].filter(Boolean).join(' ');
    const label = kind === 'sliced' ? 'Sliced' : (kind === 'diced' ? 'Diced' : 'Single unit');
    let svg = '';
    if (kind === 'sliced') {
      svg = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3.2 20.2c-.4.4-.4 1 0 1.4.4.4 1 .4 1.4 0L14 12.2l1.1-1.1-2.2-2.2L3.2 20.2zm17.1-12.4c.9-.9.9-2.3 0-3.2-.9-.9-2.3-.9-3.2 0l-1.3 1.3 3.2 3.2 1.3-1.3zM14.6 6.3l-1.5 1.5 3.2 3.2 1.5-1.5-3.2-3.2z"/>
      </svg>`;
    } else if (kind === 'diced') {
      svg = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor"/>
        <rect x="13" y="3" width="8" height="8" rx="1.5" fill="currentColor"/>
        <rect x="3" y="13" width="8" height="8" rx="1.5" fill="currentColor"/>
        <rect x="13" y="13" width="8" height="8" rx="1.5" fill="currentColor"/>
      </svg>`;
    } else {
      svg = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor"/>
      </svg>`;
    }
    return `<span class="${cls}" title="${esc(label)}" aria-label="${esc(label)}">${svg}</span>`;
  }

  function knifeBadgeHtml(extraClass = '') {
    return formBadgeHtml('sliced', extraClass);
  }

  /** Prefer the user's chosen grid-face painting for an object when rendering tiles. */
  function faceDisplayIngredient(ing) {
    if (!ing) return ing;
    const key = objectKeyFromLabel(ing.name);
    if (!key) return ing;
    const preferred = normalizeArtPath(loadFaceArtMap()[key]);
    if (preferred && artPathUsable(preferred) && preferred !== normalizeArtPath(ing.art)) {
      return { ...ing, art: preferred };
    }
    return ing;
  }

  /** Find a painting (or named sibling) matching the active form filter. */
  function findFormPaintingForIngredient(ing, form) {
    if (!ing || !form) return null;
    const obj = resolveGalleryObject(ing);
    const paintings = obj?.paintings?.length
      ? obj.paintings
      : [{ art: ing.art, label: ing.name }];
    const hit = paintings.find((p) => inferPaintingForm(p.art, p.label) === form);
    if (hit) return hit;
    const key = objectKeyFromLabel(ing.name);
    const sibling = (state.catalog.ingredients || []).find((other) => (
      other.id !== ing.id
      && objectKeyFromLabel(other.name) === key
      && inferPaintingForm(other.art, other.name) === form
    ));
    if (sibling && normalizeArtPath(sibling.art)) {
      return { art: sibling.art, label: sibling.name, ingId: sibling.id };
    }
    // Name-only form match (no dedicated art) — still counts for filter membership.
    const nameHit = (obj?.names || [ing.name]).find((n) => inferPaintingForm('', n) === form);
    if (nameHit) return { art: '', label: nameHit };
    return null;
  }

  function applyLockerFormFilter(ings) {
    const form = state.formFilter;
    if (!form) {
      return (ings || []).map((ing) => faceDisplayIngredient(ing));
    }
    const out = [];
    (ings || []).forEach((ing) => {
      const match = findFormPaintingForIngredient(ing, form);
      if (!match) return;
      const base = faceDisplayIngredient(ing);
      const art = normalizeArtPath(match.art) || normalizeArtPath(base.art);
      out.push({
        ...base,
        art: art || base.art,
        _formFace: form,
        _formLabel: match.label || base.name
      });
    });
    return out;
  }

  function artPathUsable(path) {
    const p = normalizeArtPath(path);
    return Boolean(p && !isArtBroken(p) && !isArtDeleted(p));
  }

  const FACE_ART_KEY = 'food-menus-face-art-v1';

  function loadFaceArtMap() {
    try {
      return JSON.parse(localStorage.getItem(FACE_ART_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function saveFaceArtMap(map) {
    localStorage.setItem(FACE_ART_KEY, JSON.stringify(map || {}));
  }

  function setFaceArtForObject(objectKey, artPath) {
    const key = String(objectKey || '').trim();
    const path = normalizeArtPath(artPath);
    if (!key || !path) return;
    const map = loadFaceArtMap();
    map[key] = path;
    saveFaceArtMap(map);
  }

  function scoreFaceCandidate({ art, label, fromCatalog }) {
    let score = 0;
    if (artPathUsable(art)) score += 100;
    else if (normalizeArtPath(art) && !isArtDeleted(art)) score += 10; // broken but present
    if (!isFormishLabel(label)) score += 25;
    const stemTitle = humanizeArtStem(artStem(art)).toLowerCase();
    const name = String(label || '').trim().toLowerCase();
    if (stemTitle && name && (name === stemTitle || stemTitle.includes(name) || name.includes(stemTitle.split(' ')[0] || ''))) {
      score += 15;
    }
    if (fromCatalog) score += 5;
    score -= String(label || '').length * 0.01;
    return score;
  }

  function pickObjectTitle(ings, fileLabels, faceArt) {
    const catalogLabels = [];
    (ings || []).forEach((ing) => {
      const n = String(ing?.name || '').trim();
      if (n) catalogLabels.push(n);
    });
    // Catalog display name wins over filename stem so renames (e.g. Udon noodle) stick.
    if (catalogLabels.length) {
      const rankedCat = catalogLabels.slice().sort((a, b) => {
        const sa = scoreFaceCandidate({ art: faceArt, label: a, fromCatalog: true });
        const sb = scoreFaceCandidate({ art: faceArt, label: b, fromCatalog: true });
        if (sb !== sa) return sb - sa;
        return a.localeCompare(b);
      });
      const nonForm = rankedCat.find((n) => !isFormishLabel(n));
      return nonForm || rankedCat[0];
    }

    const labels = [];
    (fileLabels || []).forEach((n) => { if (n) labels.push(String(n)); });
    if (!labels.length) return humanizeArtStem(artStem(faceArt)) || 'Untitled';
    const stemTitle = humanizeArtStem(artStem(faceArt)).toLowerCase();
    const ranked = labels.slice().sort((a, b) => {
      const sa = scoreFaceCandidate({ art: faceArt, label: a, fromCatalog: false });
      const sb = scoreFaceCandidate({ art: faceArt, label: b, fromCatalog: false });
      if (sb !== sa) return sb - sa;
      return a.localeCompare(b);
    });
    if (stemTitle) {
      const exact = ranked.find((n) => n.toLowerCase() === stemTitle);
      if (exact) return exact;
    }
    const nonForm = ranked.find((n) => !isFormishLabel(n));
    return nonForm || ranked[0];
  }

  /**
   * After union-find, split a glued group when 2+ catalog names have different objectKeys
   * AND there are 2+ distinct paintings (Kale vs Spinach). Keep single-painting chips
   * (tomatoes) and same-objectKey variants (lemon / lemon wedges) intact.
   */
  function catalogObjectKeysFromNames(names) {
    const keys = new Set();
    (names || []).forEach((name) => {
      const key = objectKeyFromLabel(name);
      if (key) keys.add(key);
    });
    return keys;
  }

  function scoreArtForObjectKey(art, objectKey, labelsForKey) {
    const path = normalizeArtPath(art);
    if (!path || !objectKey) return -Infinity;
    let best = scoreFaceCandidate({
      art: path,
      label: humanizeArtStem(artStem(path)),
      fromCatalog: false
    });
    // Prefer exact object-key / stem alignment over a generic face score.
    const stemKey = objectKeyFromLabel(humanizeArtStem(artStem(path)));
    if (stemKey && stemKey === objectKey) best += 80;
    (labelsForKey || []).forEach((label) => {
      best = Math.max(best, scoreFaceCandidate({ art: path, label, fromCatalog: true }));
      if (objectKeyFromLabel(label) === stemKey) best += 40;
    });
    return best;
  }

  function bestObjectKeyForArt(art, keyLabels) {
    let bestKey = '';
    let bestScore = -Infinity;
    keyLabels.forEach((labels, objectKey) => {
      const score = scoreArtForObjectKey(art, objectKey, labels);
      if (score > bestScore || (score === bestScore && objectKey.localeCompare(bestKey) < 0)) {
        bestScore = score;
        bestKey = objectKey;
      }
    });
    return bestKey;
  }

  function shouldSplitGluedFoodGroup(catalogNames, arts) {
    const keys = catalogObjectKeysFromNames(catalogNames);
    const distinctArts = [...new Set((arts || []).map(normalizeArtPath).filter(Boolean))];
    return keys.size >= 2 && distinctArts.length >= 2;
  }

  /** Partition locker ingredient groups glued by shared art into one group per objectKey. */
  function splitLockerGroupsByObjectKey(group) {
    const ings = (group || []).filter(Boolean);
    const catalogNames = ings.map((ing) => String(ing.name || '').trim()).filter(Boolean);
    const arts = ings.map((ing) => normalizeArtPath(ing.art)).filter((p) => p && !isArtDeleted(p));
    if (!shouldSplitGluedFoodGroup(catalogNames, arts)) return [ings];

    const keyLabels = new Map();
    ings.forEach((ing) => {
      const name = String(ing.name || '').trim();
      const key = objectKeyFromLabel(name);
      if (!key) return;
      if (!keyLabels.has(key)) keyLabels.set(key, []);
      keyLabels.get(key).push(name);
    });
    if (keyLabels.size < 2) return [ings];

    const artOwner = new Map();
    [...new Set(arts)].forEach((art) => {
      artOwner.set(art, bestObjectKeyForArt(art, keyLabels));
    });

    const buckets = new Map();
    keyLabels.forEach((_, key) => buckets.set(key, []));
    ings.forEach((ing) => {
      const name = String(ing.name || '').trim();
      let key = objectKeyFromLabel(name);
      const art = normalizeArtPath(ing.art);
      if (!key || !buckets.has(key)) {
        key = (art && artOwner.get(art)) || [...buckets.keys()][0];
      }
      if (!key || !buckets.has(key)) return;
      buckets.get(key).push(ing);
    });

    return [...buckets.values()].filter((list) => list.length);
  }

  /**
   * Split a painted gallery union group into per-objectKey subgroups when warranted.
   * Assigns each painting to the best matching catalog name/stem.
   */
  function splitPaintedGroupByObjectKey(g) {
    const catalogNames = (g.ingredients || []).map((ing) => String(ing.name || '').trim()).filter(Boolean);
    const arts = [...(g.arts || [])].map(normalizeArtPath).filter((p) => p && !isArtDeleted(p));
    if (!shouldSplitGluedFoodGroup(catalogNames, arts)) return [g];

    const keyLabels = new Map();
    (g.ingredients || []).forEach((ing) => {
      const name = String(ing.name || '').trim();
      const key = objectKeyFromLabel(name);
      if (!key) return;
      if (!keyLabels.has(key)) keyLabels.set(key, []);
      keyLabels.get(key).push(name);
    });
    if (keyLabels.size < 2) return [g];

    const artOwner = new Map();
    arts.forEach((art) => {
      artOwner.set(art, bestObjectKeyForArt(art, keyLabels));
    });

    const buckets = new Map();
    keyLabels.forEach((_, key) => {
      buckets.set(key, {
        root: `${g.root}::${key}`,
        ingredients: [],
        files: [],
        arts: new Set(),
        titles: [],
        uiType: g.uiType,
        uiFamily: g.uiFamily,
        category: g.category,
        group: g.group,
        type: g.type
      });
    });

    (g.ingredients || []).forEach((ing) => {
      const name = String(ing.name || '').trim();
      const key = objectKeyFromLabel(name);
      const bucket = buckets.get(key);
      if (!bucket) return;
      bucket.ingredients.push(ing);
      if (name) bucket.titles.push(name);
      if (ing.uiType && (!bucket.uiType || bucket.uiType === 'Other')) bucket.uiType = ing.uiType;
      if (ing.uiFamily && !bucket.uiFamily) bucket.uiFamily = ing.uiFamily;
      if (ing.category && !bucket.category) bucket.category = ing.category;
      if (ing.group && !bucket.group) bucket.group = ing.group;
      if (ing.type && !bucket.type) bucket.type = ing.type;
    });

    arts.forEach((art) => {
      const key = artOwner.get(art);
      const bucket = buckets.get(key);
      if (bucket) bucket.arts.add(art);
    });

    (g.files || []).forEach((f) => {
      const art = normalizeArtPath(f.path);
      let key = art ? artOwner.get(art) : '';
      if (!key) key = objectKeyFromLabel(f.title);
      if (!key || !buckets.has(key)) {
        key = bestObjectKeyForArt(art || f.title, keyLabels);
      }
      const bucket = buckets.get(key);
      if (!bucket) return;
      bucket.files.push(f);
      if (f.title) bucket.titles.push(f.title);
      if (art) bucket.arts.add(art);
    });

    return [...buckets.values()].filter((b) => b.ingredients.length || b.files.length || b.arts.size);
  }

  /**
   * Painted / locker: one tile per food object.
   * Unions by shared art path, shared display title, and object key (lemon ≈ lemon wedges).
   * Extra paintings and empty/broken holes fold into details — never xN inventory labels.
   */
  function paintedGalleryItems() {
    const parent = new Map();
    const find = (k) => {
      if (!parent.has(k)) parent.set(k, k);
      const p = parent.get(k);
      if (p !== k) {
        const root = find(p);
        parent.set(k, root);
        return root;
      }
      return k;
    };
    const union = (a, b) => {
      if (!a || !b) return;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };

    const nodes = [];

    (state.catalog.ingredients || []).forEach((ing) => {
      if (!ing || ing.isStation) return;
      const art = isArtDeleted(ing.art) ? '' : normalizeArtPath(ing.art);
      const title = String(ing.name || '').trim();
      if (!title) return;
      const id = `ing:${ing.id}`;
      nodes.push({
        id,
        kind: 'ing',
        ing,
        title,
        art,
        uiType: ing.uiType || ing.group || 'Other',
        uiFamily: ing.uiFamily || ing.category || '',
        category: ing.category || '',
        group: ing.group || '',
        type: ing.type || ''
      });
      const keys = [id, `title:${title.toLowerCase()}`, `obj:${objectKeyFromLabel(title)}`];
      if (art) keys.push(`art:${art}`);
      (ing.aliases || []).forEach((al) => {
        const a = String(al || '').trim();
        if (!a) return;
        keys.push(`title:${a.toLowerCase()}`);
        keys.push(`obj:${objectKeyFromLabel(a)}`);
      });
      for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
    });

    namedUnusedArtFiles().forEach((path) => {
      const art = normalizeArtPath(path);
      if (!art || isArtDeleted(art)) return;
      const title = humanizeArtStem(artStem(art));
      const id = `file:${art}`;
      const meta = inferUiMetaFromStem(artStem(art));
      nodes.push({
        id,
        kind: 'file',
        title,
        art,
        uiType: meta.type === 'Untitled' ? 'Other' : meta.type,
        uiFamily: meta.family || 'Extras',
        category: '',
        group: '',
        type: ''
      });
      union(id, `title:${title.toLowerCase()}`);
      union(id, `obj:${objectKeyFromLabel(title)}`);
      union(id, `art:${art}`);
    });

    const groups = new Map();
    nodes.forEach((node) => {
      const root = find(node.id);
      let g = groups.get(root);
      if (!g) {
        g = {
          root,
          ingredients: [],
          files: [],
          arts: new Set(),
          titles: [],
          uiType: node.uiType,
          uiFamily: node.uiFamily,
          category: node.category,
          group: node.group,
          type: node.type
        };
        groups.set(root, g);
      }
      if (node.kind === 'ing') g.ingredients.push(node.ing);
      else g.files.push({ path: node.art, title: node.title });
      if (node.art) g.arts.add(node.art);
      g.titles.push(node.title);
      if (!g.uiFamily && node.uiFamily) g.uiFamily = node.uiFamily;
      if (!g.uiType || g.uiType === 'Other') g.uiType = node.uiType || g.uiType;
      if (!g.category && node.category) g.category = node.category;
    });

    const faceMap = loadFaceArtMap();
    const items = [];

    const splitGroups = [];
    groups.forEach((g) => {
      splitPaintedGroupByObjectKey(g).forEach((part) => splitGroups.push(part));
    });

    splitGroups.forEach((g) => {
      const artSet = g.arts instanceof Set ? g.arts : new Set(g.arts || []);
      const arts = [...artSet].filter((p) => p && !isArtDeleted(p));
      // Painted only shows objects that have at least one art path (usable or broken)
      if (!arts.length) return;

      const candidates = [];
      g.ingredients.forEach((ing) => {
        const art = normalizeArtPath(ing.art);
        if (!art || isArtDeleted(art)) return;
        // After a glued-food split, only keep paintings assigned to this objectKey.
        if (artSet.size && !artSet.has(art)) return;
        candidates.push({ art, label: ing.name, fromCatalog: true, ing });
      });
      g.files.forEach((f) => {
        const art = normalizeArtPath(f.path);
        if (art && artSet.size && !artSet.has(art)) return;
        candidates.push({ art: f.path, label: f.title, fromCatalog: false });
      });
      // If catalog art was filtered out (wrong shared path), still surface assigned paintings.
      if (!candidates.length) {
        arts.forEach((art) => {
          const label = humanizeArtStem(artStem(art));
          const ing = g.ingredients.find((i) => objectKeyFromLabel(i.name) === objectKeyFromLabel(label))
            || g.ingredients[0]
            || null;
          candidates.push({ art, label: ing?.name || label, fromCatalog: Boolean(ing), ing: ing || undefined });
        });
      }
      if (!candidates.length) return;

      const objKey = objectKeyFromLabel(pickObjectTitle(g.ingredients, g.files.map((f) => f.title), arts[0]))
        || objectKeyFromLabel(g.titles[0]);
      const preferred = normalizeArtPath(faceMap[objKey]);
      let face = null;
      if (preferred && arts.includes(preferred) && artPathUsable(preferred)) {
        face = candidates.find((c) => normalizeArtPath(c.art) === preferred) || null;
      }
      if (!face) {
        face = candidates.slice().sort((a, b) => scoreFaceCandidate(b) - scoreFaceCandidate(a))[0];
      }
      const faceArt = normalizeArtPath(face.art);
      const title = pickObjectTitle(g.ingredients, g.files.map((f) => f.title), faceArt);
      const names = [];
      const seenName = new Set();
      g.ingredients.forEach((ing) => {
        const n = String(ing.name || '').trim();
        const k = n.toLowerCase();
        if (!n || seenName.has(k)) return;
        seenName.add(k);
        names.push(n);
      });
      g.files.forEach((f) => {
        const n = String(f.title || '').trim();
        const k = n.toLowerCase();
        if (!n || seenName.has(k)) return;
        seenName.add(k);
        names.push(n);
      });

      // Collect every distinct painting for details
      const paintings = [];
      const seenArt = new Set();
      const pushPainting = (art, label, ing) => {
        const p = normalizeArtPath(art);
        if (!p || isArtDeleted(p) || seenArt.has(p)) return;
        seenArt.add(p);
        paintings.push({
          art: p,
          label: label || humanizeArtStem(artStem(p)),
          ingId: ing?.id || '',
          usable: artPathUsable(p),
          broken: isArtBroken(p)
        });
      };
      candidates
        .slice()
        .sort((a, b) => scoreFaceCandidate(b) - scoreFaceCandidate(a))
        .forEach((c) => pushPainting(c.art, c.label, c.ing));

      // Empty/broken catalog holes for this object (no art path)
      const holes = g.ingredients.filter((ing) => ingredientNeedsArt(ing));

      items.push({
        kind: 'object',
        id: `obj:${objKey || g.root}`,
        objectKey: objKey || g.root,
        title,
        art: faceArt,
        uiType: g.uiType || 'Other',
        uiFamily: g.uiFamily || g.category || 'Extras',
        category: g.category || '',
        group: g.group || '',
        type: g.type || '',
        untitled: false,
        names,
        ingredients: g.ingredients,
        files: g.files,
        paintings,
        holes,
        faceIng: face.ing || g.ingredients[0] || null
      });
    });

    items.sort((a, b) => {
      const d = galleryTypeRank(a.uiType) - galleryTypeRank(b.uiType);
      if (d) return d;
      const fa = String(a.uiFamily || a.category || '');
      const fb = String(b.uiFamily || b.category || '');
      const df = fa.localeCompare(fb);
      if (df) return df;
      return String(a.title).localeCompare(String(b.title));
    });
    return items;
  }

  function paintedSectionLabel(it) {
    return it.uiFamily || it.category || (it.kind === 'named-file' ? 'Extras' : 'Other');
  }

  function ingredientForGalleryItem(it) {
    if (!it) return null;
    if (it.kind === 'object') {
      const base = it.faceIng || it.ingredients?.[0];
      if (base) {
        return {
          ...base,
          art: it.art || base.art,
          name: it.title || base.name,
          _galleryObject: it
        };
      }
      return {
        id: it.id,
        name: it.title,
        art: it.art,
        uiType: it.uiType || '',
        uiFamily: it.uiFamily || 'Extras',
        group: it.group || '',
        category: it.category || '',
        type: it.type || '',
        chain: [it.title],
        source: 'gallery-file',
        _galleryObject: it
      };
    }
    if (it.kind === 'named' && it.ingredients?.length) {
      return it.ingredients[0];
    }
    if (it.kind === 'named') {
      const art = normalizeArtPath(it.art);
      const match = (state.catalog.ingredients || []).find((ing) => normalizeArtPath(ing.art) === art);
      if (match) return match;
    }
    return {
      id: it.id,
      name: it.title,
      art: it.art,
      uiType: it.uiType || '',
      uiFamily: it.uiFamily || 'Extras',
      group: it.group || '',
      category: it.category || '',
      type: it.type || '',
      chain: [it.title],
      source: 'gallery-file'
    };
  }

  function galleryQueryMatch(text) {
    const q = (state.gallerySearch || '').trim().toLowerCase();
    if (!q) return true;
    return String(text || '').toLowerCase().includes(q);
  }

  function bindUntitledTile(tile) {
    const path = tile.getAttribute('data-art');
    const sel = tile.querySelector('select.gal-name-select');
    const input = tile.querySelector('input.gal-new-name');
    sel?.addEventListener('change', () => {
      const ingId = sel.value;
      if (!ingId) return;
      assignArtToIngredient(ingId, path);
    });
    const commitNew = () => {
      const name = (input?.value || '').trim();
      if (!name) return;
      createNamedIngredientForArt(name, path);
    };
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitNew();
      }
    });
    input?.addEventListener('change', commitNew);
  }

  function bindGalleryDetailTile(tile, itemOrIng) {
    const open = () => {
      const ing = itemOrIng?.kind
        ? ingredientForGalleryItem(itemOrIng)
        : itemOrIng;
      if (ing) openDetail(ing, { forceChain: true });
    };
    bindPressOpenDetail(tile, open);
  }

  function bindMissingDropRow(row) {
    const ingId = row.getAttribute('data-ing-id');
    const zone = row.querySelector('.gal-miss-drop');
    const input = row.querySelector('input.gal-miss-file');
    if (!ingId || !zone || !input) return;

    const takeFile = (file) => {
      if (!file) return;
      assignPickedImageToIngredient(ingId, file);
    };

    zone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      takeFile(file);
    });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      takeFile(file);
      input.value = '';
    });
  }

  function renderGallery() {
    const flagCount = flaggedArtCount();
    const flagTab = $('#gal-flagged');
    if (flagTab) flagTab.textContent = flagCount > 0 ? `Flagged (${flagCount})` : 'Flagged';

    $('#gal-have')?.classList.toggle('active', state.galleryMode === 'have');
    $('#gal-untitled')?.classList.toggle('active', state.galleryMode === 'untitled');
    $('#gal-miss')?.classList.toggle('active', state.galleryMode === 'miss');
    $('#gal-flagged')?.classList.toggle('active', state.galleryMode === 'flag');
    const grid = $('#gallery-grid');
    grid.classList.toggle('gallery-miss', state.galleryMode === 'miss');
    grid.classList.toggle('gallery-untitled', state.galleryMode === 'untitled');
    grid.classList.toggle('gallery-flagged', state.galleryMode === 'flag');

    if (state.galleryMode === 'have') {
      const items = paintedGalleryItems().filter((it) =>
        galleryQueryMatch(it.title) ||
        galleryQueryMatch(artStem(it.art)) ||
        galleryQueryMatch(humanizeArtStem(artStem(it.art))) ||
        galleryQueryMatch(it.uiType) ||
        galleryQueryMatch(it.uiFamily) ||
        galleryQueryMatch(it.category) ||
        (it.names || []).some((n) => galleryQueryMatch(n))
      );
      if (!items.length) {
        grid.innerHTML = `<p class="muted" style="grid-column:1/-1;text-align:center">None</p>`;
        return;
      }
      const groups = groupInOrder(items, paintedSectionLabel);
      const showHeads = groups.length > 1;
      grid.innerHTML = groups.map(({ key, items: list }) => `
        ${showHeads ? sectionHeadHtml(key) : ''}
        ${list.map((it) => {
          const paintLabel = ((it.paintings || []).find((p) => normalizeArtPath(p.art) === normalizeArtPath(it.art)) || {}).label || it.title;
          const faceForm = inferPaintingForm(it.art, paintLabel);
          const badge = (faceForm && faceForm !== 'whole') ? formBadgeHtml(faceForm, 'on-tile') : '';
          return `
          <div class="gal-tile ${isArtBroken(it.art) ? 'broken-art' : ''}" data-gal-id="${esc(it.id)}" title="${esc(it.title)}">
            ${objectHasFlaggedArt(it) ? '<span class="gal-flag-badge" title="Flagged" aria-label="Flagged">⚑</span>' : ''}
            ${badge}
            <div class="gal-thumb">
              ${isArtBroken(it.art)
                ? `<span class="name-fallback art-broken">?</span>`
                : `<img class="art-fit art-${artSizeClass(it.art)}" src="${esc(resolveArtSrc(it.art))}" alt="" loading="lazy" decoding="async" draggable="false" data-art="${esc(it.art)}" />`}
            </div>
            <span class="gal-title">${esc(it.title)}</span>
          </div>`;
        }).join('')}
      `).join('');
      const byId = new Map(items.map((it) => [it.id, it]));
      grid.querySelectorAll('.gal-tile').forEach((tile) => {
        const it = byId.get(tile.getAttribute('data-gal-id'));
        if (it) bindGalleryDetailTile(tile, it);
      });
      enhanceArtImages(grid);
      return;
    }

    if (state.galleryMode === 'untitled') {
      const files = untitledArtFiles().filter((path) => {
        const stem = artStem(path);
        return galleryQueryMatch(stem) || galleryQueryMatch(path);
      });
      const nameOptions = catalogNameOptionsHtml();
      grid.innerHTML = files.map((path) => {
        const stem = artStem(path).toLowerCase();
        return `
        <div class="gal-tile untitled generic-id" data-art="${esc(path)}" title="${esc(stem)}">
          <div class="gal-thumb">
            <img class="art-fit art-${artSizeClass(path)}" src="${esc(resolveArtSrc(path))}" alt="" loading="lazy" decoding="async" draggable="false" data-art="${esc(path)}" />
          </div>
          <span class="gal-untitled-tag">untitled</span>
          <span class="gal-title">${esc(stem)}</span>
          <select class="gal-name-select" aria-label="Name ${esc(stem)}">${nameOptions}</select>
          <input type="text" class="gal-new-name" placeholder="new name…" aria-label="New name for ${esc(stem)}" autocomplete="off" />
        </div>`;
      }).join('') || `<p class="muted" style="grid-column:1/-1;text-align:center">None</p>`;
      grid.querySelectorAll('.gal-tile.untitled').forEach((tile) => {
        bindUntitledTile(tile);
        const path = tile.getAttribute('data-art');
        bindGalleryDetailTile(tile, {
          kind: 'named-file',
          id: `file:${path}`,
          title: artStem(path).toLowerCase(),
          art: path,
          uiType: 'Untitled',
          uiFamily: 'Extras',
          names: [artStem(path).toLowerCase()]
        });
      });
      enhanceArtImages(grid);
      return;
    }

    if (state.galleryMode === 'flag') {
      const entries = flaggedArtEntries().filter((e) =>
        galleryQueryMatch(e.label) ||
        galleryQueryMatch(e.kind) ||
        galleryQueryMatch(artStem(e.art)) ||
        galleryQueryMatch(e.objectKey)
      );
      if (!entries.length) {
        grid.innerHTML = `<p class="muted" style="grid-column:1/-1;text-align:center">None flagged</p>`;
        return;
      }
      const regen = entries.filter((e) => e.kind === 'regen');
      const reedit = entries.filter((e) => e.kind === 'reedit');
      const block = (list, head) => {
        if (!list.length) return '';
        return `
          ${sectionHeadHtml(head)}
          ${list.map((e) => {
            const kindLabel = e.kind === 'regen' ? 'Regen' : 'Re-edit';
            return `
            <div class="gal-flag-row" data-art="${esc(e.art)}" data-object-key="${esc(e.objectKey)}" data-label="${esc(e.label)}">
              <div class="gal-flag-thumb">
                ${isArtBroken(e.art)
                  ? `<span class="name-fallback art-broken">?</span>`
                  : `<img class="art-fit" src="${esc(resolveArtSrc(e.art))}" alt="" loading="lazy" decoding="async" draggable="false" data-art="${esc(e.art)}" />`}
              </div>
              <div class="gal-flag-copy">
                <span class="gal-flag-label">${esc(e.label)}</span>
                <span class="detail-flag-chip kind-${esc(e.kind)}">${esc(kindLabel)}</span>
              </div>
              <button type="button" class="gal-flag-clear" data-art="${esc(e.art)}">Clear</button>
            </div>`;
          }).join('')}
        `;
      };
      grid.innerHTML = `${block(regen, 'Regen')}${block(reedit, 'Re-edit')}`;
      const painted = paintedGalleryItems();
      grid.querySelectorAll('.gal-flag-row').forEach((row) => {
        const art = normalizeArtPath(row.getAttribute('data-art'));
        const objectKey = row.getAttribute('data-object-key') || '';
        const label = row.getAttribute('data-label') || '';
        const it = painted.find((obj) =>
          obj.objectKey === objectKey
          || (obj.paintings || []).some((p) => normalizeArtPath(p.art) === art)
          || normalizeArtPath(obj.art) === art
        ) || {
          kind: 'named-file',
          id: `flag:${art}`,
          title: label || humanizeArtStem(artStem(art)),
          art,
          objectKey,
          uiType: 'Other',
          uiFamily: 'Extras',
          names: [label].filter(Boolean),
          paintings: [{ art, label: label || humanizeArtStem(artStem(art)), usable: artPathUsable(art), broken: isArtBroken(art) }]
        };
        bindGalleryDetailTile(row, it);
        row.querySelector('.gal-flag-clear')?.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          clearArtFlag(art);
          renderGallery();
          renderGrid();
        });
      });
      enhanceArtImages(grid);
      return;
    }

    const missing = missingArtIngredients()
      .filter((ing) => galleryQueryMatch(ing.name) || galleryQueryMatch(ing.uiType || ing.group) || galleryQueryMatch(ing.uiFamily || ing.category));

    grid.innerHTML = missing.map((ing) => `
      <div class="gal-miss-row" data-ing-id="${esc(ing.id)}">
        <span class="gal-miss-name">${esc(ing.name)}${isArtBroken(ing.art) ? ' · broken' : ''}</span>
        <label class="gal-miss-drop">
          <input type="file" class="gal-miss-file" accept="image/*" hidden />
          <span class="gal-miss-drop-hint">Drop image or tap to pick</span>
        </label>
      </div>
    `).join('') || `<p class="muted" style="text-align:center">None</p>`;

    grid.querySelectorAll('.gal-miss-row').forEach(bindMissingDropRow);
  }

  /* —— export / bidirectional SoT —— */
  function dishesForExport() {
    return state.kept.length ? state.kept : (state.dish ? [serializeDish(state.dish)] : []);
  }
  function setDriveStatus(msg) {
    const el = $('#drive-status');
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = msg;
  }
  function exportKept() {
    const dishes = dishesForExport();
    if (dishes.length) Sync().syncDishesFromKept(dishes, { dirty: true });
    const payload = Sync().buildDumpPayload(Sync().loadCache());
    Sync().downloadJson(payload);
    setDriveStatus('SoT JSON downloaded · local cache kept');
  }
  async function saveToDrive() {
    try {
      const dishes = dishesForExport();
      if (dishes.length) Sync().syncDishesFromKept(dishes, { dirty: true });
      // Refresh ingredient/asset rows from live catalog before push
      const store = Sync().loadCache();
      const ts = Sync().nowIso();
      state.catalog.ingredients.forEach((ing) => {
        const row = Sync().ingredientFromCatalog(ing, ing.updatedAt || store.ingredients[ing.id]?.updatedAt || ts);
        const prev = store.ingredients[ing.id];
        if (!prev || JSON.stringify(prev) !== JSON.stringify({ ...prev, ...row, updatedAt: prev.updatedAt })) {
          // only bump updatedAt / dirty when fields actually change
          const same =
            prev &&
            prev.name === row.name &&
            prev.art_url === row.art_url &&
            prev.process_chain === row.process_chain &&
            prev.form === row.form &&
            prev.type === row.type &&
            prev.family === row.family &&
            prev.use_kind === row.use_kind &&
            prev.hunger_key === row.hunger_key &&
            prev.flavor_key === row.flavor_key &&
            prev.star_roles === row.star_roles;
          if (!same) {
            row.updatedAt = ts;
            store.ingredients[ing.id] = row;
            store.assets[ing.id] = Sync().assetFromIngredient(ing, ts);
            store.dirty.ingredients[ing.id] = true;
            store.dirty.assets[ing.id] = true;
          }
        }
      });
      Sync().saveCache(store);

      const result = await window.FoodMenusDrive.saveToDrive(dishes, { onStatus: setDriveStatus });
      if (result.reason === 'missing-client-id') {
        setDriveStatus('JSON downloaded · local cache kept · live two-way needs HTTPS + Google sign-in');
      }
    } catch (err) {
      setDriveStatus(err.message || String(err));
      alert(err.message || String(err));
    }
  }
  async function pullFromSheet() {
    try {
      const result = await Sync().pullFromSheet({ onStatus: setDriveStatus });
      if (result.reason === 'missing-client-id') {
        const baked = await Sync().loadBakedFoodMasterRows();
        const cache = Sync().loadCache();
        const dirtyIngredientIds = Object.keys(cache.dirty?.ingredients || {});
        const preserveUseKindIds = Object.values(cache.ingredients || {})
          .filter((row) => Sync().normalizeUseKind(row.use_kind))
          .map((row) => row.id);
        const stats = Sync().applyFoodMasterRowsToCatalog(state.catalog, baked, {
          dirtyIngredientIds,
          preserveUseKindIds
        });
        applyDeletedArtDenylistToCatalog();
        rebuildIndexes();
        renderGrid();
        renderGallery();
        setDriveStatus(`Merged baked Food Master · +${stats.created} / ~${stats.updated} · live two-way needs HTTPS + Google sign-in`);
        return;
      }
      Sync().applyIngredientRowsToCatalog(state.catalog, result.store.ingredients, result.store.assets);
      const masterRows = result.foodMasterRows?.length
        ? result.foodMasterRows
        : await Sync().loadBakedFoodMasterRows();
      const dirtyIngredientIds = Object.keys(result.store.dirty?.ingredients || {});
      const preserveUseKindIds = Object.values(result.store.ingredients || {})
        .filter((row) => Sync().normalizeUseKind(row.use_kind))
        .map((row) => row.id);
      const fmStats = Sync().applyFoodMasterRowsToCatalog(state.catalog, masterRows, {
        dirtyIngredientIds,
        preserveUseKindIds
      });
      applyDeletedArtDenylistToCatalog();
      rebuildIndexes();
      // Merge dishes from sheet into kept
      const sheetKept = Sync().keptFromStore(result.store).map((d) => ({
        ...d,
        ingredients: hydrateIngredients(d.ingredients),
        slots: normalizeRecipeSlots(d.slots),
        variations: (d.variations || []).map((v) => ({
          ...v,
          ingredients: hydrateIngredients(v.ingredients),
          slots: normalizeRecipeSlots(v.slots || d.slots)
        }))
      }));
      const byId = new Map(state.kept.map((d) => [d.id, d]));
      sheetKept.forEach((d) => {
        const cur = byId.get(d.id);
        if (!cur) byId.set(d.id, d);
        else {
          const a = Date.parse(cur.updatedAt || cur.exportedAt || 0) || 0;
          const b = Date.parse(d.updatedAt || 0) || 0;
          if (b >= a) byId.set(d.id, d);
        }
      });
      state.kept = [...byId.values()];
      localStorage.setItem('food-menus-kept-v1', JSON.stringify(state.kept));
      $('#kept-count').textContent = String(state.kept.length);
      renderGrid();
      renderTray();
      renderGallery();
      setDriveStatus(`Merged from sheet · Food Master +${fmStats.created}/~${fmStats.updated} · ${state.kept.length} kept · ${Sync().dirtyCount(result.store)} dirty`);
    } catch (err) {
      setDriveStatus(err.message || String(err));
      alert(err.message || String(err));
    }
  }

  /* —— Create ingredient mode —— */
  const P = () => window.FoodMenusProcess;

  function setMode(mode) {
    state.mode = mode;
    $('#mode-dish')?.classList.toggle('active', mode === 'dish');
    $('#mode-ingredient')?.classList.toggle('active', mode === 'ingredient');
    $('#plate-stage')?.classList.toggle('hidden', mode !== 'dish');
    $('#ingredient-author')?.classList.toggle('hidden', mode !== 'ingredient');
    if (mode === 'ingredient') {
      // Slot arming is dish-only; don't leave a stale arm that mislabels detail Add
      state.armedSlotId = null;
      renderProcessAuthor();
    } else {
      renderTray();
    }
    renderGrid();
  }

  function resolveByNameOrId(key) {
    if (!key) return null;
    if (String(key).startsWith('station:')) {
      const name = String(key).slice('station:'.length);
      return P().stationAsItem(state.processData?.stations, name)
        || P().stationAsItem(state.processData?.stations, key);
    }
    const st = P().stationAsItem(state.processData?.stations, key);
    if (st && P().isStationName(key, state.processData?.stations)) return st;
    return state.byId.get(key) || state.byName.get(String(key).toLowerCase()) || null;
  }

  function selectProcess(processId, outputName) {
    const proc = state.processData?.catalog?.[processId];
    if (!proc) return;
    state.processId = processId;
    state.processOutput = outputName || P().primaryOutputs(proc)[0];
    state.processSlots = P().requiredSlots(proc, state.processData.stations).map((s) => ({ ...s }));
    // Auto-bind station slot
    state.processSlots.forEach((s) => {
      if (s.station && !s.filledId) {
        const st = s.stationItem || P().stationAsItem(state.processData.stations, s.name);
        if (st) {
          s.filledId = st.id;
          s.stationItem = st;
        }
      }
    });
    state.processSlotFocus = state.processSlots.findIndex((s) => !s.station && !s.filledId);
    if (state.processSlotFocus < 0) state.processSlotFocus = 0;
    const outInput = $('#output-name');
    if (outInput && !state.processOutputManual) outInput.value = state.processOutput;
    renderProcessAuthor();
  }

  function renderStationRail() {
    const el = $('#station-rail');
    if (!el || !state.processData) return;
    const stations = state.processData.stations || [];
    el.innerHTML = stations.map((s) => {
      const active = state.stationFilter === s.name;
      const glyph = s.glyph === 'oven' ? 'oven' : 'gear';
      return `<button type="button" class="station-chip ${active ? 'active' : ''} kind-${esc(s.actionKind)}"
        data-station="${esc(s.name)}" aria-pressed="${active}">
        <span class="station-glyph ${glyph}" aria-hidden="true"></span>
        <span>${esc(s.name)}</span>
      </button>`;
    }).join('');
    el.querySelectorAll('.station-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.station;
        state.stationFilter = state.stationFilter === name ? null : name;
        // If filtering, prefer first matching process
        const opts = P().listProcessOptions(state.processData.catalog, state.processData.byOutput, {
          stationName: state.stationFilter
        });
        if (state.stationFilter && opts[0]) {
          state.processOutputManual = false;
          selectProcess(opts[0].id, opts[0].output);
        } else {
          renderProcessAuthor();
        }
      });
    });
  }

  function renderProcessAuthor() {
    if (state.mode !== 'ingredient') return;
    const PD = state.processData;
    if (!PD) return;

    renderStationRail();

    const opts = P().listProcessOptions(PD.catalog, PD.byOutput, {
      stationName: state.stationFilter
    });
    const dl = $('#process-output-list');
    if (dl) {
      const all = P().listProcessOptions(PD.catalog, PD.byOutput);
      dl.innerHTML = all.map((o) => `<option value="${esc(o.output)}"></option>`).join('');
    }

    const picker = $('#process-picker');
    const q = (state.processSearch || '').trim().toLowerCase();
    const filtered = q
      ? opts.filter((o) => o.output.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)
        || String(o.station || '').toLowerCase().includes(q))
      : opts;
    picker.innerHTML = filtered.map((o) => `
      <button type="button" class="process-chip ${state.processId === o.id && state.processOutput === o.output ? 'active' : ''}"
        data-pid="${esc(o.id)}" data-out="${esc(o.output)}">${esc(o.output)}</button>
    `).join('') || `<span class="muted">${state.stationFilter ? 'No recipes for this station' : 'No matching processes'}</span>`;
    picker.querySelectorAll('.process-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.processOutputManual = false;
        selectProcess(btn.dataset.pid, btn.dataset.out);
      });
    });

    const proc = PD.catalog[state.processId];
    const chainEl = $('#process-chain-view');
    const slotsEl = $('#process-slots');
    const shelfEl = $('#shelf-compare');
    const createBtn = $('#btn-create-ingredient');

    if (!proc) {
      chainEl.innerHTML = `<p class="muted">Pick a station or process (Mill · Dehydrator · Oven)</p>`;
      slotsEl.innerHTML = '';
      shelfEl.hidden = true;
      createBtn.disabled = true;
      $('#process-hint').textContent = 'Tap Mill, Dehydrator, or Oven — then fill ingredient slots from the locker';
      return;
    }

    const nodes = P().visualChain(state.processOutput, proc, PD.byOutput, PD.catalog, PD.stations);
    chainEl.innerHTML = nodes.map((node, i) => {
      if (node.kind === 'station') {
        const st = node.station;
        return `${i ? '<span class="chain-arrow-sm">→</span>' : ''}
          <div class="chain-node station-node" title="${esc(st.name)}">
            ${stationGlyphHtml(st)}
            <span class="station-node-label">${esc(st.name)}</span>
          </div>`;
      }
      const ing = resolveByNameOrId(node.name) || { name: node.name, art: '' };
      return `${i ? '<span class="chain-arrow-sm">→</span>' : ''}
        <div class="chain-node" title="${esc(node.name)}">${artHtml(ing)}</div>`;
    }).join('');

    slotsEl.innerHTML = state.processSlots.map((slot, idx) => {
      let show;
      if (slot.station) {
        show = slot.stationItem || P().stationAsItem(PD.stations, slot.name) || { name: slot.name, glyph: 'gear', isStation: true };
      } else {
        const filled = slot.filledId ? state.byId.get(slot.filledId) : null;
        show = filled || { name: slot.name, art: '' };
      }
      const qty = slot.station ? 'station' : (slot.qty != null ? String(slot.qty) : '');
      const empty = !slot.station && !slot.filledId;
      return `
        <li class="process-slot ${empty ? 'empty' : ''} ${slot.station ? 'is-station' : ''} ${state.processSlotFocus === idx ? 'active-target' : ''}" data-slot="${idx}">
          <span class="slot-ico">${artHtml(show)}</span>
          <span class="slot-qty">${esc(qty)}</span>
          <span class="slot-name">${esc(slot.name)}</span>
        </li>`;
    }).join('');
    slotsEl.querySelectorAll('.process-slot').forEach((row) => {
      row.addEventListener('click', () => {
        const slot = state.processSlots[Number(row.dataset.slot)];
        if (slot?.station) return; // stations auto-bound
        state.processSlotFocus = Number(row.dataset.slot);
        renderProcessAuthor();
      });
    });

    const shelf = P().shelfCompare(proc, (n) => resolveByNameOrId(n));
    if (shelf.before || shelf.after || shelf.processDays) {
      shelfEl.hidden = false;
      const fmt = (side) => {
        if (!side) return '—';
        const d = side.days;
        return d != null ? `${side.item}: ${d}d shelf` : `${side.item}`;
      };
      shelfEl.innerHTML = `
        <div class="muted">Process time · ${shelf.processDays} day(s)${proc.station ? ` · ${esc(proc.station)}` : ''}</div>
        <div class="shelf-row"><span>Before</span><span>${esc(fmt(shelf.before))}</span></div>
        <div class="shelf-row"><span>After</span><span>${esc(fmt(shelf.after))}</span></div>
      `;
    } else if (proc.station) {
      shelfEl.hidden = false;
      shelfEl.innerHTML = `<div class="muted">Station · ${esc(proc.station)} · ${shelf.processDays} day(s)</div>`;
    } else {
      shelfEl.hidden = true;
    }

    const ready2 = state.processSlots.every((s) => Boolean(s.filledId) || s.station);
    // ensure station filled
    state.processSlots.forEach((s) => {
      if (s.station && !s.filledId) {
        const st = s.stationItem || P().stationAsItem(PD.stations, s.name);
        if (st) { s.filledId = st.id; s.stationItem = st; }
      }
    });
    const ready = state.processSlots.every((s) => Boolean(s.filledId));
    createBtn.disabled = !ready || !state.processOutput;
    $('#process-hint').textContent = ready
      ? `Ready to create ${state.processOutput}${proc.station ? ` on ${proc.station}` : ''}`
      : 'Tap a dashed ingredient slot, then tap a locker icon';
  }

  function fillProcessSlot(ing) {
    if (state.mode !== 'ingredient' || !state.processSlots.length) return;
    if (ing?.isStation) return;
    let idx = state.processSlotFocus;
    if (idx == null || idx < 0 || state.processSlots[idx]?.station) {
      idx = state.processSlots.findIndex((s) => !s.station && !s.filledId);
    }
    if (idx < 0) idx = state.processSlots.findIndex((s) => !s.station);
    if (idx < 0) return;
    const slot = state.processSlots[idx];
    if (!slot || slot.station) return;
    slot.filledId = ing.id;
    const next = state.processSlots.findIndex((s, i) => i > idx && !s.station && !s.filledId);
    state.processSlotFocus = next >= 0 ? next : idx;
    renderProcessAuthor();
  }

  function createIngredient() {
    const proc = state.processData?.catalog?.[state.processId];
    if (!proc || !state.processOutput) return;
    // Auto-bind station slots (virtual — not locker food)
    state.processSlots.forEach((s) => {
      if (s.station) {
        const st = s.stationItem || P().stationAsItem(state.processData.stations, s.name);
        if (st) {
          s.filledId = st.id;
          s.stationItem = st;
        }
      } else if (!s.filledId) {
        const match = resolveByNameOrId(s.name);
        if (match && !match.isStation) s.filledId = match.id;
      }
    });
    if (!state.processSlots.every((s) => s.filledId)) {
      $('#process-hint').textContent = 'Fill every required ingredient from the locker';
      renderProcessAuthor();
      return;
    }

    const draft = P().draftOutputIngredient(
      proc,
      state.processOutput,
      state.processSlots,
      (idOrName) => resolveByNameOrId(idOrName)
    );
    // Merge into live catalog
    const existing = state.byId.get(draft.id) || state.byName.get(draft.name.toLowerCase());
    const ing = existing ? { ...existing, ...draft, id: existing.id, art: existing.art || draft.art } : draft;
    if (!existing) {
      state.catalog.ingredients.push(ing);
      const hier = state.catalog.hierarchy || (state.catalog.hierarchy = {});
      if (!hier[ing.uiType]) hier[ing.uiType] = {};
      if (!hier[ing.uiType][ing.uiFamily]) hier[ing.uiType][ing.uiFamily] = [];
      if (!hier[ing.uiType][ing.uiFamily].includes(ing.id)) hier[ing.uiType][ing.uiFamily].push(ing.id);
      if (Array.isArray(state.catalog.typeOrder) && !state.catalog.typeOrder.includes(ing.uiType)) {
        state.catalog.typeOrder.push(ing.uiType);
      }
    } else {
      Object.assign(existing, ing);
    }
    rebuildIndexes();

    // SoT: ingredient + asset + process chain row
    const ts = Sync().nowIso();
    Sync().upsertLocal('ingredients', Sync().ingredientFromCatalog(ing, ts), { dirty: true });
    Sync().upsertLocal('assets', Sync().assetFromIngredient(ing, ts), { dirty: true });
    const shelf = P().shelfCompare(proc, (n) => resolveByNameOrId(n));
    Sync().upsertLocal('processes', {
      id: `${state.processId}:${ing.id}`,
      name: proc.name,
      output: ing.name,
      input_ids: state.processSlots.map((s) => s.filledId).join(','),
      input_names: state.processSlots.map((s) => s.name).join(' · '),
      station: proc.station || '',
      action_kind: proc.actionKind || '',
      process_days: proc.days ?? '',
      shelf_before: shelf.before?.days ?? '',
      shelf_after: shelf.after?.days ?? ing.shelfDays ?? '',
      star_roles: (ing.starRoles || []).join(','),
      updatedAt: ts
    }, { dirty: true });

    setDriveStatus(`Created ingredient “${ing.name}” · Save to sync Process chains`);
    $('#process-hint').textContent = `Created ${ing.name}${ing.shelfDays != null ? ` · shelf ${ing.shelfDays}d` : ''}`;
    renderTypeRail();
    renderFamilies();
    renderGrid();
    renderProcessAuthor();
  }

  function wire() {
    wirePlateDrop();
    $('#btn-clear-tray').addEventListener('click', () => {
      state.selected = [];
      state.dishNameManual = false;
      state.dishName = '';
      state.restaurantId = null;
      state.recipeSlots = [];
      state.loadedRecipe = null;
      state.armedSlotId = null;
      renderTray();
      renderGrid();
    });
    $('#btn-create-dish').addEventListener('click', createDish);
    $('#btn-add-custom-slot')?.addEventListener('click', () => {
      const input = $('#slot-custom-name');
      const name = (input?.value || '').trim();
      if (!name) return;
      addRecipeSlot('Custom', name);
      if (input) input.value = '';
    });
    $('#slot-custom-name')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      $('#btn-add-custom-slot')?.click();
    });
    $('#btn-create-ingredient')?.addEventListener('click', createIngredient);
    $('#btn-clear-process')?.addEventListener('click', () => {
      state.processSlots = state.processSlots.map((s) => ({ ...s, filledId: null }));
      state.processSlotFocus = 0;
      renderProcessAuthor();
    });
    $('#mode-dish')?.addEventListener('click', () => setMode('dish'));
    $('#mode-ingredient')?.addEventListener('click', () => setMode('ingredient'));

    $('#dish-name')?.addEventListener('input', (e) => {
      state.dishNameManual = true;
      state.dishName = e.target.value;
    });
    $('#output-name')?.addEventListener('input', (e) => {
      state.processOutputManual = true;
      state.processOutput = e.target.value.trim();
      // Try auto-select matching recipe
      const hit = P().listProcessOptions(state.processData.catalog, state.processData.byOutput)
        .find((o) => o.output.toLowerCase() === state.processOutput.toLowerCase());
      if (hit) selectProcess(hit.id, hit.output);
      else renderProcessAuthor();
    });

    $('#btn-back-home').addEventListener('click', () => showView('view-home'));
    $('#btn-back-from-kept').addEventListener('click', () => showView('view-home'));
    $('#btn-back-from-gallery').addEventListener('click', () => showView('view-home'));
    $('#btn-back-from-dishes')?.addEventListener('click', () => showView('view-home'));
    $('#btn-dishes')?.addEventListener('click', () => {
      renderDishesBrowse();
      showView('view-dishes');
    });
    $('#btn-kept').addEventListener('click', () => { renderKept(); showView('view-kept'); });
    $('#btn-gallery').addEventListener('click', () => {
      state.galleryMode = 'have';
      ensureArtFiles().then(() => {
        renderGallery();
        showView('view-gallery');
      });
    });
    $('#gal-have').addEventListener('click', () => {
      state.galleryMode = 'have';
      ensureArtFiles().then(() => renderGallery());
    });
    $('#gal-untitled')?.addEventListener('click', () => {
      state.galleryMode = 'untitled';
      ensureArtFiles().then(() => renderGallery());
    });
    $('#gal-miss').addEventListener('click', () => {
      state.galleryMode = 'miss';
      ensureArtFiles().then(() => renderGallery());
    });
    $('#gal-flagged')?.addEventListener('click', () => {
      state.galleryMode = 'flag';
      ensureArtFiles().then(() => renderGallery());
    });
    $('#gallery-search')?.addEventListener('input', (e) => {
      state.gallerySearch = e.target.value || '';
      renderGallery();
    });
    $('#btn-add-variation').addEventListener('click', openVariationPicker);
    $('#btn-keep').addEventListener('click', keepDish);
    $('#btn-discard').addEventListener('click', () => { state.dish = null; showView('view-home'); });
    $('#btn-export').addEventListener('click', exportKept);
    $('#btn-save-drive').addEventListener('click', () => { saveToDrive(); });
    $('#btn-sync-pull').addEventListener('click', () => { pullFromSheet(); });
    const fmBtn = $('#btn-food-master');
    if (fmBtn) {
      const url = window.FOOD_MENUS_CONFIG?.FOOD_MASTER_SHEET_URL
        || 'https://docs.google.com/spreadsheets/d/1ShKoeUKdthTgd6Y2zmAyNkUiv0wpkqmOyaZ1D_TX7DQ/edit';
      fmBtn.setAttribute('href', url);
    }

    $('#locker-search')?.addEventListener('input', (e) => {
      state.lockerSearch = e.target.value || '';
      renderGrid();
    });
    $('#process-search')?.addEventListener('input', (e) => {
      state.processSearch = e.target.value || '';
      renderProcessAuthor();
    });
    $('#dishes-search')?.addEventListener('input', (e) => {
      state.dishesSearch = e.target.value || '';
      renderDishesBrowse();
    });

    $('#detail-dialog').addEventListener('close', () => {
      if ($('#detail-dialog').returnValue === 'toggle' && state.detailIng) {
        if (!state.byId.has(state.detailIng.id)) return;
        if (state.armedSlotId && state.mode === 'dish') {
          addOptionToSlot(state.armedSlotId, state.detailIng, { moveOffPlate: false });
        } else {
          addToPlate(state.detailIng);
        }
      }
    });
  }

  async function init() {
    wire();
    const res = await fetch('data/catalog.json');
    state.catalog = await res.json();
    const procRes = await fetch('data/process-catalog.json');
    state.processData = P().loadCatalog(await procRes.json());
    rebuildProcessOutputs();
    try {
      const menuRes = await fetch('data/restaurant-menus-v1.json');
      state.menus = await menuRes.json();
    } catch {
      state.menus = { restaurants: [] };
    }
    // HQ 5-star art map — missing file degrades to ring icons only
    try {
      const artRes = await fetch('data/five-star-art.json');
      if (artRes.ok && FiveStar()?.loadArtMap) {
        state.fiveStarArt = FiveStar().loadArtMap(await artRes.json());
      } else {
        state.fiveStarArt = null;
      }
    } catch {
      state.fiveStarArt = null;
    }

    await Sync().boot(state.catalog, {
      onStatus: setDriveStatus,
      tryPull: Sync().hasClientId()
    });
    await ensureArtFiles();
    applyDeletedArtDenylistToCatalog();
    rebuildIndexes();
    loadKept();
    state.kept = state.kept.map((d) => ({
      ...d,
      ingredients: hydrateIngredients(d.ingredients),
      slots: normalizeRecipeSlots(d.slots),
      variations: (d.variations || []).map((v) => ({
        ...v,
        ingredients: hydrateIngredients(v.ingredients),
        slots: normalizeRecipeSlots(v.slots || d.slots)
      }))
    }));
    localStorage.setItem('food-menus-kept-v1', JSON.stringify(state.kept));
    $('#kept-count').textContent = String(state.kept.length);

    state.mode = 'dish';
    state.type = state.catalog.typeOrder[0];
    state.family = '__all__';
    state.stage = 'all';
    state.formFilter = '';
    // Default process highlight: ramen noodles (full list still browsable)
    const ramen = P().listProcessOptions(state.processData.catalog, state.processData.byOutput)
      .find((o) => o.output === 'Ramen noodles');
    if (ramen) selectProcess(ramen.id, ramen.output);

    renderStageRail();
    renderFormRail();
    renderTypeRail();
    renderFamilies();
    renderGrid();
    renderSlotAddRail();
    renderSlots();
    renderTray();
    setMode('dish');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init().catch((err) => {
    document.body.innerHTML = `<p style="padding:2rem;color:#e8dcc6">${esc(err.message)}</p>`;
  });
})();
