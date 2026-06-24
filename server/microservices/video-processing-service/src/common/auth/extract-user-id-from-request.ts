import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

/**
 * Extract userId from Authorization Bearer JWT (same logic as VideoController).
 */
export function extractUserIdFromRequest(
  req: { headers?: { authorization?: string } },
  configService: ConfigService,
): string | null {
  try {
    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.replace('Bearer ', '');
    const jwtSecret =
      configService.get<string>('JWT_SECRET') ||
      'SFVBJIK@67289416VYUQVDUQVCHU=BCHUDB567UJCNUEHJB.';

    if (!jwtSecret || jwtSecret === 'your-jwt-secret') {
      return null;
    }

    const decoded = jwt.verify(token, jwtSecret) as Record<string, unknown>;
    const userId =
      (decoded.sub as string) ||
      (decoded.userId as string) ||
      (decoded.id as string) ||
      null;

    return userId || null;
  } catch {
    return null;
  }
}
