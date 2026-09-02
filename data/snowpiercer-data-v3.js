(() => {
'use strict';

// Scenario marker on the seed (Year 7 week-stock pantry). Saves persist in
// localStorage (`lfcs:snowpiercer:mobile:v3`); call SNOWPIERCER_CLEAR_PERSISTENCE
// only from the in-app reset control.
window.SNOWPIERCER_BOARD_VERSION = 'year7-weekstock-1';
function clearSnowpiercerPersistence(){
  try{
    const localKeys=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k&&k.startsWith('lfcs:snowpiercer'))localKeys.push(k);
    }
    localKeys.forEach(k=>localStorage.removeItem(k));
    const sessionKeys=[];
    for(let i=0;i<sessionStorage.length;i++){
      const k=sessionStorage.key(i);
      if(k&&(k.startsWith('lfcs:snowpiercer')||k.startsWith('snow:')))sessionKeys.push(k);
    }
    sessionKeys.forEach(k=>sessionStorage.removeItem(k));
  }catch(e){/* storage may be unavailable */}
}
window.SNOWPIERCER_CLEAR_PERSISTENCE=clearSnowpiercerPersistence;

/** Browser localStorage key for the live Snowpiercer save. */
const SNOW_SAVE_KEY='lfcs:snowpiercer:mobile:v3';

function isSnowQuotaError(e){
  if(!e)return false;
  const name=String(e.name||'');
  const code=Number(e.code||0);
  // DOMException: QuotaExceededError (Chrome 22, Firefox 1014) or message text.
  return name==='QuotaExceededError'||name==='NS_ERROR_DOM_QUOTA_REACHED'
    ||code===22||code===1014
    ||/quota/i.test(String(e.message||''));
}

/** Drop replay logs so a QuotaExceededError can recover. Does not touch herds/inventory. */
function pruneSnowSaveForQuota(st,level){
  if(!st||typeof st!=='object')return st;
  const soft=level<=1;
  const eventsKeep=soft?400:120;
  const deliveriesKeep=soft?400:100;
  const histKeep=soft?200:60;
  const reportsKeep=soft?120:40;
  const restKeep=soft?200:50;
  if(Array.isArray(st.events)&&st.events.length>eventsKeep)st.events=st.events.slice(-eventsKeep);
  if(Array.isArray(st.deliveries)&&st.deliveries.length>deliveriesKeep)st.deliveries=st.deliveries.slice(-deliveriesKeep);
  if(Array.isArray(st.restaurantHistory)&&st.restaurantHistory.length>restKeep){
    st.restaurantHistory=st.restaurantHistory.slice(-restKeep);
  }
  if(st.life&&typeof st.life==='object'){
    if(Array.isArray(st.life.history)&&st.life.history.length>histKeep){
      st.life.history=st.life.history.slice(-histKeep);
    }
    if(Array.isArray(st.life.dayReports)&&st.life.dayReports.length>reportsKeep){
      st.life.dayReports=st.life.dayReports.slice(-reportsKeep);
    }
    // Older dayReports keep summary fields only (consumed[] is the main bloat).
    if(!soft&&Array.isArray(st.life.dayReports)){
      st.life.dayReports=st.life.dayReports.map((r,i,arr)=>{
        if(!r||typeof r!=='object')return r;
        if(i>=arr.length-14)return r;
        return{
          absDay:r.absDay,needKcal:r.needKcal,servedKcal:r.servedKcal,fed:r.fed,
          reserveKcal:r.reserveKcal,reserveDays:r.reserveDays,
          diningKcal:r.diningKcal,diningServings:r.diningServings
        };
      });
    }
    if(st.life.calendar&&Array.isArray(st.life.calendar.history)&&st.life.calendar.history.length>40){
      st.life.calendar.history=st.life.calendar.history.slice(-40);
    }
  }
  return st;
}

function notifySnowSaveQuota(msg,fatal){
  try{
    if(!fatal&&window.__snowpiercerQuotaToastDismissed){
      try{console.warn('[Snowpiercer save]',msg);}catch(_e){}
      return;
    }
    let el=document.querySelector('#sp-save-quota-toast');
    if(!el&&document.body){
      el=document.createElement('div');
      el.id='sp-save-quota-toast';
      el.setAttribute('role','status');
      el.style.cssText='position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:9999;display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:12px;background:#3a1f1f;color:#ffe8e0;border:1px solid #c07060;font:700 13px/1.35 system-ui,sans-serif;box-shadow:0 8px 24px #0008';
      const text=document.createElement('div');
      text.className='sp-save-quota-text';
      text.style.cssText='flex:1 1 auto;min-width:0';
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='sp-save-quota-dismiss';
      btn.setAttribute('aria-label','Dismiss storage warning');
      btn.textContent='Dismiss';
      btn.style.cssText='flex:0 0 auto;margin:0;padding:6px 10px;border-radius:8px;border:1px solid #c07060;background:#5a2f2f;color:#ffe8e0;font:700 12px/1 system-ui,sans-serif;cursor:pointer';
      btn.addEventListener('click',(ev)=>{
        ev.preventDefault();
        window.__snowpiercerQuotaToastDismissed=true;
        clearTimeout(notifySnowSaveQuota._t);
        el.hidden=true;
        el.style.display='none';
      });
      el.appendChild(text);
      el.appendChild(btn);
      document.body.appendChild(el);
    }
    if(el){
      const textEl=el.querySelector('.sp-save-quota-text')||el;
      // Same warning already up — do not restart the auto-hide timer (day ticks would pin it forever).
      if(!el.hidden&&textEl.textContent===msg&&el.dataset.fatal===(fatal?'1':'0')){
        try{console.warn('[Snowpiercer save]',msg);}catch(_e){}
        return;
      }
      textEl.textContent=msg;
      el.dataset.fatal=fatal?'1':'0';
      el.hidden=false;
      el.style.display='flex';
      clearTimeout(notifySnowSaveQuota._t);
      if(!fatal)notifySnowSaveQuota._t=setTimeout(()=>{el.hidden=true;el.style.display='none';},8000);
    }
  }catch(_e){/* DOM may be unavailable during early boot */}
  try{console.warn('[Snowpiercer save]',msg);}catch(_e){}
}

