import { SellerProfileInputSchema } from '../../../../packages/shared/src/schemas';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEMO_RUN_PARAMS = {
  keywords: ['zendesk alternative', 'helpdesk software'],
  sinceDays: 90,
  maxResults: 50,
};

export function loadDemoSeller() {
  const sellerPath = fileURLToPath(new URL('../../../../fixtures/seller-helpdesk.json', import.meta.url));
  const sellerJson = readFileSync(sellerPath, 'utf8');
  const seller = JSON.parse(sellerJson);
  return SellerProfileInputSchema.parse(seller);
}