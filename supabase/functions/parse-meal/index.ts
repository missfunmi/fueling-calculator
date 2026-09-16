// supabase/functions/parse-meal/index.ts
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface LibraryItem {
  id: string;
  name: string;
  calories_per_serving: number;
  protein_per_serving: number;
  carbs_per_serving: number;
  fat_per_serving: number;
  fiber_per_serving: number | null;
  sodium_per_serving: number | null;
  serving_unit: string | null;
}

interface ParseResult {
  name: string;
  protein: number;
  carbs: number;
  fat: number;
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

    const systemPrompt = `You are a nutrition expert. Given a meal description (free text, a nutrition label paste, or a reference to a saved library item), return a JSON object with the nutritional content.

Rules:
- If the input references a library item by name, use that item's data (adjusting for any serving fraction mentioned). Set library_item_id to the matching item's id and serving_multiplier to the fraction used (e.g. 0.75 for "¾").
- If the user explicitly states macro values in grams (e.g. "25g protein", "40g carbs", "7g fat"), use those EXACT values — do not modify, round differently, or substitute them. If calories are not stated, calculate them as (protein_g × 4 + carbs_g × 4 + fat_g × 9). Set ai_estimated to false and confidence to "high".
- If the input contains explicit nutrition label values (e.g. "250 cal, 30g protein"), use those values directly and set confidence to "high" and ai_estimated to false.
- Otherwise estimate based on typical nutritional data and set ai_estimated to true.
- Round all numbers to the nearest whole number.
- fiber and sodium may be null if not known.
- ai_notes: brief note on key assumptions made (max 80 chars). null if none.

Return ONLY valid JSON matching this schema (no markdown, no explanation):
{
  "name": "string — clean meal name",
  "protein": number,
  "carbs": number,
  "fat": number,
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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: input }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${err}`);
    }

    const data = await response.json();
    let text = data.content[0].text.trim();
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
