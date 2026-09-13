import { ConflictException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/**
 * One number that does not look right, and the question to ask about it.
 *
 * `key` names the box on the screen (a request line, a receipt row, a product's
 * price); `value` is the exact figure the server judged, in the form the person
 * confirms it back. A confirmation clears a warning only when both match, so a
 * price retyped after the dialog is judged again rather than waved through.
 */
export interface SanityWarning {
  key: string;
  kind: 'INGREDIENT_COST' | 'SELL_PRICE' | 'MARGIN';
  /** 'magnitude' is ten times off either way — almost always a unit or pack-size mistake. */
  severity: 'unusual' | 'magnitude';
  name: string;
  value: string;
  /** One plain sentence, ending in the question. */
  message: string;
  rawMaterialId?: string;
  productId?: string;
  /** What was typed, and what is usual, in the terms the screen shows. */
  typed: number;
  usualLow: number | null;
  usualHigh: number | null;
  /** How many past deliveries "usual" rests on (0 when it rests on the cost on file). */
  points: number;
  unitLabel: string;
}

export interface SanityConfirmation {
  key: string;
  value: string;
}

/** How a request says it understands the question, and what it has already answered. */
export interface SanityContext {
  /**
   * The client sends `X-Sanity-Confirm: 1` when it can show the dialog. A client
   * that does not — an older till, the Expo app before its update, an
   * integration — keeps exactly today's behaviour, so nobody is stranded
   * mid-rollout with a refusal they cannot answer. The order-of-magnitude
   * guard still protects every client either way.
   */
  optedIn: boolean;
  confirmations?: SanityConfirmation[];
  userId?: string;
  /** Who is asking, so the question can leave out prices the shop does not show them. */
  role?: string | null;
}

export const SANITY_HEADER = 'x-sanity-confirm';

export function sanityContext(
  header: string | undefined,
  confirmations: SanityConfirmation[] | undefined,
  userId?: string,
  role?: string | null,
): SanityContext {
  return { optedIn: header === '1', confirmations, userId, role };
}

export class SanityConfirmationDto implements SanityConfirmation {
  @IsString()
  @MaxLength(200)
  key!: string;

  @IsString()
  @MaxLength(80)
  value!: string;
}

/** Declared on every request body that can carry an answer to the question. */
export class WithSanityConfirmations {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SanityConfirmationDto)
  sanityConfirmations?: SanityConfirmationDto[];
}

/**
 * The refusal. 409, not 400: an ordinary validation error and "please
 * double-check this" must be told apart by the screen, and the existing
 * order-of-magnitude 400 keeps its own meaning.
 */
export class SanityConfirmRequiredException extends ConflictException {
  constructor(readonly warnings: SanityWarning[]) {
    super({
      code: 'SANITY_CONFIRM_REQUIRED',
      message: warnings.map((w) => w.message),
      warnings,
    });
  }
}
