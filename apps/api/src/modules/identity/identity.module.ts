import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/public';
import { AccountController } from './api/account.controller';
import { AuthController } from './api/auth.controller';
import { AuthGuard } from './api/guards/auth.guard';
import { AccountService } from './application/account.service';
import { AuthService } from './application/auth.service';
import { OtpStore } from './application/otp.store';
import { RecoveryService } from './application/recovery.service';
import { TokenService } from './application/token.service';
import { AuditService } from './infrastructure/audit.service';

@Module({
  // الإشعارات الطبقة الأدنى ولا تعتمد على الهوية — رموز البريد تمرّ بصندوقها الصادر
  imports: [JwtModule.register({}), NotificationsModule],
  controllers: [AuthController, AccountController],
  providers: [
    AuthService,
    TokenService,
    AuditService,
    AccountService,
    RecoveryService,
    OtpStore,
    /**
     * حارس عام: الأصل أن كل مسار محميّ، والانفتاح يكون بـ @Public صريح.
     * العكس — حارس يُضاف يدوياً لكل متحكّم — ينتهي بمسار منسيّ مكشوف.
     */
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, TokenService, AuditService],
})
export class IdentityModule {}
