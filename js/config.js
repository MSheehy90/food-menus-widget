/* Public runtime config — no secrets. Set GOOGLE_OAUTH_CLIENT_ID when HTTPS + OAuth client exist. */
window.FOOD_MENUS_CONFIG = Object.freeze({
  /** Google Identity Services OAuth 2.0 Web client id. Leave empty until HTTPS deploy. */
  GOOGLE_OAUTH_CLIENT_ID: '',
  /** Bidirectional data-dump sheet (Ingredients / Dishes / Scoring rules / Assets). */
  SHEET_ID: '1GoFYXh1AMKguFIv6XuBwQ7sxFfwN9QWAyx3fn4akl-U',
  SHEET_URL: 'https://docs.google.com/spreadsheets/d/1GoFYXh1AMKguFIv6XuBwQ7sxFfwN9QWAyx3fn4akl-U/edit',
  /** Preferred tab titles — created on first authenticated write if missing. */
  TABS: Object.freeze({
    ingredients: 'Ingredients',
    dishes: 'Dishes',
    scoring: 'Scoring rules',
    assets: 'Assets',
    processes: 'Process chains'
  }),
  /** Legacy export tab name (still written as a convenience dump of kept dishes). */
  TRIMMED_TAB: 'Trimmed dishes',
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
  DISCOVERY_DOCS: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
  CACHE_KEY: 'food-menus-sot-v1',
  HTTPS_SIGNIN_MSG: 'Live two-way sync needs HTTPS + Google sign-in'
});
