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
