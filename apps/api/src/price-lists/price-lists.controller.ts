import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import {
  PriceListsService,
  CreatePriceListDto,
  UpdatePriceListDto,
  UpsertPriceListItemDto,
} from './price-lists.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('price-lists')
export class PriceListsController {
  constructor(private priceLists: PriceListsService) {}

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.priceLists.list(user.tenantId!);
  }

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get(':id')
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.priceLists.getOne(user.tenantId!, id);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: CreatePriceListDto) {
    return this.priceLists.create(user.tenantId!, body);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: UpdatePriceListDto,
  ) {
    return this.priceLists.update(user.tenantId!, id, body);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post(':id/items')
  @HttpCode(HttpStatus.OK)
  setItems(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { items: UpsertPriceListItemDto[] },
  ) {
    return this.priceLists.setItems(user.tenantId!, id, body.items ?? []);
  }
}
