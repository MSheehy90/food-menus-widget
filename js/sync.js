/* Bidirectional SoT sync: phone widget ↔ Google Sheet.
   Stable ids. Merge: newer updatedAt wins per id.
   Empty GOOGLE_OAUTH_CLIENT_ID → local cache + JSON download (nothing lost).
   No fake login. No secrets. */
(() => {
  'use strict';

  const CFG = () => window.FOOD_MENUS_CONFIG || {};
  const nowIso = () => new Date().toISOString();

  const HEADERS = {
    ingredients: [
      'id', 'name', 'type', 'family', 'stage', 'use_kind', 'process_chain',
      'art_status', 'art_url', 'form', 'hunger_key', 'flavor_key', 'star_roles', 'shelf_days', 'updatedAt'
    ],
    dishes: [
      'id', 'name', 'kind', 'parent_id', 'ingredient_ids', 'slots',
      'stars', 'hunger', 'flavor', 'kcal', 'status', 'style', 'restaurant', 'updatedAt'
    ],
    scoring: ['id', 'section', 'item', 'value', 'notes', 'updatedAt'],
    assets: ['id', 'item', 'art_url', 'form', 'updatedAt'],
    processes: [
      'id', 'name', 'output', 'input_ids', 'input_names', 'station', 'action_kind',
      'process_days', 'shelf_before', 'shelf_after', 'star_roles', 'updatedAt'
    ]
  };

  function hasClientId() {
    return Boolean(String(CFG().GOOGLE_OAUTH_CLIENT_ID || '').trim());
  }

  function emptyStore() {
    return {
      version: 1,
      sheetId: CFG().SHEET_ID,
      ingredients: {},
      dishes: {},
      scoring: {},
      assets: {},
      processes: {},
      dirty: { ingredients: {}, dishes: {}, scoring: {}, assets: {}, processes: {} },
      lastPullAt: null,
      lastPushAt: null
    };
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CFG().CACHE_KEY || 'food-menus-sot-v1');
      if (!raw) return emptyStore();
      const parsed = JSON.parse(raw);
      const base = emptyStore();
      return {
        ...base,
        ...parsed,
        ingredients: parsed.ingredients || {},
        dishes: parsed.dishes || {},
        scoring: parsed.scoring || {},
        assets: parsed.assets || {},
        processes: parsed.processes || {},
        dirty: {
          ingredients: parsed.dirty?.ingredients || {},
          dishes: parsed.dirty?.dishes || {},
          scoring: parsed.dirty?.scoring || {},
          assets: parsed.dirty?.assets || {},
          processes: parsed.dirty?.processes || {}
        }
      };
    } catch {
      return emptyStore();
    }
  }

  function saveCache(store) {
    localStorage.setItem(CFG().CACHE_KEY || 'food-menus-sot-v1', JSON.stringify(store));
  }

  function parseTs(v) {
    if (!v) return 0;
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? t : 0;
  }

  /** Newer updatedAt wins. Equal timestamps → prefer incoming (sheet) on pull, local on push prep. */
  function mergeById(localMap, incomingMap, { preferIncomingOnTie = false } = {}) {
    const out = { ...localMap };
    Object.entries(incomingMap || {}).forEach(([id, row]) => {
      if (!id || !row) return;
      const cur = out[id];
      if (!cur) {
        out[id] = { ...row, id };
        return;
      }
      const a = parseTs(cur.updatedAt);
      const b = parseTs(row.updatedAt);
      if (b > a || (b === a && preferIncomingOnTie)) {
        out[id] = { ...cur, ...row, id };
      }
    });
    return out;
  }

  function markDirty(store, collection, id) {
    if (!store.dirty[collection]) store.dirty[collection] = {};
    store.dirty[collection][id] = true;
  }

  function clearDirty(store, collection, ids) {
    (ids || Object.keys(store.dirty[collection] || {})).forEach((id) => {
      delete store.dirty[collection][id];
    });
  }

  function dirtyCount(store) {
    return ['ingredients', 'dishes', 'scoring', 'assets', 'processes']
      .reduce((n, k) => n + Object.keys(store.dirty[k] || {}).length, 0);
  }

  /* —— painting form (sliced / diced / unit / whole) —— */
  function inferPaintingForm(art, label) {
    const stem = String(art || '').split('/').pop() || '';
    const stemWords = stem
      .replace(/\.(png|jpe?g|webp|gif)$/i, '')
      .replace(/^1_supply_/i, '')
      .replace(/[-_]+/g, ' ');
    const blob = `${label || ''} ${stemWords}`.toLowerCase().replace(/½/g, ' half ');
    if (/\b(sliced|slices|slice|wedges|wedge|strips|strip)\b/.test(blob)) return 'sliced';
    if (
      /\b(unit|sprinkle|single|flakes|flake|pieces|piece|garnish)\b/.test(blob)
      || /\bhalves?\b/.test(blob)
      || /\bhalf\b/.test(blob)
    ) return 'unit';
    if (/\b(diced|chopped|mince|minced|shredded)\b/.test(blob)) return 'diced';
    return 'whole';
  }

  const USE_KINDS = new Set(['dish', 'processed', 'fresh', 'raw']);

  function normalizeUseKind(value) {
    const k = String(value || '').trim().toLowerCase();
    return USE_KINDS.has(k) ? k : '';
  }

  /** Plated / finished-food name cues (never invent Food Master rows). */
  function nameLooksPlated(name) {
    const n = String(name || '').toLowerCase().trim();
    if (!n) return false;
    if (/\b(set|bowl|plate|platter|pie|cake|muffin|donut|doughnut|cookie|sandwich|burger|taco|burrito|stew|soup|salad|curry|casserole|croissant|bagel|danish|cheesecake|brownie|tart|pretzel|challah|dinner)\b/.test(n)) {
      return true;
    }
    return /(pie|cake|muffin|donut|doughnut|cookie|croissant|bagel|danish|cheesecake|brownie|tart|pretzel|roll|loaf)s?$/i.test(n);
  }

  /**
   * Dish when art is under plated extras/heroes, or /dishes/ + plated-looking name.
   * Do not treat 5star/tiles (component art) as dishes.
   * Does not consult useKind — callers apply explicit overrides separately.
   */
  function looksLikeDishIngredient(ing) {
    if (!ing) return false;
    const art = String(ing.art || '').replace(/\\/g, '/').toLowerCase();
    const source = String(ing.source || '').toLowerCase();
    if (/\/dishes\/extra\//.test(art) || /\/dishes\/5star\/heroes\//.test(art)) return true;
    if (/\/dishes\//.test(art) && !/\/5star\/tiles\//.test(art) && nameLooksPlated(ing.name)) return true;
    if ((source === 'kept-dish' || source === 'dishes-list') && nameLooksPlated(ing.name)) return true;
    return false;
  }

  /**
   * Map Food Master Stage + Serving State → use tree kind.
   * Input → empty (no tree-filter membership). Stocked → fresh. Byproduct → raw.
   */
  function inferUseKindFromMaster({ stageRaw, stage, servState, name, art, source } = {}) {
    if (looksLikeDishIngredient({ name, art, source, useKind: '' })) return 'dish';

    const stageText = String(stageRaw || stage || '').trim().toLowerCase();
    const serv = String(servState || '').trim().toLowerCase();

    // Inputs stay out of the use-tree filter unless Melinda overrides in UI.
    if (stageText === 'input') return '';

    // Serving State contains fresh (and not only dried) → fresh
    if (/\bfresh\b/.test(serv) && !/^dried$/.test(serv)) return 'fresh';

    // Stocked bread/yogurt/tofu/wine → fresh (ready-to-eat pantry)
    if (stageText === 'stocked' || serv === 'stocked') return 'fresh';

    // Processed stage OR Serving State Processed/Dried → processed
    if (
      stageText === 'processed'
      || /\bprocess/.test(stageText)
      || serv === 'processed'
      || serv === 'dried'
    ) return 'processed';

    // Byproduct bones/fat → raw
    if (stageText === 'byproduct') return 'raw';

    // Butchered OR Raw/Uncooked → raw
    if (
      stageText === 'butchered'
      || /\bbutcher/.test(stageText)
      || serv === 'raw'
      || serv === 'uncooked'
    ) return 'raw';

    // Primary leftovers without Fresh/Raw/Uncooked already handled above
    if (stageText === 'primary' || stageText === 'raw') {
      if (serv === 'raw' || serv === 'uncooked') return 'raw';
      if (/\bfresh\b/.test(serv)) return 'fresh';
    }

    return '';
  }

  function resolveIngredientUseKind(ing, { allowDishDetect = true } = {}) {
    const explicit = normalizeUseKind(ing?.useKind || ing?.kind);
    if (explicit) return explicit;
    if (allowDishDetect && looksLikeDishIngredient(ing)) return 'dish';
    return inferUseKindFromMaster({
      stageRaw: ing?.stageRaw,
      stage: ing?.stage,
      servState: ing?.servState,
      name: ing?.name,
      art: ing?.art,
      source: ing?.source
    });
  }

  /* —— row mappers —— */
  function ingredientFromCatalog(ing, updatedAt) {
    const art = ing.art || '';
    const form = ing.form || inferPaintingForm(art, ing.name);
    const useKind = normalizeUseKind(ing.useKind || ing.kind);
    return {
      id: ing.id,
      name: ing.name,
      type: ing.uiType || ing.group || '',
      family: ing.uiFamily || ing.category || '',
      stage: ing.stage || '',
      use_kind: useKind,
      process_chain: (ing.chain || [ing.name]).join(' → '),
      art_status: art ? 'present' : 'MISSING',
      art_url: art || 'MISSING',
      form: form || 'whole',
      hunger_key: ing.hungerKey || '',
      flavor_key: ing.flavorKey || '',
      star_roles: (ing.starRoles || []).join(','),
      shelf_days: ing.shelfDays ?? '',
      updatedAt: updatedAt || ing.updatedAt || nowIso()
    };
  }

  function assetFromIngredient(ing, updatedAt) {
    const art = ing.art || '';
    const form = ing.form || inferPaintingForm(art, ing.name);
    return {
      id: ing.id,
      item: ing.name,
      art_url: art || 'MISSING',
      form: form || 'whole',
      updatedAt: updatedAt || ing.updatedAt || nowIso()
    };
  }

  function scoringFromCatalog(catalog, updatedAt) {
    const ts = updatedAt || nowIso();
    const rows = {};
    const add = (section, item, value, notes = '') => {
      const id = `${section}:${String(item).toLowerCase().replace(/\s+/g, '-')}`;
      rows[id] = { id, section, item, value, notes, updatedAt: ts };
    };
    Object.entries(catalog.starTable || {}).forEach(([k, v]) => add('star', k, v));
    const hunger = catalog.meterTables?.hunger || catalog.hungerTable || {};
    Object.entries(hunger).forEach(([k, v]) => add('hunger', k, typeof v === 'object' ? JSON.stringify(v) : v));
    const flavor = catalog.meterTables?.flavor || {};
    Object.entries(flavor).forEach(([k, v]) => add('flavor', k, typeof v === 'object' ? JSON.stringify(v) : v));
    if (catalog.starExample != null) {
      const v = typeof catalog.starExample === 'object'
        ? (catalog.starExample.stars ?? JSON.stringify(catalog.starExample))
        : catalog.starExample;
      add('example', 'fresh-ramen-chashu-pork-broth-scallion', v, 'LOCKED');
    }
    return rows;
  }

  function dishRowFromKept(dish, { kind = 'basic', parentId = '', status } = {}) {
    const score = dish.score || {};
    const ids = (dish.ingredients || []).map((i) => i.id || i.name).join(',');
    const slots = Array.isArray(dish.slots) ? dish.slots : [];
    return {
      id: dish.id,
      name: dish.name || '',
      kind,
      parent_id: parentId,
      ingredient_ids: ids,
      slots: slots.length ? JSON.stringify(slots) : '',
      stars: score.stars?.total ?? score.stars?.label ?? '',
      hunger: score.hunger?.label ?? score.hunger?.pct ?? '',
      flavor: score.flavor?.label ?? score.flavor?.pct ?? '',
      kcal: score.hunger?.kcal ?? '',
      status: status || dish.status || 'kept',
      style: dish.style || '',
      restaurant: dish.restaurant || dish.restaurantName || '',
      updatedAt: dish.updatedAt || dish.exportedAt || nowIso()
    };
  }

  function flattenDishes(dishes) {
    const map = {};
    (dishes || []).forEach((d) => {
      const basic = dishRowFromKept(d, { kind: 'basic', status: d.status || 'kept' });
      map[basic.id] = basic;
      (d.variations || []).forEach((v) => {
        const row = dishRowFromKept(v, {
          kind: 'variation',
          parentId: d.id,
          status: d.status || 'kept'
        });
        map[row.id] = row;
      });
    });
    return map;
  }

  /** Seed local cache from baked catalog when empty. */
  function seedFromCatalog(catalog, { markAllDirty = false } = {}) {
    const store = loadCache();
    const ts = catalog.generatedAt || catalog.generatedFrom || nowIso();
    const seedTs = typeof ts === 'string' ? ts : nowIso();

    if (!Object.keys(store.ingredients).length) {
      (catalog.ingredients || []).forEach((ing) => {
        const row = ingredientFromCatalog(ing, seedTs);
        store.ingredients[row.id] = row;
        store.assets[row.id] = assetFromIngredient(ing, seedTs);
        if (markAllDirty) {
          markDirty(store, 'ingredients', row.id);
          markDirty(store, 'assets', row.id);
        }
      });
    }
    if (!Object.keys(store.scoring).length) {
      store.scoring = scoringFromCatalog(catalog, seedTs);
      if (markAllDirty) {
        Object.keys(store.scoring).forEach((id) => markDirty(store, 'scoring', id));
      }
    }
    saveCache(store);
    return store;
  }

  /** Apply sheet/local ingredient rows onto live catalog objects (art + meta). */
  function applyIngredientRowsToCatalog(catalog, ingredientMap, assetMap) {
    const byId = new Map((catalog.ingredients || []).map((i) => [i.id, i]));
    Object.values(ingredientMap || {}).forEach((row) => {
      let ing = byId.get(row.id);
      const rowUseKind = normalizeUseKind(row.use_kind || row.useKind || row.kind);
      if (!ing) {
        ing = {
          id: row.id,
          name: row.name,
          uiType: row.type || 'Other',
          uiFamily: row.family || 'Misc',
          stage: row.stage || '',
          useKind: rowUseKind,
          chain: String(row.process_chain || row.name).split(/\s*→\s*/).filter(Boolean),
          art: '',
          hungerKey: row.hunger_key || null,
          flavorKey: row.flavor_key || null,
          starRoles: String(row.star_roles || '').split(',').map((s) => s.trim()).filter(Boolean),
          unlocked: true,
          processed: false
        };
        catalog.ingredients.push(ing);
        byId.set(ing.id, ing);
        const hier = catalog.hierarchy || (catalog.hierarchy = {});
        if (!hier[ing.uiType]) hier[ing.uiType] = {};
        if (!hier[ing.uiType][ing.uiFamily]) hier[ing.uiType][ing.uiFamily] = [];
        if (!hier[ing.uiType][ing.uiFamily].includes(ing.id)) {
          hier[ing.uiType][ing.uiFamily].push(ing.id);
        }
        if (Array.isArray(catalog.typeOrder) && !catalog.typeOrder.includes(ing.uiType)) {
          catalog.typeOrder.push(ing.uiType);
        }
      } else {
        if (row.name) ing.name = row.name;
        if (row.type) ing.uiType = row.type;
        if (row.family) ing.uiFamily = row.family;
        if (row.stage != null) ing.stage = row.stage;
        if (rowUseKind) ing.useKind = rowUseKind;
        if (row.process_chain) {
          ing.chain = String(row.process_chain).split(/\s*→\s*/).filter(Boolean);
        }
        if (row.hunger_key) ing.hungerKey = row.hunger_key;
        if (row.flavor_key) ing.flavorKey = row.flavor_key;
        if (row.shelf_days !== undefined && row.shelf_days !== '') {
          const n = Number(row.shelf_days);
          ing.shelfDays = Number.isFinite(n) ? n : row.shelf_days;
        }
        if (row.star_roles != null) {
          ing.starRoles = String(row.star_roles).split(',').map((s) => s.trim()).filter(Boolean);
        }
        if (row.form) ing.form = String(row.form).trim().toLowerCase();
      }
      const asset = assetMap?.[row.id];
      const artRaw = (asset && asset.art_url) || row.art_url || '';
      if (artRaw && artRaw !== 'MISSING') {
        ing.art = artRaw;
      } else if (artRaw === 'MISSING' || row.art_status === 'MISSING') {
        ing.art = '';
      }
      if (!ing.form) {
        const assetForm = asset?.form;
        ing.form = String(assetForm || row.form || inferPaintingForm(ing.art, ing.name) || 'whole').toLowerCase();
      }
      ing.updatedAt = row.updatedAt;
    });
    return catalog;
  }

  function slugFoodMasterId(name, usedIds) {
    const base = String(name || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item';
    let id = base;
    let n = 2;
    while (usedIds.has(id)) {
      id = `${base}-${n++}`;
    }
    usedIds.add(id);
    return id;
  }

  function ensureCatalogHierarchy(catalog, ing) {
    const hier = catalog.hierarchy || (catalog.hierarchy = {});
    Object.keys(hier).forEach((t) => {
      Object.keys(hier[t] || {}).forEach((f) => {
        hier[t][f] = (hier[t][f] || []).filter((id) => id !== ing.id);
      });
    });
    const type = ing.uiType || 'Other';
    const fam = ing.uiFamily || 'Misc';
    if (!hier[type]) hier[type] = {};
    if (!hier[type][fam]) hier[type][fam] = [];
    if (!hier[type][fam].includes(ing.id)) hier[type][fam].push(ing.id);
    if (Array.isArray(catalog.typeOrder) && !catalog.typeOrder.includes(type)) {
      catalog.typeOrder.push(type);
    }
  }

  /**
   * Parse Food Master sheet values. Header is typically CSV row 3:
   * Row,Item,Stage,Group,Category,Type,...,Serving State,...
   */
  function parseFoodMasterSheetValues(values) {
    const rows = values || [];
    let headerIdx = -1;
    let headers = [];
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const cells = (rows[i] || []).map((c) => String(c || '').trim());
      if (cells.includes('Item') && (cells.includes('Group') || cells.includes('Category'))) {
        headerIdx = i;
        headers = cells.map((h) => h.toLowerCase());
        break;
      }
    }
    if (headerIdx < 0) return [];
    const idx = (name) => headers.indexOf(String(name).toLowerCase());
    const iItem = idx('item');
    const iStage = idx('stage');
    const iGroup = idx('group');
    const iCategory = idx('category');
    const iType = idx('type');
    const iServState = idx('serving state');
    const out = [];
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const line = rows[r] || [];
      const item = String(line[iItem] ?? '').trim();
      if (!item) continue;
      out.push({
        item,
        stage: String(line[iStage] ?? '').trim(),
        stageRaw: String(line[iStage] ?? '').trim(),
        group: String(line[iGroup] ?? '').trim(),
        category: String(line[iCategory] ?? '').trim(),
        type: String(line[iType] ?? '').trim(),
        servState: iServState >= 0 ? String(line[iServState] ?? '').trim() : ''
      });
    }
    return out;
  }

  function foodMasterRowsFromBaked(data) {
    return (data?.rows || []).map((row) => ({
      item: row.item || row.Item || '',
      stage: row.stage || '',
      stageRaw: row.stageRaw || row.stage || '',
      group: row.group || '',
      category: row.category || '',
      type: row.type || '',
      servState: row.servState || row['Serving State'] || ''
    })).filter((r) => r.item);
  }

  async function loadBakedFoodMasterRows() {
    try {
      const res = await fetch('data/food-master-v2.json');
      if (!res.ok) return [];
      return foodMasterRowsFromBaked(await res.json());
    } catch {
      return [];
    }
  }

  /**
   * Read-only merge of Food Master Item roster into catalog.
   * Creates missing catalog rows; updates uiType from Group and uiFamily/category from Category.
   * Applies Stage + Serving State → useKind (dish|processed|fresh|raw).
   * Does NOT invent HQ extras or write back to Food Master.
   * Dirty local / SoT use_kind overrides are preserved (same idea as dirty art).
   */
  function applyFoodMasterRowsToCatalog(catalog, masterRows, {
    dirtyIngredientIds = null,
    preserveUseKindIds = null
  } = {}) {
    if (!catalog || !Array.isArray(masterRows)) return { created: 0, updated: 0 };
    const dirtyIds = dirtyIngredientIds instanceof Set
      ? dirtyIngredientIds
      : new Set(dirtyIngredientIds || []);
    const preserveKindIds = preserveUseKindIds instanceof Set
      ? preserveUseKindIds
      : new Set(preserveUseKindIds || []);
    const usedIds = new Set((catalog.ingredients || []).map((i) => i.id));
    const byName = new Map();
    (catalog.ingredients || []).forEach((ing) => {
      byName.set(String(ing.name || '').trim().toLowerCase(), ing);
    });
    let created = 0;
    let updated = 0;
    const touched = new Set();
    const shouldPreserveKind = (ing) => {
      if (!ing) return false;
      if (!normalizeUseKind(ing.useKind)) return false;
      return dirtyIds.has(ing.id) || preserveKindIds.has(ing.id);
    };
    masterRows.forEach((row) => {
      const name = String(row.item || '').trim();
      if (!name) return;
      const group = String(row.group || '').trim();
      const category = String(row.category || '').trim();
      const type = String(row.type || '').trim();
      const stageCode = String(row.stage || '').trim();
      const stageRaw = String(row.stageRaw || row.stage || '').trim();
      const servState = String(row.servState || '').trim();
      const stage = (() => {
        const s = (stageCode || stageRaw).toLowerCase();
        if (!s) return '';
        if (s.includes('process') || s === 'made' || s === 'processed') return 'processed';
        if (s.includes('primary') || s.includes('raw') || s.includes('butcher')) return 'primary';
        return stageCode || s;
      })();
      const inferredKind = inferUseKindFromMaster({
        stageRaw: stageRaw || stage,
        stage,
        servState,
        name
      });
      let ing = byName.get(name.toLowerCase());
      if (!ing) {
        const id = slugFoodMasterId(name, usedIds);
        ing = {
          id,
          name,
          group: group || 'Other',
          pyramid: group || '',
          category: category || '',
          type,
          stage: stage || 'primary',
          stageRaw: stageRaw || stage || 'Primary',
          servState,
          useKind: inferredKind,
          uiType: group || 'Other',
          uiFamily: category || 'Misc',
          processed: stage === 'processed',
          chain: [name],
          art: '',
          unlocked: true,
          exclusive: null,
          process: null,
          source: 'food-master',
          starRoles: [],
          starValue: 0,
          form: 'whole'
        };
        catalog.ingredients.push(ing);
        byName.set(name.toLowerCase(), ing);
        created += 1;
      } else {
        let changed = false;
        if (group && (ing.uiType !== group || ing.group !== group)) {
          ing.uiType = group;
          ing.group = group;
          changed = true;
        }
        if (category && (ing.uiFamily !== category || ing.category !== category)) {
          ing.uiFamily = category;
          ing.category = category;
          changed = true;
        }
        if (type !== '' && ing.type !== type) {
          ing.type = type;
          changed = true;
        }
        if (stage && ing.stage !== stage) {
          ing.stage = stage;
          changed = true;
        }
        if (stageRaw && ing.stageRaw !== stageRaw) {
          ing.stageRaw = stageRaw;
          changed = true;
        }
        if (servState !== '' && ing.servState !== servState) {
          ing.servState = servState;
          changed = true;
        } else if (servState && !ing.servState) {
          ing.servState = servState;
          changed = true;
        }
        if (!shouldPreserveKind(ing)) {
          const nextKind = looksLikeDishIngredient(ing)
            ? 'dish'
            : inferredKind;
          if (nextKind !== normalizeUseKind(ing.useKind)) {
            ing.useKind = nextKind;
            changed = true;
          }
        }
        if (changed) updated += 1;
      }
      touched.add(ing.id);
      ensureCatalogHierarchy(catalog, ing);
    });

    // HQ tiles / extras not on Food Master: infer from stageRaw, servState, or plated art.
    (catalog.ingredients || []).forEach((ing) => {
      if (!ing || touched.has(ing.id) || shouldPreserveKind(ing)) return;
      const next = resolveIngredientUseKind(ing);
      if (next !== normalizeUseKind(ing.useKind)) {
        ing.useKind = next;
        updated += 1;
      }
    });
    return { created, updated };
  }

  function upsertLocal(collection, row, { dirty = true } = {}) {
    const store = loadCache();
    if (!row?.id) throw new Error('Row needs stable id');
    const prev = store[collection][row.id];
    const next = {
      ...(prev || {}),
      ...row,
      id: row.id,
      updatedAt: row.updatedAt || nowIso()
    };
    store[collection][row.id] = next;
    if (dirty) markDirty(store, collection, row.id);
    saveCache(store);
    return next;
  }

  function syncDishesFromKept(keptList, { dirty = true } = {}) {
    const store = loadCache();
    const flat = flattenDishes(keptList);
    Object.values(flat).forEach((row) => {
      const prev = store.dishes[row.id];
      if (!prev || parseTs(row.updatedAt) >= parseTs(prev.updatedAt)) {
        store.dishes[row.id] = row;
        if (dirty) markDirty(store, 'dishes', row.id);
      }
    });
    saveCache(store);
    return store;
  }

  function markDishStatus(dishId, status) {
    const store = loadCache();
    const row = store.dishes[dishId];
    if (!row) return null;
    row.status = status;
    row.updatedAt = nowIso();
    markDirty(store, 'dishes', dishId);
    // variations share parent status
    Object.values(store.dishes).forEach((d) => {
      if (d.parent_id === dishId) {
        d.status = status;
        d.updatedAt = row.updatedAt;
        markDirty(store, 'dishes', d.id);
      }
    });
    saveCache(store);
    return row;
  }

  /* —— Sheets API —— */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  let gapiReady = null;
  function ensureGapi() {
    if (gapiReady) return gapiReady;
    gapiReady = (async () => {
      await loadScript('https://accounts.google.com/gsi/client');
      await loadScript('https://apis.google.com/js/api.js');
      await new Promise((resolve) => window.gapi.load('client', resolve));
      await window.gapi.client.init({ discoveryDocs: CFG().DISCOVERY_DOCS });
    })();
    return gapiReady;
  }

  function requestAccessToken() {
    return new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CFG().GOOGLE_OAUTH_CLIENT_ID,
        scope: CFG().SCOPES,
        callback: (resp) => {
          if (resp.error) reject(new Error(resp.error));
          else resolve(resp.access_token);
        }
      });
      client.requestAccessToken({ prompt: '' });
    });
  }

  function tabName(key) {
    return (CFG().TABS || {})[key] || key;
  }

  function valuesToMaps(values, headerList) {
    const map = {};
    if (!values?.length) return map;
    const header = values[0].map((h) => String(h || '').trim());
    const idx = {};
    headerList.forEach((h) => {
      idx[h] = header.indexOf(h);
    });
    // tolerate missing updatedAt column
    for (let r = 1; r < values.length; r++) {
      const line = values[r];
      if (!line || !line.length) continue;
      const get = (h) => {
        const i = idx[h];
        return i >= 0 ? (line[i] ?? '') : '';
      };
      const id = String(get('id') || '').trim();
      if (!id) continue;
      const row = { id };
      headerList.forEach((h) => {
        if (h === 'id') return;
        row[h] = get(h);
      });
      if (!row.updatedAt) row.updatedAt = nowIso();
      map[id] = row;
    }
    return map;
  }

  function mapsToValues(map, headerList, onlyIds = null) {
    const rows = [headerList];
    const list = onlyIds
      ? onlyIds.map((id) => map[id]).filter(Boolean)
      : Object.values(map);
    list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    list.forEach((row) => {
      rows.push(headerList.map((h) => (row[h] == null ? '' : row[h])));
    });
    return rows;
  }

  async function ensureTabs(spreadsheetId) {
    const meta = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
    const sheets = meta.result.sheets || [];
    const titles = sheets.map((s) => s.properties.title);
    const wanted = ['ingredients', 'dishes', 'scoring', 'assets', 'processes'].map(tabName);
    const requests = [];
    wanted.forEach((title) => {
      if (!titles.includes(title)) {
        requests.push({ addSheet: { properties: { title } } });
      }
    });
    // Prefer renaming lone default sheet to Scoring rules when empty of preferred tabs
    if (!titles.includes(tabName('scoring'))) {
      const defaultSheet = sheets.find((s) => /^Sheet1$/i.test(s.properties.title));
      if (defaultSheet && !titles.includes(tabName('scoring'))) {
        // already adding Scoring rules above; leave Sheet1 scoring content — user can migrate
      }
    }
    if (requests.length) {
      await window.gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests }
      });
    }
    return wanted;
  }

  async function readTab(spreadsheetId, title) {
    try {
      const res = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${title}'!A1:Z`
      });
      return res.result.values || [];
    } catch (err) {
      // missing tab / empty
      return [];
    }
  }

  async function writeTab(spreadsheetId, title, values) {
    await window.gapi.client.sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${title}'`
    });
    await window.gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${title}'!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });
  }

  /** Upsert dirty rows into existing tab without wiping unrelated sheet edits. */
  async function upsertDirtyRows(spreadsheetId, title, headerList, localMap, dirtyIds) {
    const existing = await readTab(spreadsheetId, title);
    let header = existing[0] ? existing[0].map((h) => String(h || '').trim()) : [...headerList];
    headerList.forEach((h) => {
      if (!header.includes(h)) header.push(h);
    });
    const idIdx = header.indexOf('id');
    const body = existing.slice(1);
    const rowIndexById = new Map();
    body.forEach((line, i) => {
      const id = idIdx >= 0 ? String(line[idIdx] || '').trim() : '';
      if (id) rowIndexById.set(id, i);
    });

    const data = body.map((line) => {
      const obj = {};
      header.forEach((h, i) => { obj[h] = line[i] ?? ''; });
      return obj;
    });

    dirtyIds.forEach((id) => {
      const row = localMap[id];
      if (!row) return;
      const obj = {};
      header.forEach((h) => { obj[h] = row[h] == null ? '' : row[h]; });
      if (rowIndexById.has(id)) {
        data[rowIndexById.get(id)] = obj;
      } else {
        data.push(obj);
      }
    });

    const values = [
      header,
      ...data.map((obj) => header.map((h) => obj[h] ?? ''))
    ];
    await writeTab(spreadsheetId, title, values);
  }

  async function pullFromSheet({ onStatus } = {}) {
    const status = (m) => { if (typeof onStatus === 'function') onStatus(m); };
    if (!hasClientId()) {
      return {
        ok: false,
        reason: 'missing-client-id',
        message: CFG().HTTPS_SIGNIN_MSG,
        store: loadCache()
      };
    }
    status('Signing in to Google…');
    await ensureGapi();
    const token = await requestAccessToken();
    window.gapi.client.setToken({ access_token: token });
    const spreadsheetId = CFG().SHEET_ID;
    status('Ensuring sheet tabs…');
    await ensureTabs(spreadsheetId);

    status('Pulling Ingredients / Dishes / Scoring rules / Assets / Process chains…');
    const [ingV, dishV, scoreV, assetV, procV] = await Promise.all([
      readTab(spreadsheetId, tabName('ingredients')),
      readTab(spreadsheetId, tabName('dishes')),
      readTab(spreadsheetId, tabName('scoring')),
      readTab(spreadsheetId, tabName('assets')),
      readTab(spreadsheetId, tabName('processes'))
    ]);

    const incoming = {
      ingredients: valuesToMaps(ingV, HEADERS.ingredients),
      dishes: valuesToMaps(dishV, HEADERS.dishes),
      scoring: valuesToMaps(scoreV, HEADERS.scoring),
      assets: valuesToMaps(assetV, HEADERS.assets),
      processes: valuesToMaps(procV, HEADERS.processes)
    };

    const store = loadCache();
    store.ingredients = mergeById(store.ingredients, incoming.ingredients, { preferIncomingOnTie: true });
    store.dishes = mergeById(store.dishes, incoming.dishes, { preferIncomingOnTie: true });
    store.scoring = mergeById(store.scoring, incoming.scoring, { preferIncomingOnTie: true });
    store.assets = mergeById(store.assets, incoming.assets, { preferIncomingOnTie: true });
    store.processes = mergeById(store.processes, incoming.processes, { preferIncomingOnTie: true });
    store.lastPullAt = nowIso();
    saveCache(store);

    let foodMasterRows = [];
    const masterId = String(CFG().FOOD_MASTER_SHEET_ID || '').trim();
    if (masterId) {
      status('Pulling Food Master…');
      try {
        const fmRes = await window.gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: masterId,
          range: 'A1:Z'
        });
        foodMasterRows = parseFoodMasterSheetValues(fmRes.result.values || []);
        status(`Food Master · ${foodMasterRows.length} item row(s)`);
      } catch (err) {
        status(`Food Master live pull failed — using baked fallback (${err.message || err})`);
        foodMasterRows = await loadBakedFoodMasterRows();
      }
    } else {
      foodMasterRows = await loadBakedFoodMasterRows();
    }

    status(`Pulled & merged · ${dirtyCount(store)} dirty local row(s)`);
    return { ok: true, store, incoming, foodMasterRows };
  }

  function buildDumpPayload(store) {
    return {
      version: 1,
      kind: 'snowpiercer-food-menus-sot-dump',
      note: 'Bidirectional SoT dump — Ingredients, Dishes, Scoring rules, Assets, Process chains. Merge by id + updatedAt.',
      targetSheetId: CFG().SHEET_ID,
      targetSheetUrl: CFG().SHEET_URL,
      tabs: CFG().TABS,
      exportedAt: nowIso(),
      lastPullAt: store.lastPullAt,
      lastPushAt: store.lastPushAt,
      dirtyCount: dirtyCount(store),
      collections: {
        ingredients: Object.values(store.ingredients),
        dishes: Object.values(store.dishes),
        scoring: Object.values(store.scoring),
        assets: Object.values(store.assets),
        processes: Object.values(store.processes || {})
      },
      sheetTables: {
        Ingredients: mapsToValues(store.ingredients, HEADERS.ingredients),
        Dishes: mapsToValues(store.dishes, HEADERS.dishes),
        'Scoring rules': mapsToValues(store.scoring, HEADERS.scoring),
        Assets: mapsToValues(store.assets, HEADERS.assets),
        'Process chains': mapsToValues(store.processes || {}, HEADERS.processes)
      }
    };
  }

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || `food-menus-sot-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function pushDirty({ onStatus, forceFull = false } = {}) {
    const status = (m) => { if (typeof onStatus === 'function') onStatus(m); };
    const store = loadCache();
    saveCache(store); // ensure persisted before download

    const payload = buildDumpPayload(store);
    downloadJson(payload);
    status('JSON downloaded · local cache kept.');

    if (!hasClientId()) {
      const msg = CFG().HTTPS_SIGNIN_MSG;
      status(`${msg}`);
      return {
        ok: false,
        reason: 'missing-client-id',
        message: msg,
        payload,
        store
      };
    }

    status('Signing in to Google…');
    await ensureGapi();
    const token = await requestAccessToken();
    window.gapi.client.setToken({ access_token: token });
    const spreadsheetId = CFG().SHEET_ID;
    await ensureTabs(spreadsheetId);

    const collections = [
      ['ingredients', HEADERS.ingredients],
      ['dishes', HEADERS.dishes],
      ['scoring', HEADERS.scoring],
      ['assets', HEADERS.assets],
      ['processes', HEADERS.processes]
    ];

    for (const [key, header] of collections) {
      const title = tabName(key);
      const existing = await readTab(spreadsheetId, title);
      const emptyTab = !existing.length || existing.length === 1;
      const dirtyIds = forceFull
        ? Object.keys(store[key])
        : Object.keys(store.dirty[key] || {});

      if (forceFull || (emptyTab && Object.keys(store[key]).length)) {
        status(`Seeding ${title} (${Object.keys(store[key]).length})…`);
        await writeTab(spreadsheetId, title, mapsToValues(store[key], header));
        clearDirty(store, key, Object.keys(store[key]));
        continue;
      }
      if (!dirtyIds.length) continue;
      status(`Writing ${title} (${dirtyIds.length})…`);
      await upsertDirtyRows(spreadsheetId, title, header, store[key], dirtyIds);
      clearDirty(store, key, dirtyIds);
    }

    store.lastPushAt = nowIso();
    saveCache(store);
    status(`Sheet updated · ${store.lastPushAt}`);
    return { ok: true, payload, store };
  }

  /** Boot helper: seed + optional pull + return merged store. */
  async function boot(catalog, { onStatus, tryPull = true } = {}) {
    let store = seedFromCatalog(catalog, { markAllDirty: false });
    // Merge any prior local dish/ingredient edits already in cache (already loaded)
    if (tryPull && hasClientId()) {
      try {
        const pulled = await pullFromSheet({ onStatus });
        if (pulled.ok) store = pulled.store;
      } catch (err) {
        if (typeof onStatus === 'function') {
          onStatus(`Sheet pull skipped: ${err.message || err}`);
        }
        store = loadCache();
      }
    } else if (typeof onStatus === 'function' && tryPull && !hasClientId()) {
      onStatus('Local SoT cache ready · live two-way needs HTTPS + Google sign-in');
    }
    applyIngredientRowsToCatalog(catalog, store.ingredients, store.assets);
    const baked = await loadBakedFoodMasterRows();
    const dirtyIngredientIds = Object.keys(store.dirty?.ingredients || {});
    const preserveUseKindIds = Object.values(store.ingredients || {})
      .filter((row) => normalizeUseKind(row.use_kind))
      .map((row) => row.id);
    applyFoodMasterRowsToCatalog(catalog, baked, { dirtyIngredientIds, preserveUseKindIds });
    return store;
  }

  function parseSlotsField(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(String(raw));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function keptFromStore(store) {
    // Reconstruct minimal kept list from dish rows (basics only with status kept)
    const basics = Object.values(store.dishes || {}).filter((d) => d.kind === 'basic');
    const vars = Object.values(store.dishes || {}).filter((d) => d.kind === 'variation');
    return basics
      .filter((d) => (d.status || 'kept') !== 'trimmed')
      .map((d) => {
        const variations = vars
          .filter((v) => v.parent_id === d.id)
          .map((v) => ({
            id: v.id,
            name: v.name,
            style: v.style,
            status: v.status,
            ingredients: String(v.ingredient_ids || '').split(',').filter(Boolean).map((id) => ({ id })),
            slots: parseSlotsField(v.slots),
            score: {
              stars: { label: String(v.stars), total: Number(v.stars) || 0, display: `${v.stars}★` },
              hunger: { label: String(v.hunger) },
              flavor: { label: String(v.flavor) }
            },
            updatedAt: v.updatedAt
          }));
        return {
          id: d.id,
          name: d.name,
          style: d.style,
          restaurant: d.restaurant || '',
          status: d.status || 'kept',
          ingredients: String(d.ingredient_ids || '').split(',').filter(Boolean).map((id) => ({ id })),
          slots: parseSlotsField(d.slots),
          score: {
            stars: { label: String(d.stars), total: Number(d.stars) || 0, display: `${d.stars}★` },
            hunger: { label: String(d.hunger) },
            flavor: { label: String(d.flavor) }
          },
          variations,
          updatedAt: d.updatedAt
        };
      })
      .sort((a, b) => parseTs(b.updatedAt) - parseTs(a.updatedAt));
  }

  window.FoodMenusSync = {
    HEADERS,
    hasClientId,
    loadCache,
    saveCache,
    seedFromCatalog,
    boot,
    pullFromSheet,
    pushDirty,
    buildDumpPayload,
    downloadJson,
    upsertLocal,
    syncDishesFromKept,
    markDishStatus,
    applyIngredientRowsToCatalog,
    applyFoodMasterRowsToCatalog,
    parseFoodMasterSheetValues,
    loadBakedFoodMasterRows,
    foodMasterRowsFromBaked,
    inferPaintingForm,
    inferUseKindFromMaster,
    resolveIngredientUseKind,
    normalizeUseKind,
    looksLikeDishIngredient,
    flattenDishes,
    ingredientFromCatalog,
    assetFromIngredient,
    dirtyCount,
    keptFromStore,
    mergeById,
    nowIso
  };
})();
