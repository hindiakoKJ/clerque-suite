import {
  BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { STATION_ROLES, stationContext, type StationCaller } from '../kds/station-access';
import {
  EXTRA_UNITS, MAX_EXTRAS, MAX_EXTRA_QTY, SUPPLY_CATEGORIES, StationRequestService, requestContextOf,
} from './station-request.service';

export class StationNewItemDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))
  @Length(2, 80)
  name!: string;

  @IsIn(SUPPLY_CATEGORIES)
  category!: (typeof SUPPLY_CATEGORIES)[number];

  @IsIn(EXTRA_UNITS)
  unit!: (typeof EXTRA_UNITS)[number];
}

export class StationExtraDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  rawMaterialId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StationNewItemDto)
  newItem?: StationNewItemDto;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(MAX_EXTRA_QTY)
  qty!: number;
}

export class RequestLowDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_EXTRAS)
  @ValidateNested({ each: true })
  @Type(() => StationExtraDto)
  extras?: StationExtraDto[];
}

/**
 * "Request what's running low" on the kitchen or bar screen.
 *
 * A paired tablet or a logged-in person may tap it. The tap SENDS: the list
 * is consolidated for the branch and goes to the owners, as KJ asked. Buying,
 * posting to stock and cancelling stay on the Procure screen, owner and
 * manager only. Nothing here carries a cost.
 */
@UseGuards(JwtOrDeviceTokenAuthGuard, RolesGuard)
@Controller('kds')
export class StationRequestController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: StationRequestService,
  ) {}

  /** What a tap would ask for now, and what "+" can pick. Writes nothing. */
  @Roles(...STATION_ROLES)
  @Get('stations/:id/request-low')
  async preview(@CurrentUser() user: StationCaller, @Param('id') stationId: string) {
    const ctx = await stationContext(this.prisma, user, stationId, { write: false });
    return this.requests.preview(requestContextOf(ctx), new Date());
  }

  /** Put what is running low on the branch's list and send it. */
  @Roles(...STATION_ROLES)
  @Post('stations/:id/request-low')
  @HttpCode(HttpStatus.OK)
  async request(@CurrentUser() user: StationCaller, @Param('id') stationId: string, @Body() body: RequestLowDto) {
    const extras = body?.extras ?? [];
    for (const e of extras) {
      if (!!e.rawMaterialId === !!e.newItem) {
        throw new BadRequestException('Each added item needs either an item from the list or a new item, not both.');
      }
    }
    const ctx = await stationContext(this.prisma, user, stationId, { write: true });
    return this.requests.apply(requestContextOf(ctx), extras, new Date());
  }
}
