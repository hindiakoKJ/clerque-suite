import { IsString, IsOptional } from 'class-validator';

export class UploadDocumentDto {
  @IsString()
  entityType: string;

  @IsString()
  entityId: string;

  @IsOptional()
  @IsString()
  label?: string;
}
