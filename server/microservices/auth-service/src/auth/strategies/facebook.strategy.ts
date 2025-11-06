import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-facebook';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  private disabled: boolean = false;

  constructor(private readonly configService: ConfigService) {
    const appId = configService.get<string>('FACEBOOK_APP_ID');
    const appSecret = configService.get<string>('FACEBOOK_APP_SECRET');
    const baseUrl = configService.get<string>('BASE_URL') || configService.get<string>('CDN_URL') || 'http://localhost:9000';

    // Determine strategy config based on credentials
    const strategyConfig = (!appId || !appSecret || appId === 'your-facebook-app-id' || appSecret === 'your-facebook-app-secret')
      ? {
          clientID: 'dummy', // Dummy values to prevent Passport error
          clientSecret: 'dummy',
          callbackURL: `${baseUrl}/auth/facebook/callback`,
          profileFields: ['id', 'emails', 'name', 'picture'],
        }
      : {
          clientID: appId,
          clientSecret: appSecret,
          callbackURL: `${baseUrl}/auth/facebook/callback`,
          profileFields: ['id', 'emails', 'name', 'picture'],
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
    profile: Profile,
    done: Function,
  ): Promise<any> {
    // Skip validation if disabled
    if (this.disabled) {
      return done(new Error('Facebook OAuth is not configured'), null);
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
