/* 5-star plated hero / HQ tile resolver for Food Menus PWA.
 * Only returns existing mapped assets — never invents art. */
(() => {
  'use strict';

  function loadArtMap(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      threshold: Number(raw.threshold) || 5,
      visualThreshold: Number(raw.visualThreshold != null ? raw.visualThreshold : raw.threshold) || 4.5,
      heroes: Array.isArray(raw.heroes) ? raw.heroes : [],
      tiles: Array.isArray(raw.tiles) ? raw.tiles : [],
      produce: Array.isArray(raw.produce) ? raw.produce : [],
      byRestaurant: raw.byRestaurant && typeof raw.byRestaurant === 'object' ? raw.byRestaurant : {},
      byStyle: raw.byStyle && typeof raw.byStyle === 'object' ? raw.byStyle : {}
    };
  }

  function isFiveStarQuality(starsTotal, artMap) {
    const t = artMap?.visualThreshold ?? artMap?.threshold ?? 5;
    return Number(starsTotal) >= t;
  }

  function norm(s) {
    return String(s || '').toLowerCase().trim();
  }

  function haystack(ctx) {
    const names = (ctx.ingredients || []).map((i) => i?.name || '').join(' ');
    return norm(`${ctx.dishName || ctx.name || ''} ${names} ${ctx.restaurantName || ctx.restaurant || ''}`);
  }

  function pushUnique(list, seen, cand) {
    const file = String(cand?.file || '').trim();
    if (!file || seen.has(file)) return;
    seen.add(file);
    list.push({ ...cand, file });
  }

  /**
   * Rank existing cooked-dish assets for this plate.
   * Heroes (keyword match) first, then restaurant / style tiles, then named dish PNGs.
   * Does not invent paths — only uses five-star-art.json + optional namedDishArts.
   */
  function resolveCandidates(ctx, artMap, extra = {}) {
    const map = artMap || {};
    const quality = isFiveStarQuality(ctx?.starsTotal, map);
    const candidates = [];
    const seen = new Set();
    const hay = haystack(ctx || {});

    (map.heroes || []).forEach((h) => {
      const keys = h.match || [];
      const hit = keys.some((m) => m && hay.includes(norm(m)));
      const restHit = h.restaurant && norm(ctx?.restaurantName || ctx?.restaurant) === norm(h.restaurant)
        && keys.some((m) => m && hay.includes(norm(m)));
      if (hit || restHit) {
        pushUnique(candidates, seen, { file: h.file, id: h.id, kind: 'hero' });
      }
    });

    // Named dish / hq art Melinda already assigned (assets/dishes/… only)
    (extra.namedDishArts || []).forEach((row) => {
      const file = row?.file || row?.art || '';
      if (!file || !/\/dishes\//.test(file)) return;
      const label = norm(row.name || row.id || '');
      const dish = norm(ctx?.dishName || ctx?.name || '');
      if (label && dish && (dish.includes(label) || label.includes(dish) || hay.includes(label))) {
        pushUnique(candidates, seen, { file, id: row.id || label, kind: 'named' });
      }
    });

    const rid = norm(ctx?.restaurantId || '').replace(/\s+/g, '');
    if (rid && map.byRestaurant?.[rid]) {
      pushUnique(candidates, seen, { file: map.byRestaurant[rid], kind: 'restaurant', id: rid });
    }
    // Also try restaurant display-name slug keys
    const rname = norm(ctx?.restaurantName || ctx?.restaurant).replace(/\s+/g, '');
    if (rname && map.byRestaurant?.[rname]) {
      pushUnique(candidates, seen, { file: map.byRestaurant[rname], kind: 'restaurant', id: rname });
    }

    const style = norm(ctx?.style);
    if (style && style !== 'general' && map.byStyle?.[style]) {
      pushUnique(candidates, seen, { file: map.byStyle[style], kind: 'style', id: style });
    }

    return {
      quality,
      cue: quality ? '5-star quality' : '',
      candidates
    };
  }

  function probe(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(false);
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }

  async function pickLoadable(candidates) {
    for (const cand of candidates || []) {
      if (cand?.file && await probe(cand.file)) return cand;
    }
    return null;
  }

  window.FoodMenusFiveStar = {
    loadArtMap,
    isFiveStarQuality,
    resolveCandidates,
    pickLoadable
  };
})();
