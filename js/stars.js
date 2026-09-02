/* Melinda dish meters: Stars (quality), Hunger fill, Flavor → happiness/health.
   Do not collapse hunger or flavor into stars. */
(() => {
  'use strict';

  function roundQuarter(n) {
    return Math.round(Number(n || 0) * 4) / 4;
  }

  function formatStars(value) {
    const v = roundQuarter(value);
    if (Number.isInteger(v)) return String(v);
    return String(v);
  }

  /**
   * Quarter-star renderer.
   * ★ full, ◖ three-quarter (approx), ⯨ half, ◕ quarter, ☆ empty gutter optional.
   */
  function compactStars(value) {
    const v = roundQuarter(value);
    if (v <= 0) return '☆';
    let full = Math.floor(v);
    const frac = roundQuarter(v - full);
    let out = '★'.repeat(full);
    if (frac === 0.75) out += '◕';
    else if (frac === 0.5) out += '⯨';
    else if (frac === 0.25) out += '◔';
    return out || '☆';
  }

  function scoreStars(ingredients, starTable) {
    const table = starTable || {};
    const parts = [];
    let total = 0;
    (ingredients || []).forEach((ing) => {
      (ing.starRoles || []).forEach((role) => {
        const def = table[role];
        if (!def) return;
        const stars = Number(def.stars) || 0;
        total += stars;
        parts.push({
          kind: 'star',
          ingredient: ing,
          role,
          value: stars,
          label: def.label || role
        });
      });
    });
    total = roundQuarter(total);
    return { total, parts, display: compactStars(total), label: formatStars(total) };
  }

  function scoreHunger(ingredients, hungerTable) {
    const table = hungerTable || {};
    const parts = [];
    let typeFill = 0;
    let kcal = 0;
    (ingredients || []).forEach((ing) => {
      const key = ing.hungerKey || 'other';
      const def = table[key] || table.other || { fill: 0, label: key };
      const fill = Number(def.fill) || 0;
      const ingKcal = Number(ing.kcal);
      if (Number.isFinite(ingKcal) && ingKcal > 0) kcal += ingKcal;
      if (fill > 0) {
        typeFill += fill;
        parts.push({
          kind: 'hunger',
          ingredient: ing,
          role: key,
          value: fill,
          label: def.label || key,
          kcal: Number.isFinite(ingKcal) ? ingKcal : 0
        });
      } else if (Number.isFinite(ingKcal) && ingKcal > 0) {
        parts.push({
          kind: 'hunger',
          ingredient: ing,
          role: 'kcal',
          value: 0,
          label: `${ingKcal} kcal`,
          kcal: ingKcal
        });
      }
    });
    // Food Master kcal feeds hunger alongside type fills (protein/carbs still fill more).
    // 500 kcal ≈ one hunger unit (same scale as protein/carb fill of 1.0).
    const kcalFill = Math.round((kcal / 500) * 100) / 100;
    const total = Math.round((typeFill + kcalFill) * 100) / 100;
    // Cap display: ~4.0 combined ≈ full bar (type fills + kcal boost).
    const pct = Math.max(0, Math.min(100, Math.round((total / 4) * 100)));
    return {
      total,
      pct,
      typeFill,
      kcalFill,
      kcal: Math.round(kcal),
      parts,
      label: `${pct}%`,
      kcalLabel: `${Math.round(kcal)} kcal`
    };
  }

  function scoreFlavor(ingredients, flavorTable, outcomes) {
    const table = flavorTable || {};
    const parts = [];
    let total = 0;
    (ingredients || []).forEach((ing) => {
      const key = ing.flavorKey || 'other';
      const def = table[key] || table.other || { fill: 0, label: key };
      const fill = Number(def.fill) || 0;
      if (fill <= 0) return;
      total += fill;
      parts.push({
        kind: 'flavor',
        ingredient: ing,
        role: key,
        value: fill,
        label: def.label || key
      });
    });
    total = Math.round(total * 100) / 100;
    const pct = Math.max(0, Math.min(100, Math.round((total / 2) * 100)));
    const happyPer = Number(outcomes?.happinessPerFlavor ?? 1);
    const healthPer = Number(outcomes?.healthPerFlavor ?? 0.8);
    const happiness = Math.round(total * happyPer * 10) / 10;
    const health = Math.round(total * healthPer * 10) / 10;
    return {
      total,
      pct,
      happiness,
      health,
      parts,
      label: `${pct}%`,
      outcomeLabel: `☺ ${happiness} · ❤ ${health}`
    };
  }

  function scoreDish(ingredients, catalog) {
    const stars = scoreStars(ingredients, catalog?.starTable);
    const hunger = scoreHunger(ingredients, catalog?.meterTables?.hunger);
    const flavor = scoreFlavor(
      ingredients,
      catalog?.meterTables?.flavor,
      catalog?.flavorOutcomes
    );
    return { stars, hunger, flavor };
  }

  function detectStyle(ingredientNames) {
    const lower = (ingredientNames || []).map((n) => String(n).toLowerCase());
    const has = (n) => lower.includes(String(n).toLowerCase());
    const hasRamen = has('ramen noodles');
    const hasRice = has('rice noodles');
    const hasPasta = has('pasta noodles');
    if (hasRamen && (hasRice || hasPasta)) {
      return { ok: false, style: null, reason: 'Ramen noodles cannot mix with rice noodles or pasta.' };
    }
    if (hasRice && (hasRamen || hasPasta)) {
      return { ok: false, style: null, reason: 'Rice noodles cannot mix with ramen noodles or pasta.' };
    }
    if (hasPasta && (hasRamen || hasRice)) {
      return { ok: false, style: null, reason: 'Pasta cannot mix with ramen or rice noodles.' };
    }
    if (hasRamen) return { ok: true, style: 'ramen', reason: null };
    if (hasRice) return { ok: true, style: 'pho', reason: null };
    if (hasPasta) return { ok: true, style: 'pasta', reason: null };
    return { ok: true, style: 'general', reason: null };
  }

  function isCarb(ing, catalog) {
    const fams = catalog?.carbFamilies || [];
    return ing.uiType === 'Carb' || fams.includes(ing.uiFamily);
  }

  function isProtein(ing, catalog) {
    const fams = catalog?.proteinFamilies || [];
    return ing.uiType === 'Protein' || fams.includes(ing.uiFamily);
  }

  function coreReady(selected, catalog) {
    const carbs = selected.filter((i) => isCarb(i, catalog));
    const proteins = selected.filter((i) => isProtein(i, catalog));
    return { ok: carbs.length >= 1 && proteins.length >= 1, carbs, proteins };
  }

  function autoName(selected, style, restaurantName) {
    const list = selected || [];
    if (!list.length) return '';
    const styleLabel = {
      ramen: 'Ramen',
      pho: 'Pho',
      pasta: 'Pasta',
      general: restaurantName || 'Plate'
    }[style || 'general'];

    const protein = list.find((i) => i.uiType === 'Protein');
    const carb = list.find((i) => i.uiType === 'Carb');
    const garnish = list.filter((i) =>
      i.uiType === 'Vegetable' || i.uiType === 'Spice' || i.uiFamily === 'Herb' || i.uiFamily === 'Allium'
    );

    // Prefer tasty working names: "Scallion Onion Noodles", "Chashu Ramen"
    if (carb && /noodle/i.test(carb.name)) {
      const bits = [];
      if (protein) bits.push(protein.name.replace(/\s+noodles?$/i, ''));
      garnish.slice(0, 2).forEach((g) => bits.push(g.name));
      if (!bits.length) bits.push(carb.name.replace(/\s+noodles?$/i, '').trim() || 'Noodle');
      const base = style === 'ramen' ? 'Ramen' : style === 'pho' ? 'Pho' : 'Noodles';
      // If we already named a protein/garnish set, append Noodles/Ramen/Pho
      if (protein && style !== 'general') return `${protein.name} ${styleLabel}`.replace(/\s+/g, ' ').trim();
      if (garnish.length) {
        const head = garnish.slice(0, 2).map((g) => g.name.split(/\s+/)[0]).join(' ');
        return `${head} ${base}`;
      }
      return `${carb.name}`;
    }

    if (protein && carb) return `${protein.name} ${styleLabel}`;
    if (protein && restaurantName) return `${protein.name} · ${restaurantName}`;
    if (carb) return `${carb.name}${styleLabel && styleLabel !== 'Plate' ? ` ${styleLabel}` : ''}`;
    if (garnish.length >= 2) return `${garnish[0].name.split(/\s+/)[0]} ${garnish[1].name}`;
    return list.map((i) => i.name.split(/\s+/)[0]).slice(0, 3).join(' ');
  }

  /** Restaurant exclusivity from noodle bases (Melinda lock). */
  function restaurantLock(ingredientNames) {
    const lower = (ingredientNames || []).map((n) => String(n).toLowerCase());
    const has = (n) => lower.includes(String(n).toLowerCase());
    if (has('ramen noodles')) return { id: 'ramen', name: 'Ramen Shop', only: true };
    if (has('rice noodles')) return { id: 'pho', name: 'Pho Shop', only: true };
    return null;
  }

  window.MenuStars = {
    roundQuarter,
    formatStars,
    compactStars,
    scoreStars,
    scoreHunger,
    scoreFlavor,
    scoreDish,
    detectStyle,
    isCarb,
    isProtein,
    coreReady,
    autoName,
    restaurantLock
  };
})();
