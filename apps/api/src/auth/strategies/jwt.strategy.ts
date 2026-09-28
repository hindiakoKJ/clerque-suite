import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '@repo/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /**
   * When this process started. A token with no `sid` is honoured only if it
   * was issued before then -- by the previous build -- and such tokens die
   * on their own within eight hours of the deploy. Public so a test can move it.
   */
  static bootAt = Date.now();

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

    /*
      An access token is only as alive as its session. `sid` names the
      UserSession it was minted with; a session ended by sign-out, "sign out
      everywhere", a password change or the Console's tenant-wide revoke ends
      the token at the next request instead of at its eight-hour expiry. One
      indexed read -- the session with its user -- replaces the user read.
    */
    if (payload.sid) {
      const session = await this.prisma.userSession.findUnique({
        where:  { id: payload.sid },
        select: { status: true, userId: true, user: { select: { isActive: true } } },
      });
      if (!session || session.status !== 'ACTIVE' || session.userId !== payload.sub || !session.user.isActive) {
        throw new UnauthorizedException();
      }
      return payload;
    }

    /*
      No sid. Super-admin tokens never carry one (the Console signs in for
      two hours at a time, with no session row). Anyone else's must have been
      minted by the previous build, before this process started: nothing
      signed since leaves the sid out, so a newer sid-less token is forged.
    */
    if (!payload.isSuperAdmin) {
      const issuedAt = Number((payload as { iat?: number }).iat ?? 0) * 1000;
      if (!(issuedAt > 0) || issuedAt >= JwtStrategy.bootAt) throw new UnauthorizedException();
    }

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
