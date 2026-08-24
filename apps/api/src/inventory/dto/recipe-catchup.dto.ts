import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class RecipeCatchupPreviewDto {
  @ApiProperty({ example: '2026-08-24T00:00:00.000Z', description: 'Start of the window, inclusive.' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ example: '2026-09-15T23:59:59.999Z', description: 'End of the window, inclusive.' })
  @IsISO8601()
  to!: string;

  @ApiPropertyOptional({ description: 'Defaults to the business’s first branch.' })
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional({
    description:
      'Optional. Narrows the run to specific products. Only needed for sales predating the ' +
      'deduction marker, where "never deducted" cannot be distinguished from "already deducted". ' +
      'Omit to catch up everything the marker shows as outstanding.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  productIds?: string[];
}

export class RecipeCatchupApplyDto extends RecipeCatchupPreviewDto {
  @ApiProperty({
    description:
      'The lineCount returned by the preview. Apply recomputes inside its transaction and ' +
      'refuses if this no longer matches, so nothing is deducted that the operator did not review.',
    example: 412,
  })
  @IsInt()
  @Min(0)
  expectedLineCount!: number;
}
