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
    hqPlateGen: 0
  };

  const FiveStar = () => window.FoodMenusFiveStar;

  const $ = (sel, root = document) => root.querySelector(sel);

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
      return `<img class="${cls}" src="${esc(ing.art)}" alt="" draggable="false" loading="lazy" decoding="async" />`;
    }
    return `<span class="name-fallback">${esc(ing?.name || '?')}</span>`;
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

  /* —— plate stack —— */
  function renderPlateStack(el, ingredients, { highlightId = null } = {}) {
    if (!el) return;
    el.innerHTML = (ingredients || []).map((ing, idx) => `
      <div class="stack-layer ${highlightId && ing.id === highlightId ? 'highlight' : ''}" style="z-index:${idx + 1}">
        ${artHtml(ing)}
      </div>
    `).join('');
  }

  function clearHqChrome(bowl) {
    if (!bowl) return;
    bowl.classList.remove('hq-plate', 'hq-has-photo');
    bowl.querySelectorAll('.hq-cue, .hq-dish-img').forEach((n) => n.remove());
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
   * 5-star quality: swap stacked locker icons for HQ plated photo.
   * Visual gate is artMap.visualThreshold (4.5); numeric stars stay honest.
   */
  function renderHqOrStack(bowl, stack, ingredients, extra = {}) {
    if (!bowl || !stack) return;
    clearHqChrome(bowl);
    const gen = ++state.hqPlateGen;
    const FS = FiveStar();
    const artMap = state.fiveStarArt;
    if (!FS || !artMap || !(ingredients || []).length) {
      renderPlateStack(stack, ingredients, extra);
      return;
    }
    const ctx = hqContext(ingredients, extra);
    const resolved = FS.resolveCandidates(ctx, artMap);
    if (!resolved.quality) {
      renderPlateStack(stack, ingredients, extra);
      return;
    }

    bowl.classList.add('hq-plate');
    const cue = document.createElement('span');
    cue.className = 'hq-cue';
    cue.textContent = resolved.cue || '5-star quality';
    bowl.appendChild(cue);

    // Optimistic stack until a photo loads (or none do).
    renderPlateStack(stack, ingredients, extra);

    FS.pickLoadable(resolved.candidates).then((cand) => {
      if (gen !== state.hqPlateGen) return;
      if (!cand?.file) return; // keep stacked icons inside larger plate + cue
      bowl.classList.add('hq-has-photo');
      stack.innerHTML = `<img class="hq-dish-img" src="${esc(cand.file)}" alt="${esc(ctx.dishName || '5-star dish')}" draggable="false" />`;
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
    const rows = sortedPlate(ingredients);
    if (!rows.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = rows.map((ing) => `
      <li class="recipe-row">
        <span class="recipe-ico">${artHtml(ing)}</span>
        <span class="recipe-qty">${esc(servingLabel(ing))}</span>
        <span class="recipe-name">${esc(ing.name)}</span>
      </li>
    `).join('');
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
    syncRestaurantFromPlate();
    renderRestaurantRail();
    refreshAutoName();

    const legal = legality();
    const core = S.coreReady(state.selected, state.catalog);
    const canCreate = legal.ok && core.ok && state.selected.length >= 2;
    const btn = $('#btn-create-dish');
    btn.disabled = !canCreate;
    btn.textContent = 'Create dish';

    const max = state.catalog.maxDishIngredients || 5;
    const hq = FiveStar()?.isFiveStarQuality(score?.stars?.total, state.fiveStarArt);
    if (!state.selected.length) $('#tray-hint').textContent = '';
    else if (state.selected.length >= max && !canCreate) {
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
    const ingredients = state.selected.map((i) => ({ ...i }));
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
    // reuse recipe renderer into dish list
    const list = $('#dish-recipe-list');
    const rows = sortedPlate(d.ingredients);
    list.innerHTML = rows.map((ing) => `
      <li class="recipe-row">
        <span class="recipe-ico">${artHtml(ing)}</span>
        <span class="recipe-qty">${esc(servingLabel(ing))}</span>
        <span class="recipe-name">${esc(ing.name)}</span>
      </li>
    `).join('');

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
        renderPlateStack($(`.mini-plate[data-var-stack="${idx}"]`), v.ingredients, {
          highlightId: v.highlightId || null
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
    return {
      id: d.id,
      name: d.name,
      style: d.style,
      restaurant: d.restaurant || restaurantById(d.restaurantId)?.name || '',
      restaurantId: d.restaurantId || '',
      status: d.status || 'kept',
      ingredients: slim(d.ingredients),
      score,
      variations: (d.variations || []).map((v) => ({
        id: v.id, name: v.name, style: v.style, note: v.note, highlightId: v.highlightId,
        ingredients: slim(v.ingredients),
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
      renderPlateStack($(`.mini-plate[data-kept-stack="${idx}"]`), ings);
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
        out.push({
          id: `starter:${rest.id}:${fam.id}`,
          name: fam.label,
          restaurantId: rest.id,
          restaurant: rest.name,
          source: 'shop',
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
      renderPlateStack($(`.mini-plate[data-dish-stack="kept-${i}"]`), hydrateIngredients(d.ingredients));
    });
    starters.forEach((d, i) => {
      renderPlateStack($(`.mini-plate[data-dish-stack="shop-${i}"]`), d.ingredients);
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
    return base.replace(/\.png$/i, '');
  }

  function normalizeArtPath(path) {
    return String(path || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\//, '');
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

  async function ensureArtFiles() {
    if (state.artFiles.length) return state.artFiles;
    try {
      const res = await fetch('data/art-files.txt');
      if (res.ok) {
        state.artFiles = (await res.text())
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'));
      }
    } catch { /* inventory optional */ }
    return state.artFiles;
  }

  function persistIngredientArt(ing) {
    const ts = Sync().nowIso();
    ing.updatedAt = ts;
    Sync().upsertLocal('ingredients', Sync().ingredientFromCatalog(ing, ts), { dirty: true });
    Sync().upsertLocal('assets', Sync().assetFromIngredient(ing, ts), { dirty: true });
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

    unusedArtFiles().forEach((path) => {
      const stem = artStem(path);
      items.push({
        kind: 'unused',
        id: `unused:${path}`,
        title: stem,
        art: path,
        uiType: inferUiTypeFromStem(stem),
        untitled: true,
        names: [stem]
      });
    });

    items.sort((a, b) => {
      const d = galleryTypeRank(a.uiType) - galleryTypeRank(b.uiType);
      if (d) return d;
      if (a.untitled !== b.untitled) return a.untitled ? 1 : -1;
      return String(a.title).localeCompare(String(b.title));
    });
    return items;
  }

  function galleryQueryMatch(text) {
    const q = (state.gallerySearch || '').trim().toLowerCase();
    if (!q) return true;
    return String(text || '').toLowerCase().includes(q);
  }

  function renderGallery() {
    $('#gal-have').classList.toggle('active', state.galleryMode === 'have');
    $('#gal-miss').classList.toggle('active', state.galleryMode === 'miss');
    const grid = $('#gallery-grid');
    grid.classList.toggle('gallery-miss', state.galleryMode === 'miss');

    if (state.galleryMode === 'have') {
      const items = paintedGalleryItems().filter((it) =>
        galleryQueryMatch(it.title) ||
        galleryQueryMatch(artStem(it.art)) ||
        galleryQueryMatch(it.uiType) ||
        (it.names || []).some((n) => galleryQueryMatch(n))
      );
      grid.innerHTML = items.map((it) => `
        <div class="gal-tile ${it.untitled ? 'untitled' : ''}" title="${esc(it.title)}">
          <div class="gal-thumb">
            <img src="${esc(it.art)}" alt="" loading="lazy" decoding="async" draggable="false" />
          </div>
          ${it.untitled ? `<span class="gal-untitled-tag">untitled</span>` : ''}
          <span class="gal-title">${esc(it.title)}</span>
        </div>
      `).join('') || `<p class="muted" style="grid-column:1/-1;text-align:center">None</p>`;
      return;
    }

    const unused = unusedArtFiles().sort((a, b) => artStem(a).localeCompare(artStem(b)));
    const missing = (state.catalog.ingredients || [])
      .filter((ing) => !ing.art)
      .filter((ing) => galleryQueryMatch(ing.name) || galleryQueryMatch(ing.uiType || ing.group))
      .sort((a, b) => {
        const d = galleryTypeRank(a.uiType || a.group) - galleryTypeRank(b.uiType || b.group);
        return d || String(a.name).localeCompare(String(b.name));
      });

    const options = [`<option value="">assign</option>`]
      .concat(unused.map((path) => `<option value="${esc(path)}">${esc(artStem(path))}</option>`))
      .join('');

    grid.innerHTML = missing.map((ing) => `
      <div class="gal-miss-row">
        <span class="gal-miss-name">${esc(ing.name)}</span>
        <select class="gal-miss-select" data-ing-id="${esc(ing.id)}" aria-label="Assign art for ${esc(ing.name)}">
          ${options}
        </select>
      </div>
    `).join('') || `<p class="muted" style="text-align:center">None</p>`;

    grid.querySelectorAll('select.gal-miss-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const path = sel.value;
        if (!path) return;
        assignArtToIngredient(sel.getAttribute('data-ing-id'), path);
      });
    });
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
        variations: (d.variations || []).map((v) => ({
          ...v,
          ingredients: hydrateIngredients(v.ingredients)
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
      renderTray();
      renderGrid();
    });
    $('#btn-create-dish').addEventListener('click', createDish);
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
    // HQ 5-star art map — missing file degrades to stacked icons only
    try {
      const artRes = await fetch('data/five-star-art.json');
      if (artRes.ok) {
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
      variations: (d.variations || []).map((v) => ({
        ...v,
        ingredients: hydrateIngredients(v.ingredients)
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