/**
 * Write the Snowpiercer save. On QuotaExceededError, prune replay logs and retry.
 * Never throws. Returns {ok, pruned, fatal, degraded, bytes}.
 * `fatal` is only true for non-quota errors. Quota exhaustion degrades to
 * in-memory play so boot/UI can continue (mobile Safari ~5 MB origin caps).
 */
function writeSnowpiercerSave(st,opts={}){
  const key=opts.key||SNOW_SAVE_KEY;
  if(!st||typeof st!=='object')return{ok:false,pruned:false,fatal:true,degraded:false,bytes:0};
  st.version=3;
  if(opts.touchSavedAt!==false)st.savedAt=Date.now();
  const tryWrite=()=>{
    const raw=JSON.stringify(st);
    localStorage.setItem(key,raw);
    return raw.length;
  };
  const freeSatelliteKeys=()=>{
    try{
      const drop=[];
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);
        if(!k||k===key)continue;
        if(k.startsWith('lfcs:snowpiercer:')&&k!==key)drop.push(k);
      }
      drop.forEach(k=>localStorage.removeItem(k));
      return drop.length;
    }catch(_e){return 0;}
  };
  const freeOtherLfcsPressure=()=>{
    // Last-resort: drop Living Food / Phaser local caches so Snowpiercer can boot.
    // Does not touch unrelated origins; only this app's lfcs:* keys except the live save.
    try{
      const drop=[];
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);
        if(!k||k===key)continue;
        if(k.startsWith('lfcs:')||k.startsWith('did.')||k.startsWith('phaser')||k.startsWith('old-phaser'))drop.push(k);
      }
      drop.forEach(k=>localStorage.removeItem(k));
      return drop.length;
    }catch(_e){return 0;}
  };
  try{
    const bytes=tryWrite();
    return{ok:true,pruned:false,fatal:false,degraded:false,bytes};
  }catch(e){
    if(!isSnowQuotaError(e)){
      try{console.warn('[Snowpiercer save] write failed',e);}catch(_e){}
      return{ok:false,pruned:false,fatal:true,degraded:false,bytes:0,error:e};
    }
    pruneSnowSaveForQuota(st,1);
    try{
      const bytes=tryWrite();
      notifySnowSaveQuota('Browser storage was full — pruned old Snowpiercer day logs so progress could save.',false);
      return{ok:true,pruned:true,fatal:false,degraded:false,bytes};
    }catch(e2){
      if(!isSnowQuotaError(e2))return{ok:false,pruned:true,fatal:true,degraded:false,bytes:0,error:e2};
      pruneSnowSaveForQuota(st,2);
      freeSatelliteKeys();
      try{
        const bytes=tryWrite();
        notifySnowSaveQuota('Browser storage was full — heavily pruned Snowpiercer logs so progress could save.',false);
        return{ok:true,pruned:true,fatal:false,degraded:false,bytes};
      }catch(e3){
        if(!isSnowQuotaError(e3))return{ok:false,pruned:true,fatal:true,degraded:false,bytes:0,error:e3};
        // Remove the bloated on-disk save (it is what is filling the quota), free other lfcs pressure, retry.
        try{localStorage.removeItem(key);}catch(_e){}
        freeOtherLfcsPressure();
        try{
          const bytes=tryWrite();
          notifySnowSaveQuota('Browser storage was full — cleared old site caches and rewrote a pruned Snowpiercer save.',false);
          return{ok:true,pruned:true,fatal:false,degraded:false,bytes};
        }catch(e4){
          // Continue in-memory so the train can still open. Do not mark boot fatal.
          try{localStorage.removeItem(key);}catch(_e){}
          window.__snowpiercerQuotaDegraded=true;
          notifySnowSaveQuota('Browser storage is full — playing without saving. Clear site data for this site, then reload.',false);
          return{ok:false,pruned:true,fatal:false,degraded:true,bytes:0,error:e4};
        }
      }
    }
  }
}

