import { Global, Module } from '@nestjs/common';
import { CostSanityService } from './cost-sanity.service';

/**
 * "Are you sure this is the correct cost?" — available to every module that
 * saves a cost, a price or a recipe. Global because it depends only on Prisma
 * and is asked from inventory, procure, products and close-and-plan alike;
 * importing it into each would tie those modules together for no benefit.
 */
@Global()
@Module({
  providers: [CostSanityService],
  exports:   [CostSanityService],
})
export class SanityModule {}
