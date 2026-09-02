/* Compatibility layer: Save uses bidirectional SoT sync (FoodMenusSync).
   Empty GOOGLE_OAUTH_CLIENT_ID → JSON dump + local cache. No fake login. */
(() => {
  'use strict';

  const Sync = () => window.FoodMenusSync;

  function hasClientId() {
    return Sync().hasClientId();
  }

  /** Legacy dish export payload (kept for Download JSON on Kept view). */
  function buildPayload(dishes) {
    const store = Sync().loadCache();
    Sync().syncDishesFromKept(dishes, { dirty: true });
    const dump = Sync().buildDumpPayload(Sync().loadCache());
    return {
      ...dump,
      kind: 'snowpiercer-menu-author-export',
      dishes,
      legacyTrimmedTab: (window.FOOD_MENUS_CONFIG || {}).TRIMMED_TAB
    };
  }

  function downloadJson(payload) {
    Sync().downloadJson(payload);
  }

  async function saveToDrive(dishes, { onStatus } = {}) {
    if (dishes?.length) {
      Sync().syncDishesFromKept(dishes, { dirty: true });
    }
    const store = Sync().loadCache();
    if (!Object.keys(store.dishes).length && !Object.keys(store.ingredients).length) {
      throw new Error('Nothing to save yet — keep a plate or wait for catalog seed.');
    }
    return Sync().pushDirty({ onStatus });
  }

  window.FoodMenusDrive = {
    hasClientId,
    buildPayload,
    downloadJson,
    saveToDrive
  };
})();
