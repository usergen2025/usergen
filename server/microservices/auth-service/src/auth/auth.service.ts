import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../common/database/database.service';
import { RedisService } from '../common/redis/redis.service';
import { MessageQueueService } from '../common/message-queue/message-queue.service';
import { LoggerService } from '../common/logger/logger.service';
import { HttpClientService } from '../common/http/http-client.service';
import { CryptoHelper, ValidationHelper, DateHelper } from '@shared/utils';
import { User, UserRole, OtpType } from '@prisma/client';
import { ResponseHelper } from '@shared/utils';

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  name: string;
  email: string;
  mobile?: string;
  password: string;
  goal?: string;
}

export interface SocialLoginDto {
  provider: string;
  providerId: string;
  email: string;
  name: string;
  picture?: string;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface ResetPasswordDto {
  token: string;
  newPassword: string;
}

export interface SendOtpDto {
  email: string;
  mobile?: string;
  type: OtpType;
}

export interface VerifyOtpDto {
  email: string;
  otp: string;
  type: OtpType;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
    private readonly messageQueueService: MessageQueueService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly httpClient: HttpClientService,
  ) {}

  async register(registerDto: RegisterDto): Promise<{ user: User; tokens: any }> {
    const { name, email, mobile, password, goal } = registerDto;

    // Validate email
    if (!ValidationHelper.validateEmail(email)) {
      throw new BadRequestException('Invalid email format');
    }

    // Validate password
    const passwordErrors = ValidationHelper.validatePassword(password);
    if (passwordErrors.length > 0) {
      throw new BadRequestException(passwordErrors[0].message);
    }

    // Check if user already exists
    const existingUser = await this.databaseService.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = await this.databaseService.user.create({
      data: {
        name,
        email,
        mobile,
        passwordHash,
        goal,
        credits: 100, // Default credits
        role: UserRole.USER,
      },
    });

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Send verification email
    await this.sendVerificationEmail(user.email);

    // Publish user created event
    await this.messageQueueService.publish(
      'user.events',
      'user.created',
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      }
    );

    this.logger.log(`User registered: ${user.email}`, 'AuthService');

