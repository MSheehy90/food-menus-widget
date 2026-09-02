// Snowpiercer restaurant menus v1 — per-eatery slot templates, resolve BOM, combination rating.
(() => {
'use strict';

const META = { version: 1, note: 'Per-restaurant menu shell from data/restaurant-menus-v1.json' };

const FLAVOR_FAMILY_MAP = [
  ['umami', /umami|savory|beefy|brothy|meaty|concentrated/i],
  ['rich', /rich|fatty|buttery|nutty|deep/i],
  ['bright', /bright|acidic|citrus|tart|sharp/i],
  ['herbal', /herbal|grassy|aromatic|cilantro|green/i],
  ['sweet', /sweet|caramel|fruity|honey/i],
  ['spicy', /spicy|pungent|chile|peppery|heat/i],
  ['earthy', /earthy|mushroom|rooty|woody/i],
  ['clean', /clean|mild|fresh|light/i]
];

const COMPLEMENT_PAIRS = [
  ['umami', 'bright'],
  ['rich', 'bright'],
  ['herbal', 'umami'],
  ['spicy', 'rich']
];

const PYRAMID_KEYS = ['grains', 'vegetables', 'fruit', 'dairy', 'protein', 'fat'];
const TIER_PRESENT_PCT = 0.05;
const FAT_TIER_MAX_PCT = 0.20;
// A slot (or the legacy core/extras list) can now resolve more than one ingredient —
// e.g. ramen's protein slot picking both Chashu and Eggs. Cap total picks per dish so
// "add everything" isn't a strictly dominant strategy.
const MAX_DISH_INGREDIENTS = 5;

let data = null;
let byEateryType = {};
let byRestaurantId = {};

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

// 0-100 score -> 0-5 stars (0 only when nothing's been picked yet).
function starsForScore(score) {
  return clamp(Math.round(Number(score || 0) / 20), 0, 5);
}

function pyramid() {
  return window.SnowpiercerFoodPyramid;
}

function flavorFamily(tag) {
  const t = String(tag || '').toLowerCase();
  for (const [fam, re] of FLAVOR_FAMILY_MAP) {
    if (re.test(t)) return fam;
  }
  return null;
}

function indexRestaurants(payload) {
  byEateryType = {};
  byRestaurantId = {};
  (payload?.restaurants || []).forEach(r => {
    byRestaurantId[r.id] = r;
    byEateryType[r.eateryType] = r;
    (r.eateryTypes || []).forEach(t => { byEateryType[t] = r; });
  });
}

function apply(payload) {
  if (!payload?.restaurants?.length) return;
  data = payload;
  indexRestaurants(payload);
  // Do not write dishFamilies onto seed.restaurantCatalog.combinationMenus —
  // live Food-tab menus (Michelin risotto alternatives, diner entree, etc.) are SoT.
  window.SNOWPIERCER_RESTAURANT_MENUS_V1 = payload;
  try {
    window.dispatchEvent(new CustomEvent('snowpiercer-restaurant-menus-ready', { detail: { count: payload.restaurants.length } }));
  } catch (_) { /* noop */ }
}

function getRestaurant(idOrEateryType) {
  return byRestaurantId[idOrEateryType] || byEateryType[idOrEateryType] || null;
}

function getMenu(idOrEateryType) {
  return getRestaurant(idOrEateryType);
}

function getDishFamily(idOrEateryType, dishId) {
  const r = getRestaurant(idOrEateryType);
  return (r?.dishFamilies || []).find(d => d.id === dishId) || null;
}

function defaultPicks(dish) {
  const picks = {};
  (dish?.slots || []).forEach(s => {
    picks[s.id] = s.defaultChoice || (s.choices?.[0]?.[0] || '');
  });
  return picks;
}

function resolveDish(idOrEateryType, dishId, picks) {
  const dish = getDishFamily(idOrEateryType, dishId);
  if (!dish) return {};
  const restaurant = getRestaurant(idOrEateryType);
  const eateryType = restaurant?.eateryType || idOrEateryType;
  const LS = window.SnowpiercerLifeSim;
  const bom = {};
  let pickCount = 0;
  (dish.slots || []).forEach(slot => {
    const raw = picks?.[slot.id];
    const requested = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
    let resolved = requested
      .map(choiceName => (slot.choices || []).find(([n]) => n === choiceName))
      .filter(Boolean)
      // Specialty exclusives stay on their owning shop only.
      .filter(([n]) => !LS?.specialtyExclusiveAllowed || LS.specialtyExclusiveAllowed(n, eateryType));
    if (!resolved.length) {
      // Nothing valid requested — fall back to the slot's default single choice
      // (unchanged from the pre-multi-select behavior), so every slot still resolves.
      const fallbackName = slot.defaultChoice || slot.choices?.[0]?.[0];
      const fallbackRow = (slot.choices || []).find(([n]) => n === fallbackName) || slot.choices?.[0];
      if (fallbackRow && (!LS?.specialtyExclusiveAllowed || LS.specialtyExclusiveAllowed(fallbackRow[0], eateryType))) {
        resolved = [fallbackRow];
      }
    }
    resolved.forEach(row => {
      if (pickCount >= MAX_DISH_INGREDIENTS) return;
      const [name, kg] = row;
      if (!name) return;
      bom[name] = (bom[name] || 0) + Number(kg || 0);
      pickCount++;
      // Companion BOM lines for a pick (e.g. Miso paste needs cooking water).
      (slot.choiceExtras?.[name] || []).forEach(([n, k]) => {
        if (n) bom[n] = (bom[n] || 0) + Number(k || 0);
      });
    });
  });
  return bom;
}

function listSubstitutes(groupId) {
  return data?.substituteGroups?.[groupId]?.members || [];
}

function getMenuPlan(st, eateryType) {
  st.menuPlans = st.menuPlans || {};
  const saved = st.menuPlans[eateryType];
  const r = getRestaurant(eateryType);
  if (!r) return null;
  const activeDish = saved?.activeDish || r.dishFamilies?.[0]?.id;
  const dish = getDishFamily(eateryType, activeDish);
  const slots = { ...defaultPicks(dish), ...(saved?.slots || {}) };
  return { activeDish, slots, restaurant: r, dish };
}

function applyMenuPlan(st, eateryType, plan) {
  st.menuPlans = st.menuPlans || {};
  const bom = resolveDish(eateryType, plan.activeDish, plan.slots);
  const rating = rateDishCombination(bom);
  st.menuPlans[eateryType] = {
    activeDish: plan.activeDish,
    slots: { ...plan.slots },
    lastRating: rating
  };
  return st.menuPlans[eateryType];
}

function persistState(st) {
  // Main save key must go through WriteSave (prune / retry / toast / in-memory degrade).
  if (typeof window.SnowpiercerWriteSave === 'function') {
    window.SnowpiercerWriteSave(st);
    return;
  }
  if (typeof window.SnowpiercerPersist === 'function') {
    window.SnowpiercerPersist(st);
  }
}

function rateDishCombination(bom) {
  const pyrApi = pyramid();
  const entries = Object.entries(bom || {}).filter(([, kg]) => Number(kg) > 0);
  if (!entries.length) {
    return {
      score: 0, stars: 0, flavorBalance: 0, pyramidCoverage: 0,
      flavorFamilies: {}, pyramidTiers: {}, tags: [], missingTiers: [...PYRAMID_KEYS], hints: ['Pick ingredients to rate this dish.']
    };
  }

  const totalKg = entries.reduce((s, [, kg]) => s + Number(kg), 0);
  const flavorFamilies = {};
  const tagWeights = {};
  const pyramidTiers = {};
  PYRAMID_KEYS.forEach(k => { pyramidTiers[k] = 0; });

  entries.forEach(([name, kg]) => {
    const share = Number(kg) / totalKg;
    const tags = pyrApi?.flavorTagsForItem?.(name) || [];
    tags.forEach(tag => {
      tagWeights[tag] = (tagWeights[tag] || 0) + share / Math.max(1, tags.length);
      const fam = flavorFamily(tag);
      if (fam) flavorFamilies[fam] = (flavorFamilies[fam] || 0) + share / Math.max(1, tags.length);
    });
    const tier = pyrApi?.pyramidClassForItem?.(name) || 'other';
    if (pyramidTiers[tier] != null) pyramidTiers[tier] += share;
  });

  const famEntries = Object.entries(flavorFamilies).sort((a, b) => b[1] - a[1]);
  const topFamShare = famEntries[0]?.[1] || 0;
  let flavorBalance = 0;
  famEntries.forEach(([, share]) => {
    if (share >= 0.10) flavorBalance += 8;
  });
  flavorBalance = Math.min(40, flavorBalance);
  if (famEntries.length <= 1) flavorBalance -= 5;
  if (topFamShare <= 0.45 && famEntries.length > 1) flavorBalance += 10;
  let complement = 0;
  COMPLEMENT_PAIRS.forEach(([a, b]) => {
    if ((flavorFamilies[a] || 0) >= 0.08 && (flavorFamilies[b] || 0) >= 0.08) complement += 2.5;
  });
  flavorBalance += Math.min(10, complement);
  flavorBalance = clamp(Math.round(flavorBalance), 0, 50);

  const presentTiers = [];
  const missingTiers = [];
  let pyramidCoverage = 0;
  PYRAMID_KEYS.forEach(key => {
    const share = pyramidTiers[key] || 0;
    const counts = key === 'fat' ? share >= TIER_PRESENT_PCT && share <= FAT_TIER_MAX_PCT : share >= TIER_PRESENT_PCT;
    if (counts) {
      presentTiers.push(key);
      pyramidCoverage += 8;
    } else {
      missingTiers.push(key);
    }
  });
  if (presentTiers.length === PYRAMID_KEYS.length) pyramidCoverage += 2;
  pyramidCoverage = clamp(Math.round(pyramidCoverage), 0, 50);

  const tags = Object.entries(tagWeights).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  const hints = [];
  if ((flavorFamilies.rich || 0) > 0.5) hints.push('Add a fruit or acid slot to balance richness.');
  if (missingTiers.length) hints.push(`Add a little ${missingTiers.slice(0, 2).map(t => pyramid()?.PYRAMID_CLASS?.[t]?.short || t).join(' or ')} for pyramid balance.`);
  if (famEntries.length <= 1) hints.push('Mix flavor families — umami, bright, herbal, or spicy accents help.');

  // Legible "more distinct ingredients = better" bonus, borrowed from the legacy
  // Food-tab dishQuality() (+5 per distinct ingredient, capped) — flavor/pyramid
  // coverage above already rewards variety *indirectly* (only when a new ingredient
  // happens to add a new flavor family or pyramid tier); this makes deliberately
  // elevating a dish (e.g. ramen with both Eggs AND Chashu) reliably rewarding too.
  const ingredientCount = entries.length;
  const elevationBonus = clamp((ingredientCount - 1) * 5, 0, 20);
  if (elevationBonus > 0) hints.unshift(`Elevated with ${ingredientCount} ingredients (+${elevationBonus}).`);
  const score = clamp(flavorBalance + pyramidCoverage + elevationBonus, 0, 100);
  return {
    score,
    stars: starsForScore(score),
    flavorBalance,
    pyramidCoverage,
    ingredientCount,
    elevationBonus,
    flavorFamilies,
    pyramidTiers,
    tags,
    missingTiers,
    presentTiers,
    hints
  };
}

function catalogIdForEatery(eateryType) {
  const r = getRestaurant(eateryType);
  if (r?.catalogId) return r.catalogId;
  const legacy = window.SnowpiercerLifeSim?.EATERIES?.[eateryType]?.legacy;
  return legacy?.[0] || null;
}

function load() {
  return fetch('data/restaurant-menus-v1.json?v=' + encodeURIComponent(String(META.version)))
    .then(r => (r.ok ? r.json() : null))
    .then(m => { if (m) apply(m); return m; })
    .catch(() => null);
}

window.SnowpiercerRestaurantMenus = {
  META,
  load,
  apply,
  get data() { return data; },
  getMenu,
  getDishFamily,
  getRestaurant,
  resolveDish,
  rateDishCombination,
  rateCombination: rateDishCombination,
  starsForScore,
  listSubstitutes,
  getMenuPlan,
  applyMenuPlan,
  persistState,
  catalogIdForEatery,
  defaultPicks,
  MAX_DISH_INGREDIENTS
};

load();
})();
