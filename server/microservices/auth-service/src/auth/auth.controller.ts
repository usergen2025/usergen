import { Controller, Post, Body, UseGuards, Req, Res, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService, RegisterDto, LoginDto, SocialLoginDto, ForgotPasswordDto, ResetPasswordDto, SendOtpDto, VerifyOtpDto } from './auth.service';
import { JwtAuthGuard, LocalAuthGuard, GoogleAuthGuard, FacebookAuthGuard } from './guards';
import { ResponseHelper } from '@shared/utils';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ 
    summary: 'Register a new user',
    description: 'Creates a new user account and returns access tokens. Password must be at least 8 characters with uppercase, lowercase, and numbers.\n\n**How to get JWT token:**\n1. Execute this endpoint to register\n2. Copy the `accessToken` from the response\n3. Click "Authorize" button (top right) in Swagger\n4. Enter: `Bearer YOUR_ACCESS_TOKEN`\n5. Now you can test protected endpoints.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'John Doe', description: 'Full name of the user' },
        email: { type: 'string', example: 'john@example.com', description: 'Valid email address' },
        password: { type: 'string', example: 'SecurePass123!', description: 'Password (min 8 chars, must contain uppercase, lowercase, number)' },
        mobile: { type: 'string', example: '+1234567890', description: 'Mobile number with country code' },
        goal: { type: 'string', example: 'Create professional videos', description: 'User goal or purpose' }
      },
      required: ['name', 'email', 'password']
    }
  })
  @ApiResponse({ 
    status: 201, 
    description: 'User registered successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', example: 'clx1234567890' },
                email: { type: 'string', example: 'john@example.com' },
                name: { type: 'string', example: 'John Doe' },
                role: { type: 'string', example: 'USER' },
                credits: { type: 'number', example: 100 },
                isEmailVerified: { type: 'boolean', example: false },
                createdAt: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
              }
            },
            tokens: {
              type: 'object',
              properties: {
                accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: 'Copy this token and use it in the Authorize button' },
                refreshToken: { type: 'string', example: 'abc123def456...', description: 'Use this to refresh the access token' }
              }
            }
          }
        },
        message: { type: 'string', example: 'User registered successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - Invalid input or user already exists',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'User with this email already exists' },
        error: { type: 'string', example: 'Bad Request' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async register(@Body() registerDto: RegisterDto) {
    const result = await this.authService.register(registerDto);
    return ResponseHelper.success(result, 'User registered successfully');
  }

  @Post('login')
  @UseGuards(LocalAuthGuard)
  @ApiOperation({ 
    summary: 'Login user',
    description: 'Authenticate user with email and password. Returns access and refresh tokens.\n\n**How to get JWT token:**\n1. Execute this endpoint with valid credentials\n2. Copy the `accessToken` from the response\n3. Click "Authorize" button (top right) in Swagger\n4. Enter: `Bearer YOUR_ACCESS_TOKEN`\n5. Now you can test protected endpoints.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'john@example.com' },
        password: { type: 'string', example: 'SecurePass123!' }
      },
      required: ['email', 'password']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful - Returns user data and tokens',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', example: 'clx1234567890' },
                email: { type: 'string', example: 'john@example.com' },
                name: { type: 'string', example: 'John Doe' },
                role: { type: 'string', example: 'USER' },
                credits: { type: 'number', example: 100 },
                lastLoginAt: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
              }
            },
            tokens: {
              type: 'object',
              properties: {
                accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: 'Copy this token and use it in the Authorize button' },
                refreshToken: { type: 'string', example: 'abc123def456...', description: 'Use this to refresh the access token' }
              }
            }
          }
        },
        message: { type: 'string', example: 'Login successful' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid credentials',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Invalid credentials' },
        error: { type: 'string', example: 'Unauthorized' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async login(@Body() loginDto: LoginDto) {
    const result = await this.authService.login(loginDto);
    return ResponseHelper.success(result, 'Login successful');
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth login' })
  async googleAuth(@Req() req: Request) {
    // This route is handled by GoogleAuthGuard
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleAuthCallback(@Req() req: Request, @Res() res: Response) {
    const result = await this.authService.socialLogin({
      provider: 'google',
      providerId: req.user['providerId'],
      email: req.user['email'],
      name: req.user['name'],
      picture: req.user['picture'],
    });

    // Redirect to frontend with tokens
    const redirectUrl = `${process.env.FRONTEND_URL}/auth/callback?access_token=${result.tokens.accessToken}&refresh_token=${result.tokens.refreshToken}`;
    res.redirect(redirectUrl);
  }

  @Get('facebook')
  @UseGuards(FacebookAuthGuard)
  @ApiOperation({ summary: 'Facebook OAuth login' })
  async facebookAuth(@Req() req: Request) {
    // This route is handled by FacebookAuthGuard
  }

  @Get('facebook/callback')
  @UseGuards(FacebookAuthGuard)
  @ApiOperation({ summary: 'Facebook OAuth callback' })
  async facebookAuthCallback(@Req() req: Request, @Res() res: Response) {
    const result = await this.authService.socialLogin({
      provider: 'facebook',
      providerId: req.user['providerId'],
      email: req.user['email'],
      name: req.user['name'],
      picture: req.user['picture'],
    });

    // Redirect to frontend with tokens
    const redirectUrl = `${process.env.FRONTEND_URL}/auth/callback?access_token=${result.tokens.accessToken}&refresh_token=${result.tokens.refreshToken}`;
    res.redirect(redirectUrl);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password reset' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'john@example.com' }
      },
      required: ['email']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Password reset email sent',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'null', example: null },
        message: { type: 'string', example: 'Password reset email sent' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Invalid email format' },
        error: { type: 'string', example: 'Bad Request' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    await this.authService.forgotPassword(forgotPasswordDto);
    return ResponseHelper.success(null, 'Password reset email sent');
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', example: 'abc123def456...', description: 'Password reset token from email' },
        newPassword: { type: 'string', example: 'NewSecurePass123!', description: 'New password' }
      },
      required: ['token', 'newPassword']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Password reset successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'null', example: null },
        message: { type: 'string', example: 'Password reset successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid or expired token',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Invalid or expired reset token' },
        error: { type: 'string', example: 'Bad Request' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    await this.authService.resetPassword(resetPasswordDto);
    return ResponseHelper.success(null, 'Password reset successfully');
  }

  @Post('send-otp')
  @ApiOperation({ summary: 'Send OTP for login or registration' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'john@example.com', description: 'Email address' },
        mobile: { type: 'string', example: '+1234567890', description: 'Mobile number (optional)' },
        type: { type: 'string', enum: ['EMAIL_VERIFICATION', 'MOBILE_VERIFICATION', 'LOGIN', 'PASSWORD_RESET'], example: 'LOGIN', description: 'Type of OTP' }
      },
      required: ['email', 'type']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'OTP sent successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'null', example: null },
        message: { type: 'string', example: 'OTP sent successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Invalid email format or user not found' },
        error: { type: 'string', example: 'Bad Request' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async sendOtp(@Body() sendOtpDto: SendOtpDto) {
    console.log('📧 [AuthController] sendOtp called:', { 
      email: sendOtpDto.email, 
      type: sendOtpDto.type,
      mobile: sendOtpDto.mobile 
    });
    await this.authService.sendOtp(sendOtpDto);
    return ResponseHelper.success(null, 'OTP sent successfully');
  }

  @Post('verify-otp')
  @ApiOperation({ summary: 'Verify OTP for login or registration' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'john@example.com' },
        otp: { type: 'string', example: '123456' },
        type: { type: 'string', enum: ['EMAIL_VERIFICATION', 'MOBILE_VERIFICATION', 'LOGIN', 'PASSWORD_RESET'], example: 'LOGIN' },
        name: { type: 'string', example: 'John Doe', description: 'Required for EMAIL_VERIFICATION type registration (when user does not exist)' },
        mobile: { type: 'string', example: '+1234567890', description: 'Optional mobile number for registration' }
      },
      required: ['email', 'otp', 'type']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'OTP verified successfully - Returns user and tokens for LOGIN and EMAIL_VERIFICATION (registration) types',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', example: 'clx1234567890' },
                email: { type: 'string', example: 'john@example.com' },
                name: { type: 'string', example: 'John Doe' },
                role: { type: 'string', example: 'USER' },
                credits: { type: 'number', example: 100 }
              }
            },
            tokens: {
              type: 'object',
              properties: {
                accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                refreshToken: { type: 'string', example: 'abc123def456...' }
              }
            }
          }
        },
        message: { type: 'string', example: 'OTP verified successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid or expired OTP',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Invalid or expired OTP' },
        error: { type: 'string', example: 'Bad Request' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto & { name?: string; mobile?: string }) {
    console.log('✅ [AuthController] verifyOtp called:', { 
      email: verifyOtpDto.email, 
      type: verifyOtpDto.type,
      hasOtp: !!verifyOtpDto.otp 
    });
    const result = await this.authService.verifyOtp(verifyOtpDto);
    return ResponseHelper.success(result, 'OTP verified successfully');
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token', description: 'Use your refresh token to get a new access token' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        refreshToken: { type: 'string', example: 'abc123def456...', description: 'Your refresh token from login/register' }
      },
      required: ['refreshToken']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Token refreshed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            tokens: {
              type: 'object',
              properties: {
                accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: 'New access token' },
                refreshToken: { type: 'string', example: 'xyz789abc123...', description: 'New refresh token' }
              }
            }
          }
        },
        message: { type: 'string', example: 'Token refreshed successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Invalid refresh token',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Invalid refresh token' },
        error: { type: 'string', example: 'Unauthorized' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async refreshToken(@Body('refreshToken') refreshToken: string) {
    const result = await this.authService.refreshToken(refreshToken);
    return ResponseHelper.success(result, 'Token refreshed successfully');
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Logout user', description: 'Invalidates the refresh token and logs out the user' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        refreshToken: { type: 'string', example: 'abc123def456...', description: 'The refresh token to invalidate' }
      },
      required: ['refreshToken']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Logout successful',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'null', example: null },
        message: { type: 'string', example: 'Logout successful' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid or missing token',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' },
        error: { type: 'string', example: 'Unauthorized' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async logout(@Body('refreshToken') refreshToken: string) {
    await this.authService.logout(refreshToken);
    return ResponseHelper.success(null, 'Logout successful');
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Get current user profile',
    description: 'Retrieves the authenticated user profile. Requires JWT token in Authorization header.\n\n**Note:** You must authorize first by clicking the "Authorize" button and entering your access token.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Profile retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clx1234567890' },
            email: { type: 'string', example: 'john@example.com' },
            name: { type: 'string', example: 'John Doe' },
            mobile: { type: 'string', example: '+1234567890' },
            role: { type: 'string', example: 'USER' },
            credits: { type: 'number', example: 100 },
            profilePicture: { type: 'string', example: null },
            isEmailVerified: { type: 'boolean', example: true },
            isMobileVerified: { type: 'boolean', example: false },
            createdAt: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
          }
        },
        message: { type: 'string', example: 'Profile retrieved successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid or missing token',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' },
        error: { type: 'string', example: 'Unauthorized' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async getProfile(@Req() req: Request) {
    const user = req.user;
    return ResponseHelper.success(user, 'Profile retrieved successfully');
  }
}
