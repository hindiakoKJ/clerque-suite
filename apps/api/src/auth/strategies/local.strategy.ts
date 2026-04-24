import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { Request } from 'express';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email', passReqToCallback: true });
  }

  async validate(req: Request, email: string, password: string) {
    const companyCode = (req.body as Record<string, string>).companyCode;
    const user = await this.authService.validateUser(email, password, companyCode);
    if (!user) throw new UnauthorizedException('Invalid company code, email, or password');
    return user;
  }
}