    return { user, tokens };
  }

  async login(loginDto: LoginDto): Promise<{ user: User; tokens: any }> {
    const { email, password } = loginDto;

    // Find user
    const user = await this.databaseService.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check password
    if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    // Update last login
    await this.databaseService.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate tokens
    const tokens = await this.generateTokens(user);

    this.logger.log(`User logged in: ${user.email}`, 'AuthService');

    return { user, tokens };
  }

  async socialLogin(socialLoginDto: SocialLoginDto): Promise<{ user: User; tokens: any }> {
    const { provider, providerId, email, name, picture } = socialLoginDto;

    // Find existing social account
    let socialAccount = await this.databaseService.socialAccount.findUnique({
      where: {
        provider_providerId: {
          provider,
          providerId,
        },
      },
      include: { user: true },
    });

    if (socialAccount) {
      // Update social account info
      await this.databaseService.socialAccount.update({
        where: { id: socialAccount.id },
        data: {
          email,
          name,
          picture,
        },
      });

      const user = socialAccount.user;
      const tokens = await this.generateTokens(user);

      this.logger.log(`Social login: ${user.email}`, 'AuthService');
      return { user, tokens };
    }

    // Check if user exists with this email
    let user = await this.databaseService.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Create new user
      user = await this.databaseService.user.create({
        data: {
          name,
          email,
          profilePicture: picture,
          credits: 100,
          role: UserRole.USER,
          isEmailVerified: true, // Social login users are considered verified
        },
      });
    }

    // Create social account
    await this.databaseService.socialAccount.create({
      data: {
        userId: user.id,
        provider,
        providerId,
        email,
        name,
        picture,
      },
    });

    // Generate tokens
    const tokens = await this.generateTokens(user);

    this.logger.log(`Social login: ${user.email}`, 'AuthService');
    return { user, tokens };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<void> {
    const { email } = forgotPasswordDto;

    const user = await this.databaseService.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Don't reveal if user exists or not
      return;
    }

    // Generate reset token
    const token = CryptoHelper.generateRandomString(32);
    const expiresAt = DateHelper.addHours(new Date(), 1);

    // Store reset token
    await this.databaseService.passwordReset.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    // Send reset email
    await this.sendPasswordResetEmail(email, token);

    this.logger.log(`Password reset requested: ${email}`, 'AuthService');
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    const { token, newPassword } = resetPasswordDto;

    // Validate password
    const passwordErrors = ValidationHelper.validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      throw new BadRequestException(passwordErrors[0].message);
    }

    // Find reset record
    const resetRecord = await this.databaseService.passwordReset.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetRecord || resetRecord.isUsed || DateHelper.isExpired(resetRecord.expiresAt)) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update user password
    await this.databaseService.user.update({
      where: { id: resetRecord.userId },
      data: { passwordHash },
    });

    // Mark reset token as used
    await this.databaseService.passwordReset.update({
      where: { id: resetRecord.id },
      data: { isUsed: true },
    });

    // Invalidate all refresh tokens
    await this.databaseService.refreshToken.deleteMany({
      where: { userId: resetRecord.userId },
    });

    this.logger.log(`Password reset completed: ${resetRecord.user.email}`, 'AuthService');
  }

  async sendOtp(sendOtpDto: SendOtpDto): Promise<void> {
    const { email, mobile, type } = sendOtpDto;

    this.logger.log(`📧 Sending OTP request received for ${email} (type: ${type})`, 'AuthService');

    // Validate email
    if (!ValidationHelper.validateEmail(email)) {
      this.logger.warn(`Invalid email format: ${email}`, 'AuthService');
      throw new BadRequestException('Invalid email format');
    }

    // For login OTP, check if user exists
    if (type === OtpType.LOGIN) {
      const user = await this.databaseService.user.findUnique({
        where: { email },
      });

      if (!user) {
        this.logger.warn(`User not found for LOGIN OTP: ${email}`, 'AuthService');
        throw new BadRequestException('User not found');
      }
      this.logger.log(`User found for LOGIN OTP: ${email}`, 'AuthService');
    }

    // Generate OTP
    const otp = CryptoHelper.generateOTP();
    const expiresAt = DateHelper.addMinutes(new Date(), 10);

    // Store OTP record
    const otpRecord = await this.databaseService.otpRecord.create({
      data: {
        email,
        mobile,
        otp,
        type,
        expiresAt,
      },
    });

    this.logger.log(`✅ OTP record created for ${email}`, 'AuthService');

    // Send OTP via notification service
    try {
      const notificationServiceUrl = this.configService.get<string>(
        'NOTIFICATION_SERVICE_URL',
        'http://localhost:9006/api',
      );

      // Map OtpType to notification service OtpType
      let otpType: 'EMAIL_VERIFICATION' | 'LOGIN' | 'PASSWORD_RESET';
      switch (type) {
        case OtpType.EMAIL_VERIFICATION:
          otpType = 'EMAIL_VERIFICATION';
          break;
        case OtpType.LOGIN:
          otpType = 'LOGIN';
          break;
        case OtpType.PASSWORD_RESET:
          otpType = 'PASSWORD_RESET';
          break;
        default:
          otpType = 'EMAIL_VERIFICATION';
      }

      await this.httpClient.client.post('/notifications/send-otp', {
        email,
        mobile,
        otp,
        type: otpType,
      });

      this.logger.log(`✅ OTP sent successfully to ${email} via notification service`, 'AuthService');
    } catch (error) {
      // Log error but don't fail the OTP creation
      // OTP is already stored in DB, user can still verify it manually if needed
      this.logger.error(`⚠️ Failed to send OTP via notification service: ${error.message}`, 'AuthService');

      // In development, still log OTP to console for testing
      if (this.configService.get('NODE_ENV') === 'local' || this.configService.get('NODE_ENV') === 'development') {
        console.log(`[DEV] 🎯 OTP for ${email}: ${otp}`);
        console.log(`[DEV] OTP expires at: ${expiresAt.toISOString()}`);
        console.log(`[DEV] Note: Email sending failed, but OTP is logged above for testing`);
      }
    }
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto & { name?: string; mobile?: string }): Promise<{ user?: User; tokens?: any }> {
    const { email, otp, type, name, mobile } = verifyOtpDto;

    this.logger.log(`🔐 Verifying OTP for ${email} (type: ${type})`, 'AuthService');

    // Find OTP record
    const otpRecord = await this.databaseService.otpRecord.findFirst({
      where: {
        email,
        otp,
        type,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otpRecord) {
      this.logger.warn(`Invalid or expired OTP for ${email} (type: ${type})`, 'AuthService');
      throw new BadRequestException('Invalid or expired OTP');
    }

    this.logger.log(`✅ OTP record found for ${email}`, 'AuthService');

    // Mark OTP as used
    await this.databaseService.otpRecord.update({
      where: { id: otpRecord.id },
      data: { isUsed: true },
    });

    // Handle different OTP types
    if (type === OtpType.LOGIN) {
      // Find user and generate tokens for login
      const user = await this.databaseService.user.findUnique({
        where: { email },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      if (!user.isActive) {
        throw new UnauthorizedException('Account is deactivated');
      }

      // Update last login
      await this.databaseService.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      // Generate tokens
      const tokens = await this.generateTokens(user);

      this.logger.log(`OTP login verified: ${email}`, 'AuthService');
      return { user, tokens };
    } else if (type === OtpType.EMAIL_VERIFICATION) {
      // For registration via OTP: Create user if doesn't exist, then verify
      let user = await this.databaseService.user.findUnique({
        where: { email },
      });

      if (!user && name) {
        // Create new user for OTP-based registration
        user = await this.databaseService.user.create({
          data: {
            name,
            email,
            mobile,
            credits: 100,
            role: UserRole.USER,
            isEmailVerified: true, // Already verified via OTP
            isActive: true,
          },
        });

        // Generate tokens for newly created user
        const tokens = await this.generateTokens(user);

        this.logger.log(`User registered via OTP: ${email}`, 'AuthService');
        return { user, tokens };
      } else if (user) {
        // User exists, just verify email
        await this.databaseService.user.update({
          where: { email },
          data: { isEmailVerified: true },
        });

        this.logger.log(`Email verified via OTP: ${email}`, 'AuthService');
        return {};
      } else {
        throw new BadRequestException('Name is required for registration');
      }
    } else if (type === OtpType.MOBILE_VERIFICATION) {
      // Update mobile verification status
      await this.databaseService.user.update({
        where: { email },
        data: { isMobileVerified: true },
      });

      this.logger.log(`Mobile verified via OTP: ${email}`, 'AuthService');
      return {};
    }

    return {};
  }

  async refreshToken(refreshToken: string): Promise<{ tokens: any }> {
    // Find refresh token
    const tokenRecord = await this.databaseService.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!tokenRecord || DateHelper.isExpired(tokenRecord.expiresAt)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Generate new tokens
    const tokens = await this.generateTokens(tokenRecord.user);

    // Delete old refresh token
    await this.databaseService.refreshToken.delete({
      where: { id: tokenRecord.id },
    });

    return { tokens };
  }

  async logout(refreshToken: string): Promise<void> {
    // Delete refresh token
    await this.databaseService.refreshToken.deleteMany({
      where: { token: refreshToken },
    });

    this.logger.log('User logged out', 'AuthService');
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.databaseService.user.findUnique({
      where: { email },
    });

    if (user && user.passwordHash && await bcrypt.compare(password, user.passwordHash)) {
      return user;
    }

    return null;
  }

  private async generateTokens(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = CryptoHelper.generateRandomString(64);

    // Store refresh token
    const expiresAt = DateHelper.addDays(new Date(), 7);
    await this.databaseService.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  private async sendVerificationEmail(email: string): Promise<void> {
    // Generate OTP
    const otp = CryptoHelper.generateOTP();
    const expiresAt = DateHelper.addMinutes(new Date(), 5);

    // Store OTP
    await this.databaseService.otpRecord.create({
      data: {
        email,
        otp,
        type: OtpType.EMAIL_VERIFICATION,
        expiresAt,
      },
    });

    // TODO: Implement actual email sending
    // This is a placeholder for future email service integration
    this.logger.log(`Verification OTP for ${email}: ${otp}`, 'AuthService');
  }

  private async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    // TODO: Implement actual email sending
    // This is a placeholder for future email service integration
    this.logger.log(`Password reset link for ${email}: ${token}`, 'AuthService');
  }
}