/** Probe + free space so early module migrates do not crash boot with QuotaExceededError. */
function recoverBootQuota(){
  const freeKeys=(pred)=>{
    try{
      const drop=[];
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);
        if(k&&pred(k))drop.push(k);
      }
      drop.forEach(k=>localStorage.removeItem(k));
      return drop.length;
    }catch(_e){return 0;}
  };
  const probeOk=()=>{
    const probe='lfcs:snowpiercer:__quota_probe__';
    localStorage.setItem(probe,'1');
    localStorage.removeItem(probe);
  };
  try{
    probeOk();
    return{ok:true};
  }catch(e){
    if(!isSnowQuotaError(e))return{ok:false,error:e};
    // Drop satellite Snowpiercer keys first (grow view prefs, etc.).
    const freedSat=freeKeys(k=>k.startsWith('lfcs:snowpiercer:')&&k!==SNOW_SAVE_KEY);
    try{
      probeOk();
      return{ok:true,freed:freedSat};
    }catch(e2){
      // Still full — drop the bloated live save, then other lfcs/phaser caches.
      try{localStorage.removeItem(SNOW_SAVE_KEY);}catch(_e){}
      const freedMore=freeKeys(k=>k.startsWith('lfcs:')||k.startsWith('did.')||k.startsWith('phaser')||k.startsWith('old-phaser')||k.startsWith('menu-'));
      try{
        probeOk();
        window.__snowpiercerQuotaDegraded=true;
        notifySnowSaveQuota('Browser storage was full — cleared site caches so Snowpiercer can start. Use Reset train if saves still fail.',false);
        return{ok:true,freed:freedSat+freedMore,degraded:true};
      }catch(e3){
        window.__snowpiercerQuotaDegraded=true;
        notifySnowSaveQuota('Browser storage is full — playing without saving. Clear site data for this site, then reload.',false);
        return{ok:false,degraded:true,error:e3};
      }
    }
  }
}

window.SNOWPIERCER_SAVE_KEY=SNOW_SAVE_KEY;
window.SnowpiercerIsQuotaError=isSnowQuotaError;
window.SnowpiercerPruneSaveForQuota=pruneSnowSaveForQuota;
window.SnowpiercerWriteSave=writeSnowpiercerSave;
window.SnowpiercerRecoverBootQuota=recoverBootQuota;
recoverBootQuota();

