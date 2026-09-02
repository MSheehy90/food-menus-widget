// Snowpiercer food pyramid v1 — shared USDA-style tier lookup for menu rating + supply board.
(() => {
'use strict';

const PYRAMID_CLASS = {
  fat: { key: 'fat', label: 'Fats, Oils & Sweets', short: 'Fats', icon: '🧈' },
  dairy: { key: 'dairy', label: 'Milk, Yogurt & Cheese', short: 'Dairy', icon: '🥛' },
  protein: { key: 'protein', label: 'Meat, Poultry, Fish, Eggs, Nuts', short: 'Protein', icon: '🥩' },
  vegetables: { key: 'vegetables', label: 'Vegetables', short: 'Vegetables', icon: '🥬' },
  fruit: { key: 'fruit', label: 'Fruits', short: 'Fruit', icon: '🍎' },
  grains: { key: 'grains', label: 'Bread, Cereal, Rice & Pasta', short: 'Grains', icon: '🌾' }
};

const PYRAMID_KEYS = ['grains', 'vegetables', 'fruit', 'dairy', 'protein', 'fat'];

function foodTypeOf(name) {
  return window.SnowpiercerLifeSim?.foodTypeOf?.(name) || 'other';
}

function pyramidClassFromType(t) {
  if (t === 'grain') return 'grains';
  if (t === 'vegetable' || t === 'spice') return 'vegetables';
  if (t === 'fruit') return 'fruit';
  if (t === 'dairy') return 'dairy';
  if (t === 'protein') return 'protein';
  if (t === 'fat') return 'fat';
  return 'other';
}

function pyramidClassFromMaster(row) {
  const p = (row?.pyramid || row?.group || '').trim();
  if (/^grains?$/i.test(p)) return 'grains';
  if (/^fruit$/i.test(p)) return 'fruit';
  if (/^dairy$/i.test(p)) return 'dairy';
  if (/^protein/i.test(p) && !/vegetable/i.test(p)) return 'protein';
  if (/^fats/i.test(p)) return 'fat';
  if (/vegetable/i.test(p)) return 'vegetables';
  return pyramidClassFromType(foodTypeOf(row?.item || ''));
}

function masterRowFor(name) {
  const fm = window.SNOWPIERCER_FOOD_MASTER_V1;
  if (!fm?.byName) return null;
  if (fm.byName[name]) return fm.byName[name];
  const lower = String(name || '').toLowerCase();
  const hit = (fm.rows || []).find(r => String(r.item || '').toLowerCase() === lower);
  return hit || null;
}

function pyramidClassForItem(name) {
  const row = masterRowFor(name);
  if (row) return pyramidClassFromMaster(row);
  return pyramidClassFromType(foodTypeOf(name));
}

function flavorTagsForItem(name) {
  const row = masterRowFor(name);
  if (!row?.flavor) return [];
  return Array.isArray(row.flavor) ? row.flavor : String(row.flavor).split(',').map(s => s.trim()).filter(Boolean);
}

window.SnowpiercerFoodPyramid = {
  PYRAMID_CLASS,
  PYRAMID_KEYS,
  pyramidClassForItem,
  pyramidClassFromMaster,
  pyramidClassFromType,
  flavorTagsForItem,
  masterRowFor
};
})();
