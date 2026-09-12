import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './api/auth.controller';
import { AuthGuard } from './api/guards/auth.guard';
import { AuthService } from './application/auth.service';
import { TokenService } from './application/token.service';
import { AuditService } from './infrastructure/audit.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    AuditService,
    /**
     * حارس عام: الأصل أن كل مسار محميّ، والانفتاح يكون بـ @Public صريح.
     * العكس — حارس يُضاف يدوياً لكل متحكّم — ينتهي بمسار منسيّ مكشوف.
     */
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, TokenService, AuditService],
})
export class IdentityModule {}
