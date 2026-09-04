# Food Master → locker filter tags

The widget Pulls the [Snowpiercer Food Master](https://docs.google.com/spreadsheets/d/1ShKoeUKdthTgd6Y2zmAyNkUiv0wpkqmOyaZ1D_TX7DQ/edit) sheet and merges useful columns onto locker ingredients.

## Columns already used

| Sheet header (aliases OK) | Catalog field | Shown / used |
| --- | --- | --- |
| Item, Stage, Group, Category, Type, Serving State | existing | Kind + Type/Family |
| Calories / kcal | `kcal` | Details |
| Difficulty / Rarity | `difficultyRarity` | Details (Rarity) |
| Flavor | `flavor[]` | Details chips + filter seeds |
| Serving Qty, Serving Unit | `servingQty`, `servingUnit` | Details |
| Shelf Life, Storage Form, Shelf Stable | same | Merged when present |
| Train Fit, Biome | same | Merged when present |
| **Tags** or **Filter Tags** | `filterTags` / `tags` | Locker filter chips |

## Optional `Tags` / `Filter Tags` column

Add a column headed **`Tags`** or **`Filter Tags`** on the Food Master tab.

- Comma-separated values, e.g. `Seasoning, Aromatic, Umami, Salty`
- These become locker filter chips (with **All**) alongside Type / Kind / form filters
- Live Pull reads this column when present (range `A1:CZ`)
- Does not invent new Item rows — only tags existing foods

### Suggested tag vocabulary (tare-aligned)

Functional:

- `Seasoning` — spices, herbs, salt, miso, soy sauce, etc.
- `Aromatic` — herbs/spices and anything with aromatic in Flavor

Flavor profiles (from Flavor column or Tags):

- `Salty`, `Soy`, `Umami`, `Fermented`, `Miso`, `Chili`, `Sesame`

You can add other comma tags; chips appear for any tag present on at least one item after Pull.

## Offline bake (`food-master-v2.json`)

When Tags is empty, baked rows seed `tags` from:

1. Flavor tokens in the tare/aromatic set above
2. Category heuristics: Spice / Herb → `Seasoning` + `Aromatic`; Seasoning → `Seasoning`
3. Known tare items already on the sheet: Miso, Soy Sauce, Fish Sauce, Salt

Fill the Drive **Tags** column when you want explicit control; Pull merges Tags + Flavor + heuristics without inventing items.
