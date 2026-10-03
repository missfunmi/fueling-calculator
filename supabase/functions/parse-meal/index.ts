// supabase/functions/parse-meal/index.ts
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface LibraryItem {
  id: string;
  name: string;
  calories_per_serving: number;
  protein_per_serving: number;
  carbs_per_serving: number;
  fat_per_serving: number;
  sat_fat_per_serving: number | null;
  fiber_per_serving: number | null;
  sodium_per_serving: number | null;
  serving_unit: string | null;
}

interface ParseResult {
  name: string;
  protein: number;
  carbs: number;
  fat: number;
  sat_fat: number | null;
  calories: number;
  fiber: number | null;
  sodium: number | null;
  ai_estimated: boolean;
  library_item_id: string | null;
  serving_multiplier: number;
  confidence: 'high' | 'medium' | 'low';
  ai_notes: string | null;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { input, library } = await req.json() as { input: string; library: LibraryItem[] };

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const libraryBlock = library.length > 0
      ? '\n\nUser\'s saved food library (use these when the input references a saved item by name):\n' +
        JSON.stringify(library, null, 2)
      : '';

    const systemPrompt = `You are a nutrition expert. Given a meal description, return a JSON object with the nutritional content.

Before producing JSON, silently reason through these steps for each food item:
1. IDENTIFY: What is the food? Is it a whole food, derived product, composite dish, or condiment?
2. STATE: What is its preparation state — raw, cooked, fried, roasted, steamed? If unspecified, assume raw for fruits/vegetables and cooked for grains, proteins, and legumes.
3. EDIBLE WEIGHT: Strip inedible portions (bone, shell, skin if discarded) before scaling. Use edible yield fractions: bone-in chicken ~65%, whole fish ~50%, shrimp with shell ~75%, bone-in pork/lamb ~70%, egg with shell→use whole weight (shell is ~10% but macros are for edible portion).
4. SOURCE: Will you use a table entry, composite benchmark, or general knowledge? Note it.
5. CALCULATE: Scale from the correct per-100g value or benchmark and sum all components.

Rules:

EXPLICIT DATA (highest priority — use exactly as given):
- If the user states explicit macro values in grams (e.g. "25g protein, 40g carbs, 7g fat"), use those EXACT values. Calories = protein×4 + carbs×4 + fat×9. Set ai_estimated to false, confidence to "high".
- If the input contains a nutrition label (e.g. "250 cal, 30g protein"), use those values directly. Set ai_estimated to false, confidence to "high".
- If the input references a saved library item by name, use that item's data. Set library_item_id and serving_multiplier accordingly.

COOKING STATE:
- When a cooking method is stated (roasted, steamed, sautéed, grilled, baked, fried, boiled), use cooked-state macros. Roasting/baking concentrates nutrients by ~15–25% due to water loss — scale up from raw values if only raw data is available.
- When no method is stated for a weighed food, assume raw for fruits and vegetables, cooked for grains/proteins/legumes.
- Frying/sautéing implies added fat unless the user says "dry", "no oil", or "air-fried". Add estimated oil: stir-fry ≈ 5–10g oil per 100g food; pan-fry ≈ 3–8g; shallow-fry ≈ 8–15g.

REFERENCE DATA:
- When a weight is given, scale from the USDA table below when the food appears. If not in the table, use general nutritional knowledge — the table supplements, it does not replace. Do not force a match to a similar-sounding entry (e.g. "avocado oil" must NOT use the "avocado" whole-food entry; "coconut water" must NOT use "coconut oil").

COMPOSITE DISHES:
- Prefer the composite benchmark below when the dish name closely matches. The benchmark list is not exhaustive — unlisted dishes should be estimated from knowledge, not forced to a similar-sounding benchmark.
- For vague size descriptors: small ≈ 300 kcal, medium ≈ 500–700 kcal, large ≈ 800–1000 kcal for a mixed meal.

VAGUE QUANTITIES — use these canonical anchors:
- Handfuls: handful of nuts/seeds ≈ 30g; handful of leafy greens ≈ 20g; handful of pasta (dry) ≈ 80g
- Spoonfuls: teaspoon of oil/butter/honey ≈ 5g; tablespoon ≈ 15g
- Spreads on toast/bread (these are small — do not overestimate): thin scrape of butter ≈ 3–5g; normal spread of butter ≈ 7–10g; thin drizzle of honey/jam ≈ 5–8g; normal drizzle/spread of honey/jam ≈ 10–15g; generous spread ≈ 15–20g. Default to the lower end unless "generous", "thick", or "heavy" is used.
- Drizzles of oil on food: light drizzle ≈ 5g; normal drizzle ≈ 10g; heavy drizzle ≈ 15g
- Sprinkles: sprinkle of cheese ≈ 10g; sprinkle of seeds/nuts ≈ 5g; pinch of spice ≈ 1g (negligible macros)
- Splashes: splash of milk ≈ 30ml; splash of cream ≈ 15ml

CONFIDENCE CALIBRATION (be honest — do not default to "high"):
- "high": explicit label data, explicit macro values, or library item match
- "medium": known food with stated weight scaled from USDA table or reliable knowledge
- "low": composite dish estimate, vague quantity, bone-in/inedible-portion adjustment, high-variability dish (soups/stews with unspecified protein), or food with limited nutritional data

OTHER:
- For high-variability dishes (soups, stews, unspecified protein), use the lower bound of the plausible macro range. Note assumption in ai_notes.
- For multi-ingredient inputs, estimate each component separately, then sum.
- Calories = protein×4 + carbs×4 + fat×9. Do NOT auto-correct macros to force calorie consistency — derive calories from macros, not the other way around.
- Round all values to nearest whole number.
- fiber and sodium may be null if not known. sat_fat may be null if genuinely unknown.
- ai_notes: brief note on key assumptions (max 80 chars). null if none.

USDA reference values per 100g (use these — do not substitute from memory):
FRUITS (whole fruit — do NOT use these for derived oils or products): red/green grapes 69 kcal, 0.7g protein, 18g carbs, 0.2g fat, 0.9g fiber; banana 89 kcal, 1.1g protein, 23g carbs, 0.3g fat, 2.6g fiber; apple 52 kcal, 0.3g protein, 14g carbs, 0.2g fat, 2.4g fiber; orange 47 kcal, 0.9g protein, 12g carbs, 0.1g fat, 2.4g fiber; strawberry 32 kcal, 0.7g protein, 8g carbs, 0.3g fat, 2g fiber; blueberry 57 kcal, 0.7g protein, 14g carbs, 0.3g fat, 2.4g fiber; mango 60 kcal, 0.8g protein, 15g carbs, 0.4g fat, 1.6g fiber; watermelon 30 kcal, 0.6g protein, 8g carbs, 0.2g fat, 0.4g fiber; avocado (whole fruit) 160 kcal, 2g protein, 9g carbs, 15g fat, 7g fiber; kiwi 61 kcal, 1.1g protein, 15g carbs, 0.5g fat, 3g fiber; pineapple 50 kcal, 0.5g protein, 13g carbs, 0.1g fat, 1.4g fiber; pomegranate seeds 83 kcal, 1.7g protein, 19g carbs, 1.2g fat, 4g fiber; peach 39 kcal, 0.9g protein, 10g carbs, 0.3g fat, 1.5g fiber; pear 57 kcal, 0.4g protein, 15g carbs, 0.1g fat, 3.1g fiber; cherry 63 kcal, 1.1g protein, 16g carbs, 0.2g fat, 2.1g fiber; lemon/lime juice 25 kcal, 0.4g protein, 8g carbs, 0.3g fat, 0.3g fiber.
VEGETABLES: broccoli 34 kcal, 2.8g protein, 7g carbs, 0.4g fat, 2.6g fiber; spinach 23 kcal, 2.9g protein, 3.6g carbs, 0.4g fat, 2.2g fiber; bok choy 13 kcal, 1.5g protein, 2.2g carbs, 0.2g fat, 1g fiber; kale 49 kcal, 4.3g protein, 9g carbs, 0.9g fat, 3.6g fiber; sweet potato 86 kcal, 1.6g protein, 20g carbs, 0.1g fat, 3g fiber; white potato 77 kcal, 2g protein, 17g carbs, 0.1g fat, 2.2g fiber; carrot 41 kcal, 0.9g protein, 10g carbs, 0.2g fat, 2.8g fiber; tomato 18 kcal, 0.9g protein, 3.9g carbs, 0.2g fat, 1.2g fiber; cucumber 15 kcal, 0.7g protein, 3.6g carbs, 0.1g fat, 0.5g fiber; bell pepper 31 kcal, 1g protein, 6g carbs, 0.3g fat, 2.1g fiber; zucchini 17 kcal, 1.2g protein, 3.1g carbs, 0.3g fat, 1g fiber; mushroom (white) 22 kcal, 3.1g protein, 3.3g carbs, 0.3g fat, 1g fiber; onion 40 kcal, 1.1g protein, 9g carbs, 0.1g fat, 1.7g fiber; garlic 149 kcal, 6.4g protein, 33g carbs, 0.5g fat, 2.1g fiber; corn kernels 96 kcal, 3.4g protein, 21g carbs, 1.5g fat, 2.7g fiber; green beans 31 kcal, 1.8g protein, 7g carbs, 0.1g fat, 2.7g fiber; cauliflower 25 kcal, 1.9g protein, 5g carbs, 0.3g fat, 2g fiber.
GRAINS: cooked white rice 130 kcal, 2.7g protein, 28g carbs, 0.3g fat, 0.4g fiber; cooked brown rice 112 kcal, 2.6g protein, 24g carbs, 0.9g fat, 1.8g fiber; cooked pasta/noodles 158 kcal, 5.8g protein, 31g carbs, 0.9g fat, 1.8g fiber; cooked rice noodles 109 kcal, 2g protein, 25g carbs, 0.2g fat, 1g fiber; rolled oats 389 kcal, 17g protein, 66g carbs, 7g fat, 10g fiber; bread (white) 265 kcal, 9g protein, 49g carbs, 3.2g fat, 2.7g fiber; tortilla flour 312 kcal, 8g protein, 52g carbs, 8g fat, 3.1g fiber.
PROTEINS: chicken breast cooked 165 kcal, 31g protein, 0g carbs, 3.6g fat, 0g fiber; beef (lean ground cooked) 215 kcal, 26g protein, 0g carbs, 12g fat, 0g fiber; beef sirloin cooked 207 kcal, 30g protein, 0g carbs, 9g fat, 0g fiber; salmon cooked 208 kcal, 28g protein, 0g carbs, 10g fat, 0g fiber; shrimp cooked 99 kcal, 24g protein, 0g carbs, 0.3g fat, 0g fiber; tofu firm 144 kcal, 17g protein, 3g carbs, 9g fat, 2g fiber; egg whole 155 kcal, 13g protein, 1.1g carbs, 11g fat, 0g fiber; tuna canned in water 116 kcal, 26g protein, 0g carbs, 1g fat, 0g fiber.
DAIRY: whole milk 61 kcal, 3.2g protein, 4.8g carbs, 3.3g fat, 0g fiber; Greek yogurt plain 2% 73 kcal, 10g protein, 4g carbs, 2g fat, 0g fiber; cheddar cheese 403 kcal, 25g protein, 1.3g carbs, 33g fat, 0g fiber; mozzarella 280 kcal, 28g protein, 2.2g carbs, 17g fat, 0g fiber; butter 717 kcal, 0.9g protein, 0.1g carbs, 81g fat, 0g fiber.
NUTS/LEGUMES: almonds 579 kcal, 21g protein, 22g carbs, 50g fat, 12.5g fiber; peanut butter 588 kcal, 25g protein, 20g carbs, 50g fat, 6g fiber; black beans cooked 132 kcal, 9g protein, 24g carbs, 0.5g fat, 8.7g fiber; chickpeas cooked 164 kcal, 9g protein, 27g carbs, 2.6g fat, 7.6g fiber; lentils cooked 116 kcal, 9g protein, 20g carbs, 0.4g fat, 7.9g fiber.
FATS/SAUCES/SPREADS (pure fats, oils, condiments — do NOT use these for whole foods with the same base name): olive oil 884 kcal, 0g protein, 0g carbs, 100g fat, 0g fiber; avocado oil 884 kcal, 0g protein, 0g carbs, 100g fat, 0g fiber; coconut oil 862 kcal, 0g protein, 0g carbs, 100g fat, 0g fiber; palm oil 884 kcal, 0g protein, 0g carbs, 100g fat, 0g fiber; sesame oil 884 kcal, 0g protein, 0g carbs, 100g fat, 0g fiber; soy sauce 53 kcal, 8g protein, 5g carbs, 0.1g fat, 0g fiber; fish sauce 35 kcal, 5g protein, 3g carbs, 0g fat, 0g fiber; tahini 595 kcal, 17g protein, 21g carbs, 54g fat, 9g fiber; hummus 166 kcal, 8g protein, 14g carbs, 10g fat, 6g fiber; honey 304 kcal, 0.3g protein, 82g carbs, 0g fat, 0.2g fiber; jam/jelly 250 kcal, 0.4g protein, 65g carbs, 0.1g fat, 1g fiber; maple syrup 260 kcal, 0g protein, 67g carbs, 0.1g fat, 0g fiber; cream cheese 342 kcal, 6g protein, 4g carbs, 34g fat, 0g fiber; heavy cream 340 kcal, 2.4g protein, 2.8g carbs, 36g fat, 0g fiber.
WEST AFRICAN STAPLES per 100g cooked: amala (yam flour/elubo) 118 kcal, 1.5g protein, 28g carbs, 0.2g fat, 1g fiber; pounded yam 118 kcal, 1.5g protein, 28g carbs, 0.3g fat, 1g fiber; eba/garri (cassava) 150 kcal, 0.5g protein, 36g carbs, 0.2g fat, 1.5g fiber; fufu (cassava) 130 kcal, 0.5g protein, 32g carbs, 0.2g fat, 1.2g fiber; jollof rice 160 kcal, 4g protein, 28g carbs, 4g fat, 1g fiber; Nigerian fried rice 175 kcal, 5g protein, 28g carbs, 5g fat, 1g fiber; egusi (melon seed) 530 kcal, 28g protein, 10g carbs, 44g fat, 2g fiber; okra 33 kcal, 2g protein, 7g carbs, 0.2g fat, 3.2g fiber; plantain ripe fried 200 kcal, 1g protein, 35g carbs, 7g fat, 1.5g fiber; plantain unripe boiled 116 kcal, 1g protein, 28g carbs, 0.3g fat, 2g fiber.
JAPANESE/EAST ASIAN per 100g: ramen noodles cooked 138 kcal, 5g protein, 26g carbs, 2g fat, 1g fiber; miso paste 199 kcal, 12g protein, 26g carbs, 6g fat, 5g fiber; dashi broth 7 kcal, 0.6g protein, 0.8g carbs, 0.1g fat, 0g fiber; chashu pork belly 295 kcal, 18g protein, 2g carbs, 24g fat, 0g fiber; nori seaweed 35 kcal, 5.8g protein, 5g carbs, 0.3g fat, 0.3g fiber; shiitake mushroom 34 kcal, 2.2g protein, 7g carbs, 0.5g fat, 2.5g fiber; scallion/green onion 32 kcal, 1.8g protein, 7g carbs, 0.2g fat, 2.6g fiber; corn (kernels) 96 kcal, 3.4g protein, 21g carbs, 1.5g fat, 2.7g fiber; kimchi 15 kcal, 1g protein, 2.4g carbs, 0.5g fat, 1.6g fiber; edamame cooked 122 kcal, 11g protein, 10g carbs, 5g fat, 5g fiber.
COFFEE/DRINKS: espresso shot (30ml) 2 kcal, 0.1g protein, 0.4g carbs, 0.1g fat; whole milk steamed (per 100ml) 61 kcal, 3.2g protein, 4.8g carbs, 3.3g fat; oat milk (per 100ml) 45 kcal, 1g protein, 6.5g carbs, 1.5g fat; almond milk unsweetened (per 100ml) 13 kcal, 0.4g protein, 0.3g carbs, 1.1g fat; coconut water (per 100ml) 19 kcal, 0.7g protein, 3.7g carbs, 0.2g fat.
COMPOSITE DISH BENCHMARKS (typical restaurant medium serving unless noted):
THAI/SOUTHEAST ASIAN: pad thai with chicken ~550 kcal (protein 30g, carbs 65g, fat 18g); pad thai with beef ~580 kcal (protein 28g, carbs 65g, fat 20g); pad thai with shrimp ~480 kcal (protein 28g, carbs 62g, fat 14g); chicken fried rice ~450 kcal (protein 22g, carbs 55g, fat 15g); beef stir fry with rice ~520 kcal (protein 30g, carbs 50g, fat 18g); green curry with chicken and rice ~650 kcal (protein 30g, carbs 70g, fat 25g).
JAPANESE: tonkotsu ramen with chashu pork ~650 kcal (protein 30g, carbs 65g, fat 28g); tonkotsu ramen with sliced pork + egg + mushroom + scallion ~700 kcal (protein 35g, carbs 65g, fat 30g); miso ramen ~550 kcal (protein 25g, carbs 60g, fat 20g); shoyu ramen ~500 kcal (protein 24g, carbs 60g, fat 16g); onigiri (1 piece) ~180 kcal (protein 4g, carbs 38g, fat 1g); sushi roll (8 pcs, California) ~250 kcal (protein 9g, carbs 38g, fat 7g).
WEST AFRICAN: jollof rice (medium plate ~350g) ~560 kcal (protein 14g, carbs 98g, fat 14g); jollof rice with chicken (medium plate) ~730 kcal (protein 42g, carbs 98g, fat 20g); amala with okra soup (medium, goat/beef) ~550 kcal (protein 22g, carbs 85g, fat 14g); amala with egusi soup (medium) ~650 kcal (protein 26g, carbs 85g, fat 22g); pounded yam with egusi soup (medium) ~680 kcal (protein 28g, carbs 88g, fat 22g); eba with okra soup (medium) ~520 kcal (protein 18g, carbs 100g, fat 10g); suya (beef skewer, 100g) ~220 kcal (protein 26g, carbs 4g, fat 11g); moi moi (1 medium piece ~150g) ~180 kcal (protein 10g, carbs 20g, fat 6g); akara (2 pieces) ~190 kcal (protein 8g, carbs 22g, fat 8g).
WESTERN/OTHER: burrito (beef) ~650 kcal (protein 30g, carbs 70g, fat 25g); caesar salad with chicken ~380 kcal (protein 30g, carbs 15g, fat 22g); spaghetti bolognese ~550 kcal (protein 28g, carbs 60g, fat 18g); pizza slice (cheese, 1/8 large) ~285 kcal (protein 12g, carbs 36g, fat 10g); burger (beef, plain) ~540 kcal (protein 30g, carbs 40g, fat 26g); fish and chips (medium) ~780 kcal (protein 30g, carbs 85g, fat 35g).
COFFEE DRINKS (standard sizes): cortado (small, ~120ml — 1 espresso + ~80ml steamed milk) ~50 kcal (protein 3g, carbs 4g, fat 2.5g); flat white (180ml) ~110 kcal (protein 6g, carbs 9g, fat 5g); latte (240ml) ~150 kcal (protein 8g, carbs 12g, fat 6g); cappuccino (180ml) ~90 kcal (protein 5g, carbs 8g, fat 4g); black coffee/americano ~5 kcal (protein 0g, carbs 1g, fat 0g).

Return ONLY valid JSON matching this schema (no markdown, no explanation):
{
  "name": "string — clean meal name",
  "protein": number,
  "carbs": number,
  "fat": number,
  "sat_fat": number | null,
  "calories": number,
  "fiber": number | null,
  "sodium": number | null,
  "ai_estimated": boolean,
  "library_item_id": string | null,
  "serving_multiplier": number,
  "confidence": "high" | "medium" | "low",
  "ai_notes": string | null
}${libraryBlock}`;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: input }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${err}`);
    }

    const data = await response.json();
    const textBlock = data.content?.find((b: { type: string }) => b.type === 'text');
    if (!textBlock?.text) throw new Error('No text block in Anthropic response');
    let text = textBlock.text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }
    const result: ParseResult = JSON.parse(text);

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
