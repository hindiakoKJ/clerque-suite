import {
  Controller, Get, Post, Put, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { SubRecipesService, MakeBatchDto, SubRecipeLineInput } from './sub-recipes.service';
import {
  prepCostsVisibleTo, boardRowWithoutCost, recipeWithoutCosts, batchResultWithoutCosts,
} from './prep-costs';

@ApiTags('Sub-recipes')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory/sub-recipes')
export class SubRecipesController {
  constructor(
    private readonly subRecipes: SubRecipesService,
    // Only to read the owner's "show purchase costs to staff" switch.
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Costs come off the way out, for whoever the shop hides them from -- see
   * prep-costs.ts. The service underneath always works with the real figures.
   */
  private seesCosts(user: JwtPayload): Promise<boolean> {
    return prepCostsVisibleTo(this.prisma, user.tenantId!, user.role);
  }

  /**
   * Everything the shop preps, with how much more each could make.
   *
   * Declared BEFORE the ':rawMaterialId' route so Nest does not match the
   * literal path segment as an id.
   */
  // GENERAL_EMPLOYEE is the cook's account. Without it the prep board 403s for
  // the one person whose job it describes, and unrecorded prep means the
  // components never move, never trip a reorder level and never get bought.
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM',
         'WAREHOUSE_STAFF', 'FINANCE_LEAD', 'GENERAL_EMPLOYEE')
  @Get()
  @ApiOperation({ summary: 'Every prepared ingredient, with batches still makeable' })
  async list(@CurrentUser() user: JwtPayload, @Query('branchId') branchId?: string) {
    // The persona rides on the JWT already; a barista's board shows the bar's
    // preps and a cook's shows the kitchen's. Anyone without one sees all.
    const rows = await this.subRecipes.list(user.tenantId!, branchId ?? user.branchId!, user.personaKey);
    return (await this.seesCosts(user)) ? rows : rows.map(boardRowWithoutCost);
  }

  /**
   * The sauce rotation: ready to use, parked behind it, and what to do now.
   * The owner's card and the Share-to-GC message read this.
   *
   * Declared BEFORE ':rawMaterialId', or "rotation" is read as an id and 404s.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM',
         'WAREHOUSE_STAFF', 'FINANCE_LEAD', 'GENERAL_EMPLOYEE')
  @Get('rotation')
  @ApiOperation({ summary: 'Each ready-to-use prep, its parked backup, and what to do now' })
  rotation(@CurrentUser() user: JwtPayload, @Query('branchId') branchId?: string) {
    return this.subRecipes.rotation(user.tenantId!, branchId ?? user.branchId, user.personaKey);
  }

  /**
   * Reading a sub-recipe is as broad as reading any other ingredient — a
   * barista about to make a batch needs to see what goes in it.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM',
         'WAREHOUSE_STAFF', 'FINANCE_LEAD', 'GENERAL_EMPLOYEE')
  @Get(':rawMaterialId')
  @ApiOperation({ summary: 'What one batch of this prepared ingredient is made from' })
  async get(@CurrentUser() user: JwtPayload, @Param('rawMaterialId') id: string) {
    const recipe = await this.subRecipes.get(user.tenantId!, id);
    return (await this.seesCosts(user)) ? recipe : recipeWithoutCosts(recipe);
  }

  /** How many more batches the raw materials on hand could produce. */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM',
         'WAREHOUSE_STAFF', 'FINANCE_LEAD')
  @Get(':rawMaterialId/max-batches')
  @ApiOperation({ summary: 'Batches still makeable, and the ingredient limiting it' })
  maxBatches(
    @CurrentUser() user: JwtPayload,
    @Param('rawMaterialId') id: string,
    @Query('branchId') branchId: string,
  ) {
    return this.subRecipes.maxBatches(user.tenantId!, id, branchId ?? user.branchId!);
  }

  /**
   * Defining the recipe changes what every future batch consumes and what the
   * ingredient costs, so it sits with whoever owns the master data — not with
   * whoever is standing at the bar.
   */
  @Roles('BUSINESS_OWNER', 'MDM')
  @Put(':rawMaterialId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Define what one batch is made from, and what it yields' })
  setRecipe(
    @CurrentUser() user: JwtPayload,
    @Param('rawMaterialId') id: string,
    @Body() body: { batchYield: number; lines: SubRecipeLineInput[] },
  ) {
    return this.subRecipes.setRecipe(user.tenantId!, id, Number(body.batchYield), body.lines ?? []);
  }

  /**
   * Recording a batch is a floor action — the barista who made the syrup is
   * the one who knows it happened, and a shift that cannot record it is a
   * shift where the raw materials silently stop moving.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM',
         'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @Post(':rawMaterialId/batches')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record that a batch was made: consume the inputs, add the yield (measured, if the cook weighed it)' })
  async makeBatch(
    @CurrentUser() user: JwtPayload,
    @Param('rawMaterialId') id: string,
    @Body() body: MakeBatchDto,
  ) {
    // stationId rides along in `body` untouched -- it is validated against the
    // tenant in the service, so a forged id cannot attribute another shop's
    // station.
    const result = await this.subRecipes.makeBatch(
      user.tenantId!,
      id,
      { ...body, branchId: body.branchId ?? user.branchId! },
      user.sub,
      user.personaKey,
    );
    // The batch is recorded at its real cost either way; only the answer changes.
    return (await this.seesCosts(user)) ? result : batchResultWithoutCosts(result);
  }
}
