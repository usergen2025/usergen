import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private disabled: boolean = false;

  constructor(private readonly configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET');
    const baseUrl = configService.get<string>('BASE_URL') || configService.get<string>('CDN_URL') || 'http://localhost:9000';

    // Determine strategy config based on credentials
    const strategyConfig = (!clientID || !clientSecret || clientID === 'your-google-client-id' || clientSecret === 'your-google-client-secret')
      ? {
          clientID: 'dummy', // Dummy values to prevent Passport error
          clientSecret: 'dummy',
          callbackURL: `${baseUrl}/auth/google/callback`,
          scope: ['email', 'profile'],
        }
      : {
          clientID,
          clientSecret,
          callbackURL: `${baseUrl}/auth/google/callback`,
          scope: ['email', 'profile'],
        };

    super(strategyConfig);

    // Mark as disabled if using dummy credentials
    if (strategyConfig.clientID === 'dummy') {
      this.disabled = true;
    }
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    // Skip validation if disabled
    if (this.disabled) {
      return done(new Error('Google OAuth is not configured'), null);
    }

    const { id, name, emails, photos } = profile;
    const user = {
      providerId: id,
      email: emails[0].value,
      name: name.givenName + ' ' + name.familyName,
      picture: photos[0].value,
    };
    done(null, user);
  }
}
