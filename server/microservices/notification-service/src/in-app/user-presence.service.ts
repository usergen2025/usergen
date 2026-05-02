import { Injectable } from '@nestjs/common';

/**
 * Tracks which video project page a user is currently on (heartbeat from the client).
 * In-memory only per notification-service instance.
 */
@Injectable()
export class UserPresenceService {
  private readonly ttlMs = 90_000;
  private readonly map = new Map<string, { projectId: string; exp: number }>();

  setActiveProject(userId: string, projectId: string | null | undefined): void {
    if (!userId) return;
    if (!projectId) {
      this.map.delete(userId);
      return;
    }
    this.map.set(userId, { projectId, exp: Date.now() + this.ttlMs });
  }

  isUserOnProject(userId: string, projectId: string): boolean {
    this.prune();
    const row = this.map.get(userId);
    if (!row) return false;
    return row.projectId === projectId && row.exp > Date.now();
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (v.exp <= now) this.map.delete(k);
    }
  }
}