const source = (label,url,note='') => ({label,url,note});
window.SNOWPIERCER_SEED_V3 = {
  version: 3,
  meta: {
    year: 7, day: 1, population: 3000, scenario: 'Snowpiercer',
    classes: { first: 300, second: 700, third: 1600, tail: 400 },
    // Canonical exterior 213.3×28.9×39 ft; simulation interior 207×25 ft (AGENTS.md / data-contract).
    usableCarLengthFt: 207, usableCarWidthFt: 25,
    train: {
      totalCars: 1001, carLengthFt: 213.3, carWidthFt: 28.9, exteriorHeightFt: 39,
      usableLengthFt: 207, usableWidthFt: 25,
      usableVerticalEnvelopeFt: 30, mechanicalStructureFt: 9,
      scaleStandard: 'concept-scale-2026-08-24'
    }
  },
  utilities: { waterScore: 100, powerScore: 100, wasteScore: 87.5, foodStockScore: 100 },
  workforce: { working: 2249, foodService: 115, chefSkill: 81.4 },
  grass: {
    carLengthFt: 213.3, carWidthFt: 28.9, levels: 12, patchAreaFt2: 1,
    freshLbPerPatch: 0.75, dryMatterFraction: 0.20, regrowthDays: 30,
    carsAllocated: 42, lowCowDmLb: 25, highCowDmLb: 40, lactatingCows: 23.4
  },
  livestock: {
    cattle: {
      label: 'Cattle', males: 4, females: 36, quality: 93, icon: '🐄',
      // Extension baselines for a ~1,100 lb animal (≈40% packaged retail of live;
      // bones ≈15% of a 62% hot carcass; hide ≈7% live; edible offal ≈3.5%; trim fat ≈10%).
      packagedMeatLb: 440, bonesLb: 102.3, hideLb: 77, offalLb: 38.5, fatLb: 110,
      defaultLiveLb: 1100, adultMaleMaxLb: 1300,
      // Extension planning values: loose-housing space, gestation, market maturity, annual calving.
      spaceFt2PerHead: 50, gestationDays: 283, matureDays: 730, rebreedDays: 365
    },
    pigs: { label: 'Pigs', males: 6, females: 54, quality: 70, icon: '🐖', packagedMeatLb: 90, bonesLb: 18, hideLb: 0, offalLb: 10, fatLb: 22, defaultLiveLb: 250,
      spaceFt2PerHead: 10, gestationDays: 114, matureDays: 180, rebreedDays: 165 },
    chickens: { label: 'Chickens', males: 40, females: 360, quality: 75, icon: '🐔', packagedMeatLb: 2.9, bonesLb: 0.7, hideLb: 0, offalLb: 0.3, fatLb: 0.25, feathersLb: 0.325, defaultLiveLb: 5,
      spaceFt2PerHead: 1.5, gestationDays: 21, matureDays: 140, rebreedDays: 1 },
    goats: { label: 'Goats', males: 4, females: 24, quality: 82, icon: '🐐', packagedMeatLb: 26.5, bonesLb: 9, hideLb: 5, offalLb: 4, fatLb: 3, defaultLiveLb: 70,
      spaceFt2PerHead: 15, gestationDays: 150, matureDays: 365, rebreedDays: 365 },
    sheep: { label: 'Sheep', males: 4, females: 26, quality: 86, icon: '🐑', packagedMeatLb: 30, bonesLb: 10, hideLb: 6, offalLb: 4, fatLb: 4, fleeceLb: 8, cleanWoolFraction: 0.57, defaultLiveLb: 110,
      spaceFt2PerHead: 16, gestationDays: 147, matureDays: 365, rebreedDays: 365 }
  },
  inventory: {
    raw: {
      'Wheat grain': { qty: 13.96, unit: 'kg', quality: 75 },
      'Paddy rice': { qty: 12.00, unit: 'kg', quality: 75 },
      'Potatoes': { qty: 45, unit: 'kg', quality: 75 },
      'Eggs': { qty: 196, unit: 'eggs', quality: 82 },
      'Cow milk': { qty: 44.23, unit: 'L', quality: 78 },
      'Soybeans': { qty: 8, unit: 'kg', quality: 78 },
      'Mung beans': { qty: 6, unit: 'kg', quality: 80 },
      'Basil': { qty: 4.37, unit: 'kg', quality: 80 },
      'Thai basil': { qty: 2.5, unit: 'kg', quality: 82 },
      'Cilantro': { qty: 2.5, unit: 'kg', quality: 82 },
      'Onion': { qty: 18, unit: 'kg', quality: 78 },
      'Scallion': { qty: 5, unit: 'kg', quality: 82 },
      'Ginger': { qty: 5, unit: 'kg', quality: 82 },
      'Garlic': { qty: 5, unit: 'kg', quality: 82 },
      'Lime': { qty: 10, unit: 'kg', quality: 82 },
      'Lemon': { qty: 10.96, unit: 'kg', quality: 80 },
      'Chile pepper': { qty: 4, unit: 'kg', quality: 80 },
      'Corn': { qty: 15, unit: 'kg', quality: 78 },
      'Tomatoes': { qty: 15, unit: 'kg', quality: 82 },
      'Cabbage': { qty: 18, unit: 'kg', quality: 78 },
      'Carrots': { qty: 14, unit: 'kg', quality: 78 },
      'Apples': { qty: 20, unit: 'kg', quality: 80 },
      'Mushrooms': { qty: 7, unit: 'kg', quality: 82 },
      'Star anise': { qty: 0.35, unit: 'kg', quality: 90 },
      'Coriander seed': { qty: 0.45, unit: 'kg', quality: 88 },
      'Fennel seed': { qty: 0.35, unit: 'kg', quality: 88 },
      'Cinnamon': { qty: 0.30, unit: 'kg', quality: 90 },
      'Cloves': { qty: 0.20, unit: 'kg', quality: 90 },
      'Seaweed': { qty: 4, unit: 'kg', quality: 85 },
      'Bamboo shoots': { qty: 5, unit: 'kg', quality: 80 },
      'Cocoa beans': { qty: 3, unit: 'kg', quality: 88 },
      'Salt': { qty: 11.24, unit: 'kg', quality: 90 },
      'Sugar': { qty: 6, unit: 'kg', quality: 82 },
      'Koji starter': { qty: 0.30, unit: 'kg', quality: 90 },
      'Kansui salts': { qty: 0.80, unit: 'kg', quality: 90 },
      'Fish sauce': { qty: 3, unit: 'L', quality: 85 },
      'Water': { qty: 25000, unit: 'L', quality: 95 }
    },
    processed: {
      'Milled rice': { qty: 6, unit: 'kg', quality: 78 },
      'Rice flour': { qty: 4, unit: 'kg', quality: 78 },
      'Wheat flour': { qty: 8, unit: 'kg', quality: 78 },
      'Rice noodles': { qty: 12, unit: 'kg', quality: 80 },
      'Ramen noodles': { qty: 10, unit: 'kg', quality: 80 },
      'Mung bean sprouts': { qty: 8, unit: 'kg', quality: 88 },
      'Rice koji': { qty: 2, unit: 'kg', quality: 88 },
      'Miso': { qty: 5, unit: 'kg', quality: 88 },
      'Soy sauce': { qty: 4, unit: 'L', quality: 88 },
      'Nori': { qty: 1.5, unit: 'kg', quality: 88 },
      'Menma': { qty: 2, unit: 'kg', quality: 82 },
      'Chocolate': { qty: 2, unit: 'kg', quality: 90 },
      'Beef broth': { qty: 10, unit: 'L', quality: 88 },
      'Chicken broth': { qty: 10, unit: 'L', quality: 82 },
      'Pork broth': { qty: 10, unit: 'L', quality: 78 },
      'Chashu': { qty: 0, unit: 'kg', quality: 0 }
    },
    meatCuts: {}, byproducts: {}, delivered: {}
  },
  allocations: {},
  processQueue: [],
  growPlans: {},
  deliveries: [], events: [], restaurantHistory: [],

  restaurantCatalog: {
    pho: {
      name: 'Pho Shop', icon: '🥣', classAccess: ['first','second','third'], qualityMin: 60,
      description: 'Rice noodles are mandatory. Broth must be beef or chicken. Brisket is an optional beef cut, not a requirement.',
      routes: [
        { id:'beef-pho', label:'Beef pho base', core:{'Rice noodles':0.18,'Beef broth':0.40,'Onion':0.025,'Scallion':0.010}, unit:'serving' },
        { id:'chicken-pho', label:'Chicken pho base', core:{'Rice noodles':0.18,'Chicken broth':0.40,'Onion':0.025,'Scallion':0.010}, unit:'serving' }
      ],
      extras: [
        {name:'Mung bean sprouts',perServing:0.025},{name:'Cilantro',perServing:0.005},{name:'Thai basil',perServing:0.005},
        {name:'Lime',perServing:0.030},{name:'Chile pepper',perServing:0.005},
        {name:'Beef brisket',perServing:0.090,optional:true},{name:'Beef round',perServing:0.090,optional:true},{name:'Beef flank',perServing:0.090,optional:true},{name:'Chicken breast',perServing:0.090,optional:true}
      ]
    },
    ramen: {
      name: 'Ramen Shop', icon: '🍥', classAccess: ['first','second','third'], qualityMin: 60,
      description: 'Fresh wheat noodles with either pork broth or a miso route. Egg, chashu, corn, sprouts, nori and menma are optional quality/variety additions.',
      routes: [
        { id:'pork-ramen', label:'Pork broth base', core:{'Ramen noodles':0.13,'Pork broth':0.35,'Scallion':0.010}, unit:'serving' },
        { id:'miso-ramen', label:'Miso base', core:{'Ramen noodles':0.13,'Miso':0.030,'Water':0.35,'Scallion':0.010}, unit:'serving' }
      ],
      extras: [
        {name:'Eggs',perServing:1},{name:'Chashu',perServing:0.080},{name:'Corn',perServing:0.040},{name:'Mung bean sprouts',perServing:0.025},
        {name:'Nori',perServing:0.004},{name:'Menma',perServing:0.025},{name:'Mushrooms',perServing:0.030},{name:'Soy sauce',perServing:0.010}
      ]
    },
    diner: {
      name: 'American Diner', icon: '🍳', classAccess: ['first','second','third'], qualityMin: 50,
      description: 'Flexible kitchen. It turns available proteins, starches/vegetables and sauces/garnishes into combinations instead of fixed named dishes.',
      combinationMenus: {
        entree: {
          label:'Entrée',
          slots:[
            {label:'main protein',choices:[['Beef tenderloin',0.12],['Beef ribeye',0.12],['Beef brisket',0.12],['Ground beef',0.12],['Pork loin/chops',0.12],['Pork belly',0.12],['Chicken breast',0.12],['Chicken thigh',0.12],['Eggs',2]]},
            {label:'carb or vegetable',choices:[['Potatoes',0.18],['Milled rice',0.15],['Wheat flour',0.07],['Corn',0.15],['Cabbage',0.16],['Carrots',0.14]]},
            {label:'fruit/veg/herb sauce',choices:[['Tomatoes',0.06],['Apples',0.06],['Mushrooms',0.06],['Basil',0.008],['Onion',0.05],['Lemon',0.03]]}
          ]
        },
        appetizer: {
          label:'Appetizer',
          slots:[
            {label:'base',choices:[['Potatoes',0.10],['Cabbage',0.10],['Carrots',0.10],['Corn',0.10],['Wheat flour',0.05]]},
            {label:'finish',choices:[['Tomatoes',0.035],['Basil',0.005],['Onion',0.035],['Mushrooms',0.035],['Cheese',0.025]]}
          ]
        },
        dessert: {
          label:'Dessert', alternatives:[
            {label:'fruit + flour',slots:[{label:'fruit',choices:[['Apples',0.12],['Lemon',0.04]]},{label:'flour',choices:[['Wheat flour',0.06],['Rice flour',0.06]]}]},
            {label:'chocolate + flour',slots:[{label:'chocolate',choices:[['Chocolate',0.045]]},{label:'flour',choices:[['Wheat flour',0.06],['Rice flour',0.06]]}]}
          ]
        }
      }
    },
    michelin: {
      name: 'Michelin Restaurant', icon: '⭐', classAccess: ['first'], qualityMin: 85,
      description: 'First Class only. Uses the same combination logic but every input must meet the high-quality threshold.',
      combinationMenus: {
        entree: {
          label:'Entrée',
          slots:[
            {label:'main protein',choices:[['Beef tenderloin',0.10],['Beef ribeye',0.10],['Beef strip',0.10],['Lamb loin',0.10],['Chicken breast',0.10]]},
            {label:'carb or vegetable',choices:[['Milled rice',0.12],['Potatoes',0.14],['Mushrooms',0.10],['Carrots',0.10],['Cabbage',0.10]]},
            {label:'fruit/veg/herb sauce',choices:[['Lime',0.025],['Lemon',0.025],['Basil',0.006],['Thai basil',0.006],['Tomatoes',0.045],['Apples',0.045]]}
          ]
        },
        appetizer: {
          label:'Appetizer', slots:[
            {label:'base',choices:[['Mushrooms',0.08],['Carrots',0.08],['Milled rice',0.08]]},
            {label:'finish',choices:[['Basil',0.004],['Lime',0.020],['Lemon',0.020],['Cilantro',0.004]]}
          ]
        },
        dessert: {
          label:'Dessert', alternatives:[
            {label:'fruit + flour',slots:[{label:'fruit',choices:[['Apples',0.10],['Lemon',0.035]]},{label:'flour',choices:[['Wheat flour',0.05],['Rice flour',0.05]]}]},
            {label:'chocolate + flour',slots:[{label:'chocolate',choices:[['Chocolate',0.04]]},{label:'flour',choices:[['Wheat flour',0.05],['Rice flour',0.05]]}]}
          ]
        }
      }
    }
  },

  processCatalog: {
    wheat_milling: {
      name:'Mill wheat → flour', days:0, batchInput:{'Wheat grain':1}, outputs:{'Wheat flour':0.72,'Wheat bran':0.28}, outputGroup:{'Wheat flour':'processed','Wheat bran':'byproducts'},
      evidence:'Published processing baseline', source:source('USDA ERS wheat data','https://www.ers.usda.gov/data-products/wheat-data/documentation','72% flour extraction rate used in ERS milling calculations.')
    },
    rice_milling: {
      name:'Mill paddy → edible rice', days:0, batchInput:{'Paddy rice':1}, outputs:{'Milled rice':0.68,'Rice hull/bran':0.32}, outputGroup:{'Milled rice':'processed','Rice hull/bran':'byproducts'},
      evidence:'Published processing baseline', source:source('IRRI Rice Knowledge Bank','https://www.knowledgebank.irri.org/step-by-step-production/postharvest/milling/producing-good-quality-milled-rice/milling-yields','Uses 68% conservative value within IRRI potential 68–72% range; modern multistage mills are typically 65–70%.')
    },
    milk_to_cheese: {
      name:'Cow milk → cheese + whey', days:1, batchInput:{'Cow milk':10}, outputs:{'Cheese':1.0,'Whey':9.0}, outputGroup:{'Cheese':'processed','Whey':'byproducts'},
      evidence:'House dairy mass balance', source:source('Simulation assumption','','~10% cheese solids from milk; remainder whey for feed or further processing.')
    },
    rice_flour: {
      name:'Grind rice → rice flour', days:0, batchInput:{'Milled rice':1}, outputs:{'Rice flour':0.98,'Rice grinding loss':0.02}, outputGroup:{'Rice flour':'processed','Rice grinding loss':'byproducts'},
      evidence:'Snowpiercer engineering assumption', source:source('Simulation assumption','','2% handling/grinding loss is explicit and editable in data; replace when a validated train mill spec exists.')
    },
    rice_noodles: {
      name:'Rice flour → fresh rice noodles', days:0, batchInput:{'Rice flour':0.80,'Water':0.21,'Salt':0.01}, outputs:{'Rice noodles':1.00,'Noodle process loss':0.02}, outputGroup:{'Rice noodles':'processed','Noodle process loss':'byproducts'},
      evidence:'Snowpiercer house BOM', source:source('House production standard','','Mass-balanced wet-noodle standard; ingredient identities are fixed, ratio remains an explicit simulation assumption.')
    },
    ramen_noodles: {
      name:'Wheat flour → fresh ramen noodles', days:0, batchInput:{'Wheat flour':0.75,'Water':0.25,'Salt':0.008,'Kansui salts':0.010}, outputs:{'Ramen noodles':1.00,'Noodle process loss':0.018}, outputGroup:{'Ramen noodles':'processed','Noodle process loss':'byproducts'},
      evidence:'Snowpiercer house BOM', source:source('House production standard','','Fresh alkaline wheat-noodle BOM. No mystery noodle units: flour, water, salt and kansui are all consumed.')
    },
    mung_sprouts: {
      name:'Mung beans → bean sprouts', days:5, batchInput:{'Mung beans':1,'Water':5}, outputs:{'Mung bean sprouts':6}, outputGroup:{'Mung bean sprouts':'processed'},
      evidence:'Published production baseline', source:source('Oregon State University Sprout Production','https://horticulture.oregonstate.edu/oregon-vegetables/sprout-production-0','Mung beans increase about six-fold and are ready in 4–5 days under proper conditions; model uses 5 days.')
    },
    rice_koji: {
      name:'Rice → rice koji', days:2, batchInput:{'Milled rice':1,'Koji starter':0.005,'Water':0.20}, outputs:{'Rice koji':1.18,'Koji process loss':0.025}, outputGroup:{'Rice koji':'processed','Koji process loss':'byproducts'},
      evidence:'Published process + house mass balance', source:source('Japan MAFF traditional miso','https://www.maff.go.jp/e/policies/market/dento_syoku/bunrui/syouyu-miso.html','MAFF establishes rice/barley/soy koji as the fermentation base; exact train batch hydration/loss is an explicit house assumption.')
    },
    miso: {
      name:'Soybeans + rice koji → miso', days:180, batchInput:{'Soybeans':0.45,'Rice koji':0.45,'Salt':0.10,'Water':0.05}, outputs:{'Miso':1.00,'Miso fermentation loss':0.05}, outputGroup:{'Miso':'processed','Miso fermentation loss':'byproducts'},
      evidence:'Published process + house ratio', source:source('Japan MAFF traditional miso','https://www.maff.go.jp/e/policies/market/dento_syoku/bunrui/syouyu-miso.html','MAFF: steamed soybeans + koji + salt; aging ranges from days to two years. Train standard uses 180 days and a visible 45/45/10 dry-input ratio.')
    },
    soy_sauce: {
      name:'Soybeans + wheat → soy sauce', days:240, batchInput:{'Soybeans':0.30,'Wheat grain':0.30,'Salt':0.18,'Water':0.50,'Koji starter':0.004}, outputs:{'Soy sauce':1.00,'Soy sauce press cake':0.284}, outputGroup:{'Soy sauce':'processed','Soy sauce press cake':'byproducts'},
      evidence:'Published process + house mass balance', source:source('Japan MAFF soy sauce','https://www.maff.go.jp/e/policies/market/dento_syoku/bunrui/syouyu-miso.html','Koikuchi uses equal soybean and wheat in koji and approximately 8 months fermentation/aging. Model uses 240 days.')
    },
    beef_broth: {
      name:'Cattle bones → beef pho broth', days:1, batchInput:{'Cattle bones':8.0,'Water':14,'Onion':1.0,'Ginger':0.25,'Star anise':0.04,'Coriander seed':0.03,'Fennel seed':0.03,'Cinnamon':0.03,'Cloves':0.01,'Fish sauce':0.25,'Sugar':0.10,'Salt':0.15}, outputs:{'Beef broth':10}, outputGroup:{'Beef broth':'processed'},
      evidence:'Snowpiercer house BOM', source:source('House pho stock standard','','All aromatics/spices are explicit; meat cuts such as brisket remain optional serving additions, not broth requirements.')
    },
    chicken_broth: {
      name:'Chicken bones → chicken pho broth', days:1, batchInput:{'Chickens bones':5.0,'Water':13,'Onion':0.8,'Ginger':0.20,'Star anise':0.025,'Coriander seed':0.02,'Fennel seed':0.02,'Cinnamon':0.02,'Cloves':0.008,'Fish sauce':0.20,'Sugar':0.08,'Salt':0.12}, outputs:{'Chicken broth':10}, outputGroup:{'Chicken broth':'processed'},
      evidence:'Snowpiercer house BOM', source:source('House pho stock standard','','Measured chicken-stock route with the same traceable aromatic chain.')
    },
    pork_broth: {
      name:'Pig bones → ramen pork broth', days:1, batchInput:{'Pigs bones':8.0,'Water':15,'Onion':0.70,'Ginger':0.20,'Garlic':0.20,'Scallion':0.20,'Salt':0.10}, outputs:{'Pork broth':10}, outputGroup:{'Pork broth':'processed'},
      evidence:'Snowpiercer house BOM', source:source('House ramen stock standard','','Measured pork-bone stock route; restaurant toppings are tracked separately.')
    },
    nori: {
      name:'Seaweed → nori', days:1, batchInput:{'Seaweed':1.0}, outputs:{'Nori':0.18,'Nori process water loss':0.82}, outputGroup:{'Nori':'processed','Nori process water loss':'byproducts'},
      evidence:'Snowpiercer engineering assumption', source:source('Simulation assumption','','Drying yield is explicit and should be replaced by measured seaweed moisture data for the selected cultivar.')
    },
    menma: {
      name:'Bamboo shoots → menma', days:14, batchInput:{'Bamboo shoots':1.0,'Salt':0.08,'Water':0.20}, outputs:{'Menma':0.95,'Menma fermentation loss':0.33}, outputGroup:{'Menma':'processed','Menma fermentation loss':'byproducts'},
      evidence:'Snowpiercer engineering assumption', source:source('Simulation assumption','','Fermentation duration and mass balance are visible assumptions pending a selected production method.')
    },
    chocolate: {
      name:'Cocoa beans → chocolate', days:1, batchInput:{'Cocoa beans':0.55,'Sugar':0.30,'Cow milk':0.15}, outputs:{'Chocolate':0.90,'Cocoa process loss':0.10}, outputGroup:{'Chocolate':'processed','Cocoa process loss':'byproducts'},
      evidence:'Snowpiercer house BOM', source:source('House chocolate standard','','Simple train formulation so dessert demand traces to cocoa, sugar and milk; not a universal chocolate formula.')
    },
    chashu: {
      name:'Pork belly → chashu', days:1, batchInput:{'Pork belly':1.0,'Soy sauce':0.12,'Sugar':0.06,'Ginger':0.02,'Garlic':0.01,'Water':0.20}, outputs:{'Chashu':0.90,'Chashu cooking loss':0.51}, outputGroup:{'Chashu':'processed','Chashu cooking loss':'byproducts'},
      evidence:'Snowpiercer house BOM', source:source('House ramen topping standard','','Traceable pork/soy/sugar/aromatic route; exact seasoning ratio is a house standard.')
    }
  },

  cropCatalog: {
    'Wheat grain': {
      crop:'Wheat', icon:'🌾', output:'Wheat grain', yieldKgM2Cycle:1.4, cycleDays:70, defaultTiers:1, maxTiers:8,
      method:'Hydroponic controlled environment', ppfd:1400, photoperiodHours:20, co2ppm:330, tempC:23,
      evidence:'Observed CEA', source:source('PNAS controlled-environment wheat study','https://pmc.ncbi.nlm.nih.gov/articles/PMC7430987/','Observed 14 t/ha (1.4 kg/m²) grain per 70-day harvest at 23°C, 20 h/day, 1,400 µmol/m²/s and 330 ppm CO₂.')
    },
    'Potatoes': {
      crop:'Potato', icon:'🥔', output:'Potatoes', yieldKgM2Cycle:7.0, cycleDays:112, defaultTiers:1, maxTiers:3,
      harvestStyle:'batch',
      method:'Nutrient film technique, controlled environment', ppfd:null, photoperiodHours:null, co2ppm:null, tempC:null,
      evidence:'Observed CEA (conservative tray result)', source:source('NASA NTRS potato NFT','https://ntrs.nasa.gov/search.jsp?R=20040112117','112-day NFT study; conservative two-plant-tray fresh yield is used as 7.0 kg/m²/cycle. User can override after selecting cultivar/configuration.')
    },
    'Paddy rice': {
      crop:'Rice', icon:'🌾', output:'Paddy rice', yieldKgM2Cycle:null, cycleDays:null, defaultTiers:2, maxTiers:8,
      method:'Controlled environment candidate', ppfd:1800, photoperiodHours:12, co2ppm:null, tempC:27,
      evidence:'Needs numeric calibration', source:source('USDA ARS / Agronomy Journal rice study','https://www.ars.usda.gov/research/publications/publication/?seqNo115=159305','Primary controlled-environment rice study confirms high harvest index and response through 1,800 µmol/m²/s, but this seed intentionally does not invent a kg/m² value from an abstract that does not report one.')
    },
    'Soybeans': {
      crop:'Soybean', icon:'🫘', output:'Soybeans', yieldKgM2Cycle:null, cycleDays:95, defaultTiers:2, maxTiers:6,
      method:'Hydroponic controlled environment', ppfd:null, photoperiodHours:null, co2ppm:1000, tempC:null,
      evidence:'Cycle observed; yield needs calibration', source:source('NASA Biomass Production Chamber','https://ntrs.nasa.gov/search.jsp?R=20040089951','NASA chamber grew soybean crops in 90–97 days. Seed uses 95 days but leaves kg/m² unset until a cultivar-specific yield value is sourced.')
    },
    'Mung beans': {
      crop:'Mung bean seed crop', icon:'🫘', output:'Mung beans', yieldKgM2Cycle:null, cycleDays:null, defaultTiers:2, maxTiers:6,
      method:'Crop production', evidence:'Needs numeric calibration', source:source('Calibration required','','Sprout conversion is verified; seed-crop area yield is intentionally not fabricated.')
    },
    'Basil': { crop:'Basil',icon:'🌿',output:'Basil',yieldKgM2Cycle:null,cycleDays:null,defaultTiers:6,maxTiers:12,harvestStyle:'continuous',method:'CEA herb rack',evidence:'Needs numeric calibration',source:source('Calibration required','','Enter/verify cultivar-specific fresh yield and cut interval before using for production.') },
    'Thai basil': { crop:'Thai basil',icon:'🌿',output:'Thai basil',yieldKgM2Cycle:null,cycleDays:null,defaultTiers:6,maxTiers:12,harvestStyle:'continuous',method:'CEA herb rack',evidence:'Needs numeric calibration',source:source('Calibration required','','Enter/verify cultivar-specific fresh yield and cut interval before using for production.') },
    'Cilantro': { crop:'Cilantro',icon:'🌿',output:'Cilantro',yieldKgM2Cycle:null,cycleDays:null,defaultTiers:6,maxTiers:12,harvestStyle:'continuous',method:'CEA herb rack',evidence:'Needs numeric calibration',source:source('Calibration required','','Enter/verify cultivar-specific fresh yield and harvest interval before using for production.') },
    'Onion': { crop:'Onion',icon:'🧅',output:'Onion',yieldKgM2Cycle:null,cycleDays:null,defaultTiers:2,maxTiers:4,method:'CEA root crop',evidence:'Needs numeric calibration',source:source('Calibration required','','No hidden rate: choose cultivar and production system before enabling.') },
    'Scallion': { crop:'Scallion',icon:'🌱',output:'Scallion',yieldKgM2Cycle:null,cycleDays:null,defaultTiers:6,maxTiers:10,harvestStyle:'continuous',method:'CEA allium rack',evidence:'Needs numeric calibration',source:source('Calibration required','','No hidden rate: choose cultivar and production system before enabling.') },
    'Ginger': { crop:'Ginger',icon:'🫚',output:'Ginger',yieldKgM2Cycle:null,cycleDays:null,defaultTiers:1,maxTiers:3,method:'CEA rhizome bed',evidence:'Needs numeric calibration',source:source('Calibration required','','No hidden rate: choose cultivar and production system before enabling.') },
    'Garlic': { crop:'Garlic',icon:'🧄',output:'Garlic',yieldKgM2Cycle:null,cycleDays:null,defaultTiers:2,maxTiers:4,method:'CEA allium bed',evidence:'Needs numeric calibration',source:source('Calibration required','','No hidden rate: choose cultivar and production system before enabling.') },
    'Tomatoes': { crop:'Tomato',icon:'🍅',output:'Tomatoes',yieldKgM2Cycle:null,cycleDays:null,defaultTiers:1,maxTiers:3,method:'CEA fruiting crop',evidence:'Needs numeric calibration',source:source('Calibration required','','No hidden rate: cultivar/light-specific yield must be verified.') },
    'Apples': { crop:'Apple',icon:'🍎',output:'Apples',yieldKgM2Cycle:null,cycleDays:null,defaultTiers:1,maxTiers:1,method:'Orchard car',evidence:'Needs numeric calibration',source:source('Calibration required','','Per-tree age, spacing and cultivar must be modeled before enabling apple production.') }
  },

  ingredientOrigins: {
    'Wheat flour':'wheat_milling','Milled rice':'rice_milling','Rice flour':'rice_flour','Rice noodles':'rice_noodles','Ramen noodles':'ramen_noodles',
    'Mung bean sprouts':'mung_sprouts','Rice koji':'rice_koji','Miso':'miso','Soy sauce':'soy_sauce','Beef broth':'beef_broth','Chicken broth':'chicken_broth','Pork broth':'pork_broth',
    'Nori':'nori','Menma':'menma','Chocolate':'chocolate','Chashu':'chashu','Cheese':'milk_to_cheese','Whey':'milk_to_cheese'
  }
};
})();