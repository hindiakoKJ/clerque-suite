import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '@repo/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET!,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    /*
      Only a real access token signs anyone in. The 2FA challenge handed out
      after a correct password (or till PIN) is signed with this same secret
      and carries sub, tenantId and role -- so before this check it passed
      every JwtAuthGuard route for its five minutes, and 2FA protected
      nothing: POST /users could make a second owner with it. Challenge
      tokens say kind: '2fa-challenge'; refresh tokens say type: 'refresh'
      (and would be signed with this secret too if JWT_REFRESH_SECRET were
      ever missing). Access tokens carry neither.
    */
    const claims = payload as unknown as { kind?: unknown; type?: unknown };
    if (claims.kind !== undefined || claims.type !== undefined) throw new UnauthorizedException();

    // All principals (including SUPER_ADMIN) are stored in the User table.
    // The legacy SuperAdmin model is not used for JWT validation — super-admins
    // are seeded as Users with role='SUPER_ADMIN' and isSuperAdmin=true in the JWT.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();
    return payload;
  }
}
