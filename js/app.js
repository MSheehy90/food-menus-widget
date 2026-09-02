(() => {
  'use strict';

  const S = window.MenuStars;
  const Sync = () => window.FoodMenusSync;
  const state = {
    catalog: null,
    restaurants: [],
    byId: new Map(),
    byName: new Map(),
    type: null,
    family: '__all__',
    selected: [],
    unlockedOnly: true,
    dish: null,
    kept: [],
    detailIng: null,
    galleryMode: 'have',
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
    processSlotFocus: 0
  };

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

  /** Icon-only unless art missing — then show name. */
  function artHtml(ing, cls = '') {
    if (ing?.art) {
      return `<img class="${cls}" src="${esc(ing.art)}" alt="" draggable="false" loading="lazy" decoding="async" />`;
    }
    return `<span class="name-fallback">${esc(ing?.name || '?')}</span>`;
  }

  function resolveChainIngs(ing) {
    const names = ing.chain?.length ? ing.chain : [ing.name];
    return names.map((n) => state.byName.get(String(n).toLowerCase()) || { name: n, art: '', id: n });
  }

  function showView(id) {
    ['view-home', 'view-dish', 'view-kept', 'view-gallery'].forEach((v) => {
      $(`#${v}`)?.classList.toggle('hidden', v !== id);
    });
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

  function familyIngredients() {
    const hier = state.catalog.hierarchy[state.type] || {};
    let ids = [];
    if (state.family === '__all__') {
      Object.values(hier).forEach((arr) => { ids.push(...(arr || [])); });
    } else {
      ids = hier[state.family] || [];
    }
    const seen = new Set();
    return ids.map((id) => state.byId.get(id)).filter(Boolean)
      .filter((ing) => {
        if (seen.has(ing.id)) return false;
        seen.add(ing.id);
        return state.unlockedOnly ? ing.unlocked !== false : true;
      });
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
    $('#ingredient-grid').innerHTML = ings.map((ing) => `
      <button type="button" class="ing-tile ${sel.has(ing.id) ? 'selected' : ''} ${ing.art ? '' : 'missing-art'}"
        data-id="${esc(ing.id)}" aria-label="${esc(ing.name)}">
        ${ing.processed ? '<span class="badge">P</span>' : ''}
        ${artHtml(ing)}
      </button>
    `).join('') || `<p class="muted" style="grid-column:1/-1;text-align:center">Empty family</p>`;

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
    const showChain = forceChain || ing.processed || chain.length > 1;

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
    renderPlateStack(stack, state.selected);
    renderGlyphMeters($('#plate-meters'), state.selected);
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
    if (!state.selected.length) $('#tray-hint').textContent = '';
    else if (state.selected.length >= max && !canCreate) {
      $('#tray-hint').textContent = !legal.ok
        ? `Blocked: ${legal.reason}`
        : (!core.ok ? `Plate full (${max}) · need carb + protein` : `Plate full (${max})`);
    } else if (!legal.ok) $('#tray-hint').textContent = `Blocked: ${legal.reason}`;
    else if (!core.ok) $('#tray-hint').textContent = 'Need carb + protein on the plate';
    else {
      const shop = restaurantById(state.restaurantId);
      $('#tray-hint').textContent = shop
        ? `Ready · ${shop.name}`
        : (legal.style && legal.style !== 'general' ? `Ready · ${legal.style}` : 'Ready to create');
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
    hero.innerHTML = `
      <div class="dish-plate-card">
        <div class="plate-bowl has-food">
          <div class="plate-rim"></div>
          <div class="plate-well" id="dish-stack"></div>
        </div>
        <p class="dish-title">${esc(d.name)}</p>
        <div class="plate-meters" id="dish-meters"></div>
        <ul class="recipe-list" id="dish-recipe-list"></ul>
        <div class="dish-tags">
          ${d.restaurant ? `<span class="style-pill">${esc(d.restaurant)}</span>` : ''}
          <span class="style-pill">${esc(d.style || 'general')}</span>
        </div>
      </div>
    `;
    renderPlateStack($('#dish-stack'), d.ingredients);
    renderGlyphMeters($('#dish-meters'), d.ingredients);
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

  /* —— art gallery —— */
  function renderGallery() {
    const ings = state.catalog.ingredients.filter((i) => {
      const has = Boolean(i.art);
      return state.galleryMode === 'have' ? has : !has;
    });
    $('#gal-have').classList.toggle('active', state.galleryMode === 'have');
    $('#gal-miss').classList.toggle('active', state.galleryMode === 'miss');
    $('#gallery-grid').innerHTML = ings.map((ing) => `
      <button type="button" class="ing-tile ${ing.art ? '' : 'missing-art'}" aria-label="${esc(ing.name)}">
        ${artHtml(ing)}
      </button>
    `).join('') || `<p class="muted" style="grid-column:1/-1;text-align:center">None</p>`;
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
    return state.byId.get(key) || state.byName.get(String(key).toLowerCase()) || null;
  }

  function selectProcess(processId, outputName) {
    const proc = state.processData?.catalog?.[processId];
    if (!proc) return;
    state.processId = processId;
    state.processOutput = outputName || P().primaryOutputs(proc)[0];
    state.processSlots = P().requiredSlots(proc).map((s) => ({ ...s }));
    state.processSlotFocus = 0;
    const outInput = $('#output-name');
    if (outInput && !state.processOutputManual) outInput.value = state.processOutput;
    renderProcessAuthor();
  }

  function renderProcessAuthor() {
    if (state.mode !== 'ingredient') return;
    const PD = state.processData;
    if (!PD) return;

    const opts = P().listProcessOptions(PD.catalog, PD.byOutput);
    const dl = $('#process-output-list');
    if (dl) {
      dl.innerHTML = opts.map((o) => `<option value="${esc(o.output)}"></option>`).join('');
    }

    const picker = $('#process-picker');
    // Show recipes matching current output name, else popular defaults
    const q = ($('#output-name')?.value || state.processOutput || '').trim().toLowerCase();
    const filtered = q
      ? opts.filter((o) => o.output.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))
      : opts.filter((o) => /ramen|wheat|dehydr|chashu|rice noodle|miso|broth/i.test(o.output + o.name));
    const show = (filtered.length ? filtered : opts).slice(0, 12);
    picker.innerHTML = show.map((o) => `
      <button type="button" class="process-chip ${state.processId === o.id && state.processOutput === o.output ? 'active' : ''}"
        data-pid="${esc(o.id)}" data-out="${esc(o.output)}">${esc(o.output)}</button>
    `).join('') || `<span class="muted">No process recipes</span>`;
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
      chainEl.innerHTML = `<p class="muted">Pick an output process (try Ramen noodles)</p>`;
      slotsEl.innerHTML = '';
      shelfEl.hidden = true;
      createBtn.disabled = true;
      $('#process-hint').textContent = 'Choose a process recipe, then fill required icons from the locker';
      return;
    }

    const chain = P().upstreamChain(state.processOutput, PD.byOutput, PD.catalog);
    chainEl.innerHTML = chain.map((name, i) => {
      const ing = resolveByNameOrId(name) || { name, art: '' };
      return `${i ? '<span class="chain-arrow-sm">→</span>' : ''}
        <div class="chain-node" title="${esc(name)}">${artHtml(ing)}</div>`;
    }).join('');

    slotsEl.innerHTML = state.processSlots.map((slot, idx) => {
      const filled = slot.filledId ? state.byId.get(slot.filledId) : null;
      const placeholder = { name: slot.name, art: '' };
      const show = filled || placeholder;
      const qty = slot.station ? 'station' : (slot.qty != null ? String(slot.qty) : '');
      return `
        <li class="process-slot ${filled ? '' : 'empty'} ${state.processSlotFocus === idx ? 'active-target' : ''}" data-slot="${idx}">
          <span class="slot-ico">${artHtml(show)}</span>
          <span class="slot-qty">${esc(qty)}</span>
          <span class="slot-name">${esc(slot.name)}${slot.station && !filled ? ' (no art)' : ''}</span>
        </li>`;
    }).join('');
    slotsEl.querySelectorAll('.process-slot').forEach((row) => {
      row.addEventListener('click', () => {
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
        <div class="muted">Process time · ${shelf.processDays} day(s)</div>
        <div class="shelf-row"><span>Before</span><span>${esc(fmt(shelf.before))}</span></div>
        <div class="shelf-row"><span>After</span><span>${esc(fmt(shelf.after))}</span></div>
      `;
    } else {
      shelfEl.hidden = true;
    }

    const ready = state.processSlots.every((s) => s.filledId || (s.station && resolveByNameOrId(s.name)));
    // Auto-fill station-only slots from catalog by name if present (even without art)
    state.processSlots.forEach((s) => {
      if (!s.filledId && s.station) {
        const st = resolveByNameOrId(s.name);
        if (st) s.filledId = st.id;
      }
    });
    const ready2 = state.processSlots.every((s) => Boolean(s.filledId));
    createBtn.disabled = !ready2 || !state.processOutput;
    $('#process-hint').textContent = ready2
      ? `Ready to create ${state.processOutput}`
      : 'Tap a dashed slot, then tap a locker icon to fill it';
  }

  function fillProcessSlot(ing) {
    if (state.mode !== 'ingredient' || !state.processSlots.length) return;
    let idx = state.processSlotFocus;
    if (idx == null || idx < 0) idx = state.processSlots.findIndex((s) => !s.filledId);
    if (idx < 0) idx = 0;
    const slot = state.processSlots[idx];
    if (!slot) return;
    // Prefer matching name; allow any fill for authoring flexibility
    slot.filledId = ing.id;
    const next = state.processSlots.findIndex((s, i) => i > idx && !s.filledId);
    state.processSlotFocus = next >= 0 ? next : idx;
    renderProcessAuthor();
  }

  function createIngredient() {
    const proc = state.processData?.catalog?.[state.processId];
    if (!proc || !state.processOutput) return;
    // Auto-bind station slots by name (Dehydrator may have no art)
    state.processSlots.forEach((s) => {
      if (!s.filledId) {
        const match = resolveByNameOrId(s.name);
        if (match) s.filledId = match.id;
      }
    });
    if (!state.processSlots.every((s) => s.filledId)) {
      $('#process-hint').textContent = 'Fill every required input from the locker';
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
    $('#btn-kept').addEventListener('click', () => { renderKept(); showView('view-kept'); });
    $('#btn-gallery').addEventListener('click', () => {
      state.galleryMode = 'have';
      renderGallery();
      showView('view-gallery');
    });
    $('#gal-have').addEventListener('click', () => { state.galleryMode = 'have'; renderGallery(); });
    $('#gal-miss').addEventListener('click', () => { state.galleryMode = 'miss'; renderGallery(); });
    $('#btn-add-variation').addEventListener('click', openVariationPicker);
    $('#btn-keep').addEventListener('click', keepDish);
    $('#btn-discard').addEventListener('click', () => { state.dish = null; showView('view-home'); });
    $('#btn-export').addEventListener('click', exportKept);
    $('#btn-save-drive').addEventListener('click', () => { saveToDrive(); });
    $('#btn-sync-pull').addEventListener('click', () => { pullFromSheet(); });

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

    await Sync().boot(state.catalog, {
      onStatus: setDriveStatus,
      tryPull: Sync().hasClientId()
    });
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
    // Default process highlight: ramen noodles
    const ramen = P().listProcessOptions(state.processData.catalog, state.processData.byOutput)
      .find((o) => o.output === 'Ramen noodles');
    if (ramen) selectProcess(ramen.id, ramen.output);

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
