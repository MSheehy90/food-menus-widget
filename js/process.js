/* Process recipes for Create ingredient — defaults from process-catalog / snowpiercer-data-v3. */
(() => {
  'use strict';

  function slugId(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `item-${Date.now()}`;
  }

  function loadCatalog(raw) {
    const catalog = raw?.catalog || {};
    const byOutput = raw?.byOutput || {};
    const stations = Array.isArray(raw?.stations) && raw.stations.length
      ? raw.stations
      : [
          { id: 'mill', name: 'Mill', actionKind: 'industrial', glyph: 'gear' },
          { id: 'dehydrator', name: 'Dehydrator', actionKind: 'industrial', glyph: 'gear' },
          { id: 'oven', name: 'Oven', actionKind: 'cook', glyph: 'oven' }
        ];
    return { catalog, byOutput, stations, raw };
  }

  function stationMeta(stations, name) {
    if (!name) return null;
    const n = String(name).toLowerCase();
    return (stations || []).find((s) => s.name.toLowerCase() === n || s.id === n) || {
      id: slugId(name),
      name,
      actionKind: /oven|cook|bake|fry/i.test(name) ? 'cook' : 'industrial',
      glyph: /oven|cook|bake|fry/i.test(name) ? 'oven' : 'gear'
    };
  }

  /** Virtual station object — not a locker food ingredient. */
  function stationAsItem(stations, name) {
    const meta = stationMeta(stations, name);
    if (!meta) return null;
    return {
      id: `station:${meta.id}`,
      name: meta.name,
      art: '',
      isStation: true,
      glyph: meta.glyph || 'gear',
      actionKind: meta.actionKind,
      uiType: 'Station',
      uiFamily: meta.actionKind === 'cook' ? 'Oven' : 'Industrial'
    };
  }

  function primaryOutputs(proc) {
    const groups = proc.outputGroup || {};
    const outs = Object.keys(proc.outputs || {});
    const primary = outs.filter((n) => groups[n] === 'processed' || !groups[n]);
    return primary.length ? primary : outs.slice(0, 1);
  }

  function inputNames(proc) {
    return Object.keys(proc.batchInput || {});
  }

  function isStationName(name, stations) {
    if (!name) return false;
    if ((stations || []).some((s) => s.name.toLowerCase() === String(name).toLowerCase())) return true;
    return /dehydrator|oven|mill|press|smoker|^station$/i.test(String(name));
  }

  /** Ingredient slots from batchInput + station slot from proc.station (not food). */
  function requiredSlots(proc, stations) {
    const slots = inputNames(proc)
      .filter((name) => !isStationName(name, stations))
      .map((name) => ({
        name,
        qty: proc.batchInput[name],
        station: false,
        filledId: null
      }));
    if (proc.station) {
      const st = stationAsItem(stations, proc.station);
      slots.push({
        name: proc.station,
        qty: 1,
        station: true,
        filledId: st?.id || `station:${slugId(proc.station)}`,
        stationItem: st
      });
    }
    return slots;
  }

  /** Walk upstream ingredient names (no stations). */
  function upstreamChain(outputName, byOutput, catalog, depth = 0, seen = new Set()) {
    if (!outputName || depth > 6 || seen.has(outputName)) return [outputName].filter(Boolean);
    seen.add(outputName);
    const recipes = byOutput[outputName] || [];
    if (!recipes.length) return [outputName];
    const recipe = recipes[0];
    const proc = catalog[recipe.id];
    if (!proc) return [outputName];
    const inputs = inputNames(proc).filter((n) => !isStationName(n));
    const upstream = inputs[0];
    const head = upstreamChain(upstream, byOutput, catalog, depth + 1, seen);
    return [...head, outputName];
  }

  /**
   * Visual chain nodes: for stationed processes, show inputs → station → output.
   * Mix/form processes show the ingredient upstream chain only (no fake station).
   */
  function visualChain(outputName, proc, byOutput, catalog, stations) {
    if (proc?.station) {
      const inputs = inputNames(proc).filter((n) => !isStationName(n, stations));
      const nodes = [];
      if (inputs.length) {
        inputs.forEach((name) => nodes.push({ kind: 'ingredient', name }));
      } else {
        const up = upstreamChain(outputName, byOutput, catalog);
        if (up.length >= 2) nodes.push({ kind: 'ingredient', name: up[up.length - 2] });
      }
      nodes.push({ kind: 'station', station: stationAsItem(stations, proc.station) });
      nodes.push({ kind: 'ingredient', name: outputName });
      return nodes;
    }
    return upstreamChain(outputName, byOutput, catalog).map((name) => ({
      kind: 'ingredient',
      name
    }));
  }

  function shelfCompare(proc, resolveIng) {
    const sl = proc.shelfLife || null;
    if (!sl) {
      return {
        processDays: Number(proc.days) || 0,
        before: null,
        after: null
      };
    }
    const beforeIng = resolveIng?.(sl.beforeItem);
    const afterIng = resolveIng?.(sl.afterItem);
    return {
      processDays: Number(proc.days) || 0,
      before: {
        item: sl.beforeItem,
        days: beforeIng?.shelfDays ?? sl.beforeDays ?? null
      },
      after: {
        item: sl.afterItem,
        days: afterIng?.shelfDays ?? sl.afterDays ?? null
      },
      note: sl.note || ''
    };
  }

  function listProcessOptions(catalog, byOutput, { stationName = null } = {}) {
    const opts = [];
    Object.entries(catalog).forEach(([id, proc]) => {
      if (stationName && proc.station !== stationName) return;
      primaryOutputs(proc).forEach((out) => {
        opts.push({
          id,
          output: out,
          name: proc.name,
          days: proc.days,
          station: proc.station || null,
          actionKind: proc.actionKind || 'mix',
          hasShelf: Boolean(proc.shelfLife)
        });
      });
    });
    opts.sort((a, b) => a.output.localeCompare(b.output));
    return opts;
  }

  function draftOutputIngredient(proc, outputName, filledInputs, resolveIng) {
    const id = slugId(outputName);
    const starRoles = (proc.starRolesOut && proc.starRolesOut[outputName]) || [];
    const shelf = proc.shelfLife?.afterDays;
    const chainNames = [];
    filledInputs.forEach((slot) => {
      if (slot.station) return;
      const ing = slot.filledId ? resolveIng(slot.filledId) : null;
      if (ing?.chain?.length) chainNames.push(...ing.chain);
      else if (slot.name) chainNames.push(slot.name);
    });
    chainNames.push(outputName);
    const uniq = [];
    chainNames.forEach((n) => {
      if (!uniq.includes(n)) uniq.push(n);
    });
    const base = resolveIng(outputName);
    return {
      id: base?.id || id,
      name: outputName,
      uiType: base?.uiType || 'Carb',
      uiFamily: base?.uiFamily || 'Noodle',
      group: base?.group || base?.uiType || 'Carb',
      stage: 'processed',
      processed: true,
      chain: uniq,
      art: base?.art || '',
      artStatus: base?.art ? 'present' : 'MISSING',
      kcal: base?.kcal ?? null,
      servingQty: base?.servingQty ?? 1,
      servingUnit: base?.servingUnit || 'serving',
      hungerKey: base?.hungerKey || (starRoles.includes('dehydratedCarb') || starRoles.includes('freshCarb') ? 'carb' : null),
      flavorKey: base?.flavorKey || null,
      starRoles: starRoles.length ? starRoles : (base?.starRoles || []),
      shelfDays: shelf ?? base?.shelfDays ?? null,
      unlocked: true,
      updatedAt: new Date().toISOString()
    };
  }

  window.FoodMenusProcess = {
    loadCatalog,
    stationMeta,
    stationAsItem,
    primaryOutputs,
    inputNames,
    requiredSlots,
    upstreamChain,
    visualChain,
    shelfCompare,
    listProcessOptions,
    draftOutputIngredient,
    slugId,
    isStationName
  };
})();
