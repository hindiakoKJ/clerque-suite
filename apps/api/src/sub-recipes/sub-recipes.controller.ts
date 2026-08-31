import {
  Controller, Get, Post, Put, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { SubRecipesService, MakeBatchDto, SubRecipeLineInput } from './sub-recipes.service';

@ApiTags('Sub-recipes')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory/sub-recipes')
export class SubRecipesController {
  constructor(private readonly subRecipes: SubRecipesService) {}

  /**
   * Everything the shop preps, with how much more each could make.
   *
   * Declared BEFORE the ':rawMaterialId' route so Nest does not match the
   * literal path segment as an id.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM',
         'WAREHOUSE_STAFF', 'FINANCE_LEAD')
  @Get()
  @ApiOperation({ summary: 'Every prepared ingredient, with batches still makeable' })
  list(@CurrentUser() user: JwtPayload, @Query('branchId') branchId?: string) {
    return this.subRecipes.list(user.tenantId!, branchId ?? user.branchId!);
  }

  /**
   * Reading a sub-recipe is as broad as reading any other ingredient — a
   * barista about to make a batch needs to see what goes in it.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM',
         'WAREHOUSE_STAFF', 'FINANCE_LEAD')
  @Get(':rawMaterialId')
  @ApiOperation({ summary: 'What one batch of this prepared ingredient is made from' })
  get(@CurrentUser() user: JwtPayload, @Param('rawMaterialId') id: string) {
    return this.subRecipes.get(user.tenantId!, id);
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
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF')
  @Post(':rawMaterialId/batches')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record that a batch was made: consume the inputs, add the yield' })
  makeBatch(
    @CurrentUser() user: JwtPayload,
    @Param('rawMaterialId') id: string,
    @Body() body: MakeBatchDto,
  ) {
    return this.subRecipes.makeBatch(
      user.tenantId!,
      id,
      { ...body, branchId: body.branchId ?? user.branchId! },
      user.sub,
    );
  }
}
