import { buildClassifierPrompt as buildV2Prompt } from './classifier.v2';
import type { SellerProfileInput, SourceId } from '@vantage/shared';

export function buildClassifierPrompt({
  seller,
  text,
  source,
}: {
  seller: SellerProfileInput;
  text: string;
  source: SourceId;
}): { system: string; prompt: string } {
  const prompt = buildV2Prompt({ seller, text });
  const sourceHint = source === 'github'
    ? '\nSource context: A GitHub issue or user story in a project’s own backlog that only describes a feature for that project is not buyer intent, unless the author is choosing, comparing, or replacing a tool.'
    : '';
  return { system: prompt.system, prompt: `${prompt.prompt}${sourceHint}` };
}
