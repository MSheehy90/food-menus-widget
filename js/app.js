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
    loadedRecipe: null
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
    // Cores are whatever is on the plate and not a slot option (always present);
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
    renderSlots();
    renderRecipeList(state.selected);
    renderTray();
  }

  function removeRecipeSlot(slotId) {
    state.recipeSlots = state.recipeSlots.filter((s) => s.id !== slotId);
    renderSlots();
    renderRecipeList(state.selected);
    renderTray();
  }

  function addOptionToSlot(slotId, ing) {
    if (!ing) return;
    const slot = state.recipeSlots.find((s) => s.id === slotId);
    if (!slot) return;
    if (!slot.optionIds.includes(ing.id)) slot.optionIds.push(ing.id);
    seedSlotFromSubstitutes(slot, ing);
    // Leave plate picks in place — recipeCores already hides slot options from the required list.
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
      const ing = state.byId.get(id);
      if (ing) addOptionToSlot(slotId, ing);
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
    const slots = state.recipeSlots;
    el.innerHTML = slots.map((slot) => {
      const opts = (slot.optionIds || []).map((id) => state.byId.get(id)).filter(Boolean);
      return `
        <div class="recipe-slot" data-slot-id="${esc(slot.id)}" data-drop="slot">
          <div class="recipe-slot-head">
            <span class="recipe-slot-label">${esc(slot.label)}</span>
            <button type="button" class="recipe-slot-remove" data-remove-slot="${esc(slot.id)}" aria-label="Remove slot">✕</button>
          </div>
          <div class="recipe-slot-options">
            ${opts.map((ing) => `
              <button type="button" class="slot-opt-chip" data-slot-id="${esc(slot.id)}" data-opt-id="${esc(ing.id)}" title="${esc(ing.name)}" aria-label="Remove ${esc(ing.name)}">
                ${artHtml(ing)}
              </button>
            `).join('') || `<span class="slot-drop-hint">Drop options here</span>`}
          </div>
        </div>`;
    }).join('');

    el.querySelectorAll('.recipe-slot').forEach((row) => {
      wireSlotDropTarget(row, row.dataset.slotId);
    });
    el.querySelectorAll('[data-remove-slot]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeRecipeSlot(btn.dataset.removeSlot);
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
      return full ? { ...full, ...row, art: row.art || full.art || '' } : row;
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
    if (ing?.art) {
      const src = resolveArtSrc(ing.art);
      const sizeCls = `art-fit art-${artSizeClass(ing.art)}`;
      return `<img class="${esc((cls ? `${cls} ` : '') + sizeCls)}" src="${esc(src)}" alt="" draggable="false" loading="lazy" decoding="async" data-art="${esc(ing.art)}" />`;
    }
    return `<span class="name-fallback">${esc(ing?.name || '?')}</span>`;
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
    const target = ART_FILL[cls] || ART_FILL.default;
    // CSS class sets a sensible base; refine with opaque bbox so padded PNGs enlarge.
    measureOpaqueRatio(img).then((ratio) => {
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
      <li class="recipe-row" data-ing-id="${esc(ing.id)}" draggable="true">
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
    if (state.stage === 'made') return isMade(ing);
    if (state.stage === 'raw') return !isMade(ing);
    return true;
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
      return state.catalog.ingredients.filter(take)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    const hier = state.catalog.hierarchy[state.type] || {};
    let ids = [];
    if (state.family === '__all__') {
      Object.values(hier).forEach((arr) => { ids.push(...(arr || [])); });
    } else {
      ids = hier[state.family] || [];
    }
    return ids.map((id) => state.byId.get(id)).filter(take);
  }

  function bindTileGestures(btn, ing) {
    let pressTimer = null;
    let longFired = false;

    const clear = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };

    btn.addEventListener('pointerdown', (e) => {
      longFired = false;
      btn.setPointerCapture?.(e.pointerId);
      pressTimer = setTimeout(() => {
        longFired = true;
        openDetail(ing, { forceChain: true });
      }, 480);
    });
    btn.addEventListener('pointerup', () => {
      clear();
      if (!longFired) addToPlate(ing);
    });
    btn.addEventListener('pointercancel', clear);
    btn.addEventListener('pointerleave', clear);

    // drag onto plate
    btn.addEventListener('dragstart', (e) => {
      clear();
      btn.classList.add('dragging');
      e.dataTransfer.setData('text/ing-id', ing.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    btn.addEventListener('dragend', () => btn.classList.remove('dragging'));
    btn.setAttribute('draggable', 'true');
  }

  function renderGrid() {
    const ings = familyIngredients();
    const sel = selectedIds();
    const emptyMsg = state.lockerSearch.trim()
      ? 'No ingredients match'
      : (state.stage === 'made' ? 'No made ingredients here' : 'Empty family');
    $('#ingredient-grid').innerHTML = ings.map((ing) => `
      <button type="button" class="ing-tile ${sel.has(ing.id) ? 'selected' : ''} ${ing.art ? '' : 'missing-art'} ${isMade(ing) ? 'is-made' : ''}"
        data-id="${esc(ing.id)}" aria-label="${esc(ing.name)}">
        ${isMade(ing) ? '<span class="chain-cue" title="Process chain" aria-hidden="true"></span>' : ''}
        ${artHtml(ing)}
      </button>
    `).join('') || `<p class="muted" style="grid-column:1/-1;text-align:center">${esc(emptyMsg)}</p>`;

    $('#ingredient-grid').querySelectorAll('.ing-tile').forEach((btn) => {
      const ing = state.byId.get(btn.dataset.id);
      bindTileGestures(btn, ing);
    });
    enhanceArtImages($('#ingredient-grid'));
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

  function openDetail(ing, { forceChain = false } = {}) {
    state.detailIng = ing;
    const onPlate = selectedIds().has(ing.id);
    const chain = resolveChainIngs(ing);
    const showChain = forceChain || isMade(ing) || chain.length > 1;

    $('#detail-body').innerHTML = `
      <div class="detail-hero">
        <div class="big-ico">${artHtml(ing)}</div>
        ${ing.art ? '' : `<p class="muted" style="margin:0;font-weight:800">${esc(ing.name)}</p>`}
      </div>
      ${showChain ? `
        <div class="chain-row" aria-label="Process chain">
          ${chain.map((c, i) => `
            ${i ? '<span class="chain-arrow">→</span>' : ''}
            <div class="chain-step" title="${esc(c.name)}">${artHtml(c)}</div>
          `).join('')}
        </div>
      ` : ''}
    `;
    $('#detail-toggle').textContent = onPlate ? 'Remove' : 'Add to plate';
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
    if (!state.selected.length) $('#tray-hint').textContent = '';
    else if (!slotsOk && slotCheck?.missingSlots?.length) {
      const cue = slotCheck.missingSlots
        .map((s) => S.missingSlotCue(s, state.byId))
        .filter(Boolean)
        .slice(0, 2)
        .join(' · ');
      $('#tray-hint').textContent = cue ? `Need ${cue}` : 'Fill required slots';
    } else if (!slotsOk && slotCheck?.missingCores?.length) {
      const cue = slotCheck.missingCores
        .map((c) => c.name || c.id || c)
        .filter(Boolean)
        .slice(0, 2)
        .join(' · ');
      $('#tray-hint').textContent = cue ? `Need ${cue}` : 'Missing required ingredients';
    } else if (!slotsOk) {
      $('#tray-hint').textContent = 'Fill required slots';
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

  /** Resolve local-art/* keys (and data:/blob: URLs) for <img src>. */
  function resolveArtSrc(path) {
    const p = normalizeArtPath(path);
    if (!p) return '';
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
    const key = normalizeArtKey(stem);
    if (!key) return 'Untitled';
    let best = null;
    for (const ing of state.catalog.ingredients || []) {
      const idKey = normalizeArtKey(ing.id);
      const nameKey = normalizeArtKey(ing.name);
      if (key === idKey || key === nameKey || key.endsWith(idKey) || idKey && key.includes(idKey)) {
        const t = ing.uiType || ing.group || 'Other';
        if (!best || String(ing.name).length > String(best.name).length) best = { name: ing.name, type: t };
      }
    }
    return best?.type || 'Untitled';
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
      if (!p || used.has(p) || seen.has(p)) return;
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
      const aEmpty = a.art ? 1 : 0;
      const bEmpty = b.art ? 1 : 0;
      if (aEmpty !== bEmpty) return aEmpty - bEmpty; // empty-art first
      return String(a.name).localeCompare(String(b.name));
    });
    return [`<option value="">name this</option>`]
      .concat(ings.map((ing) => {
        const mark = ing.art ? '' : ' · empty';
        return `<option value="${esc(ing.id)}">${esc(ing.name)}${mark}</option>`;
      }))
      .join('');
  }

  async function ensureArtFiles() {
    if (state.artFiles.length) {
      mergeLocalArtIntoInventory();
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
    return state.artFiles;
  }

  function mergeLocalArtIntoInventory() {
    const local = loadLocalArtStore();
    Object.keys(local).forEach((path) => {
      const p = normalizeArtPath(path);
      if (p && !state.artFiles.includes(p)) state.artFiles.push(p);
    });
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

  function paintedGalleryItems() {
    const byPath = new Map();
    const seenNameArt = new Set();

    (state.catalog.ingredients || []).forEach((ing) => {
      const art = normalizeArtPath(ing.art);
      if (!art) return;
      const nameArtKey = `${String(ing.name || '').toLowerCase()}|${art}`;
      if (seenNameArt.has(nameArtKey)) return; // drop duplicate name+art catalog rows
      seenNameArt.add(nameArtKey);

      let group = byPath.get(art);
      if (!group) {
        group = {
          art,
          names: [],
          uiType: ing.uiType || ing.group || 'Other'
        };
        byPath.set(art, group);
      }
      group.names.push(ing.name);
    });

    const items = [];
    byPath.forEach((group) => {
      const names = group.names;
      const title = names.length === 1
        ? names[0]
        : `${names[0]} x${names.length}`;
      items.push({
        kind: 'named',
        id: `art:${group.art}`,
        title,
        art: group.art,
        uiType: group.uiType,
        untitled: false,
        names
      });
    });

    // Named unused pool files (Apple pie slice, Bacon, Avocado, …) live on Painted
    namedUnusedArtFiles().forEach((path) => {
      if (byPath.has(path)) return;
      const stem = artStem(path);
      const title = humanizeArtStem(stem);
      items.push({
        kind: 'named-file',
        id: `file:${path}`,
        title,
        art: path,
        uiType: inferUiTypeFromStem(stem),
        untitled: false,
        names: [title]
      });
    });

    items.sort((a, b) => {
      const d = galleryTypeRank(a.uiType) - galleryTypeRank(b.uiType);
      if (d) return d;
      return String(a.title).localeCompare(String(b.title));
    });
    return items;
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
    $('#gal-have')?.classList.toggle('active', state.galleryMode === 'have');
    $('#gal-untitled')?.classList.toggle('active', state.galleryMode === 'untitled');
    $('#gal-miss')?.classList.toggle('active', state.galleryMode === 'miss');
    const grid = $('#gallery-grid');
    grid.classList.toggle('gallery-miss', state.galleryMode === 'miss');
    grid.classList.toggle('gallery-untitled', state.galleryMode === 'untitled');

    if (state.galleryMode === 'have') {
      const items = paintedGalleryItems().filter((it) =>
        galleryQueryMatch(it.title) ||
        galleryQueryMatch(artStem(it.art)) ||
        galleryQueryMatch(humanizeArtStem(artStem(it.art))) ||
        galleryQueryMatch(it.uiType) ||
        (it.names || []).some((n) => galleryQueryMatch(n))
      );
      grid.innerHTML = items.map((it) => `
        <div class="gal-tile" title="${esc(it.title)}">
          <div class="gal-thumb">
            <img class="art-fit art-${artSizeClass(it.art)}" src="${esc(resolveArtSrc(it.art))}" alt="" loading="lazy" decoding="async" draggable="false" data-art="${esc(it.art)}" />
          </div>
          <span class="gal-title">${esc(it.title)}</span>
        </div>
      `).join('') || `<p class="muted" style="grid-column:1/-1;text-align:center">None</p>`;
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
      grid.querySelectorAll('.gal-tile.untitled').forEach(bindUntitledTile);
      enhanceArtImages(grid);
      return;
    }

    const missing = (state.catalog.ingredients || [])
      .filter((ing) => !ing.art)
      .filter((ing) => galleryQueryMatch(ing.name) || galleryQueryMatch(ing.uiType || ing.group))
      .sort((a, b) => {
        const d = galleryTypeRank(a.uiType || a.group) - galleryTypeRank(b.uiType || b.group);
        return d || String(a.name).localeCompare(String(b.name));
      });

    grid.innerHTML = missing.map((ing) => `
      <div class="gal-miss-row" data-ing-id="${esc(ing.id)}">
        <span class="gal-miss-name">${esc(ing.name)}</span>
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
        setDriveStatus('Live two-way needs HTTPS + Google sign-in');
        return;
      }
      Sync().applyIngredientRowsToCatalog(state.catalog, result.store.ingredients, result.store.assets);
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
      setDriveStatus(`Merged from sheet · ${state.kept.length} kept · ${Sync().dirtyCount(result.store)} dirty`);
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
        addToPlate(state.detailIng);
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
    // Default process highlight: ramen noodles (full list still browsable)
    const ramen = P().listProcessOptions(state.processData.catalog, state.processData.byOutput)
      .find((o) => o.output === 'Ramen noodles');
    if (ramen) selectProcess(ramen.id, ramen.output);

    renderStageRail();
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
