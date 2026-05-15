import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService } from '../../api-keys/api-keys.service';

/**
 * Sprint 25 — API-key auth for the public `/public-api/v1/*` surface.
 *
 * Implemented as a plain injectable (not a Passport strategy) to avoid
 * adding a new `passport-custom` dependency. Used by `ApiKeyGuard`.
 *
 * Accepts a key either as:
 *   Authorization: Bearer clq_live_...
 *   X-API-Key: clq_live_...
 */
@Injectable()
export class ApiKeyStrategy {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async authenticate(req: Request): Promise<{
    isApiKey:    true;
    tenantId:    string;
    apiKeyId:    string;
    accessLevel: 'read' | 'readwrite';
  }> {
    const headerKey =
      (req.headers['x-api-key'] as string | undefined) ?? undefined;
    const auth = req.headers.authorization;
    let bearer: string | undefined;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      bearer = auth.slice(7).trim();
    }
    const plaintext = headerKey ?? bearer;
    if (!plaintext) throw new UnauthorizedException('Missing API key.');

    const resolved = await this.apiKeys.resolveKey(plaintext);
    if (!resolved) throw new UnauthorizedException('Invalid or expired API key.');

    return {
      isApiKey:    true,
      tenantId:    resolved.tenantId,
      apiKeyId:    resolved.keyId,
      accessLevel: resolved.accessLevel as 'read' | 'readwrite',
    };
  }
}
