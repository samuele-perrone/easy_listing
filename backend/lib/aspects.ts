import { generateText, Output } from 'ai';
import { z } from 'zod';
import { resolveModel } from '@/lib/model';

export interface CategoryAspect {
  name: string;
  /** When non-empty, eBay only accepts one of these values. */
  allowedValues: string[];
  selectionOnly: boolean;
}

const aspectAnswerSchema = z.object({
  aspects: z.array(
    z.object({
      name: z.string().describe('The aspect name, copied exactly'),
      value: z.string().describe('The best value for this item'),
    }),
  ),
});

/**
 * eBay categories require item specifics ("Type", "Brand", …) that vary per
 * category, so they can't be generated up front — the category isn't known
 * until listing time. Ask the model to fill them from the listing text.
 */
export async function chooseAspectValues(
  title: string,
  description: string,
  aspects: CategoryAspect[],
): Promise<Record<string, string[]>> {
  if (aspects.length === 0) return {};

  const spec = aspects
    .map((aspect) => {
      const options = aspect.allowedValues.length
        ? ` — choose one of: ${aspect.allowedValues.slice(0, 40).join(' | ')}`
        : ' — free text';
      return `- ${aspect.name}${options}`;
    })
    .join('\n');

  const { output } = await generateText({
    model: resolveModel(),
    system:
      'You fill in eBay item specifics for a listing. Answer only from what the title and ' +
      'description support. Where a list of allowed values is given you must copy one of them ' +
      'exactly. If the item genuinely does not say, choose the most likely value for this kind ' +
      'of product rather than leaving it blank — eBay rejects the listing without it.',
    output: Output.object({ schema: aspectAnswerSchema }),
    prompt: `Title: ${title}\n\nDescription: ${description}\n\nItem specifics to fill:\n${spec}`,
  });

  const result: Record<string, string[]> = {};
  for (const answer of output.aspects) {
    const aspect = aspects.find((a) => a.name.toLowerCase() === answer.name.toLowerCase());
    if (!aspect) continue;

    let value = answer.value.trim();
    if (aspect.selectionOnly && aspect.allowedValues.length) {
      const match = aspect.allowedValues.find((v) => v.toLowerCase() === value.toLowerCase());
      // A value outside the allowed list is rejected, so fall back to the first.
      value = match ?? aspect.allowedValues[0];
    }
    if (value) result[aspect.name] = [value];
  }
  return result;
}
