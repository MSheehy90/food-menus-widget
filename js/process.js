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
    return { catalog, byOutput, raw };
  }

  /** Primary output name for a process (skip byproducts/loss). */
  function primaryOutputs(proc) {
    const groups = proc.outputGroup || {};
    const outs = Object.keys(proc.outputs || {});
    const primary = outs.filter((n) => groups[n] === 'processed' || !groups[n]);
    return primary.length ? primary : outs.slice(0, 1);
  }

  function inputNames(proc) {
    return Object.keys(proc.batchInput || {});
  }

  function isStationName(name) {
    return /dehydrator|oven|mill|press|smoker|station/i.test(String(name || ''));
  }

  /** Build required slots for a process (ingredients + stations). */
  function requiredSlots(proc) {
    return inputNames(proc).map((name) => ({
      name,
      qty: proc.batchInput[name],
      station: Boolean(proc.station && name === proc.station) || isStationName(name),
      filledId: null
    }));
  }

  /** Walk upstream processes to paint a visual chain ending at outputName. */
  function upstreamChain(outputName, byOutput, catalog, depth = 0, seen = new Set()) {
    if (!outputName || depth > 6 || seen.has(outputName)) return [outputName].filter(Boolean);
    seen.add(outputName);
    const recipes = byOutput[outputName] || [];
    if (!recipes.length) return [outputName];
    const recipe = recipes[0];
    const proc = catalog[recipe.id];
    if (!proc) return [outputName];
    const inputs = inputNames(proc).filter((n) => !isStationName(n));
    // Prefer grain/flour style single upstream for milling; else list key dry inputs
    const upstream = inputs[0];
    const head = upstreamChain(upstream, byOutput, catalog, depth + 1, seen);
    return [...head, outputName];
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

  function findRecipesForOutput(outputName, byOutput) {
    return byOutput[outputName] || [];
  }

  function listProcessOptions(catalog, byOutput) {
    const opts = [];
    Object.entries(catalog).forEach(([id, proc]) => {
      primaryOutputs(proc).forEach((out) => {
        opts.push({
          id,
          output: out,
          name: proc.name,
          days: proc.days,
          station: proc.station || null,
          hasShelf: Boolean(proc.shelfLife)
        });
      });
    });
    opts.sort((a, b) => a.output.localeCompare(b.output));
    return opts;
  }

  /** Draft ingredient record produced by running a process. */
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
      process: Object.keys(proc).length ? undefined : undefined,
      unlocked: true,
      updatedAt: new Date().toISOString()
    };
  }

  window.FoodMenusProcess = {
    loadCatalog,
    primaryOutputs,
    inputNames,
    requiredSlots,
    upstreamChain,
    shelfCompare,
    findRecipesForOutput,
    listProcessOptions,
    draftOutputIngredient,
    slugId,
    isStationName
  };
})();
