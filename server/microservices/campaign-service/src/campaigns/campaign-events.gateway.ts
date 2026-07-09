import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export type CampaignEventType =
  | 'campaign:application:new'
  | 'campaign:application:reviewed'
  | 'campaign:application:draft_replaced'
  | 'campaign:post:submitted'
  | 'campaign:post:verified'
  | 'campaign:post:rejected'
  | 'campaign:status:changed'
  | 'campaign:deadline:approaching'
  | 'campaign:earnings:accrued'
  | 'campaign:earnings:available'
  | 'campaign:views:updated'
  | 'campaign:post:disqualified'
  | 'campaign:leaderboard:updated'
  | 'campaign:rank:changed'
  | 'campaign:finalized'
  | 'campaign:refunded:exception'
  | 'campaign:started'
  | 'ssemble:request:progress'
  | 'ssemble:request:complete'
  | 'ssemble:request:failed';

export interface CampaignEvent {
  type: CampaignEventType;
  campaignId: string;
  campaignName?: string;
  applicationId?: string;
  creatorId?: string;
  brandId?: string;
  postId?: string;
  status?: string;
  message?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3200']).map((o: string) =>
      o.trim(),
    ),
    credentials: true,
  },
  namespace: '/campaign-events',
})
@Injectable()
export class CampaignEventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CampaignEventsGateway.name);
  private userSockets: Map<string, Set<string>> = new Map();
  private socketToUser: Map<string, string> = new Map();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  afterInit(server: Server) {
    this.logger.log(`Campaign Events WebSocket Gateway initialized for namespace /campaign-events`);
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth.token || client.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Connection rejected: No token provided for socket ${client.id}`);
        client.disconnect();
        return;
      }

      const jwtSecret = this.configService.get<string>('JWT_SECRET');
      if (!jwtSecret) {
        this.logger.error('JWT_SECRET not configured');
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, { secret: jwtSecret });
      const userId = payload.sub || payload.userId || payload.id;

      if (!userId) {
        this.logger.warn(`Connection rejected: Invalid token payload for socket ${client.id}`);
        client.disconnect();
        return;
      }

      client.join(`user:${userId}`);

      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(client.id);
      this.socketToUser.set(client.id, userId);

      this.logger.log(`Campaign client connected: ${client.id} for user ${userId}`);
    } catch (error: any) {
      this.logger.error(`Connection error for socket ${client.id}: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.socketToUser.get(client.id);

    if (userId) {
      const socketIds = this.userSockets.get(userId);
      if (socketIds) {
        socketIds.delete(client.id);
        if (socketIds.size === 0) {
          this.userSockets.delete(userId);
        }
      }
      this.logger.log(`Campaign client disconnected: ${client.id} for user ${userId}`);
    }

    this.socketToUser.delete(client.id);
  }

  /**
   * Send campaign event to a specific user
   */
  notifyUser(userId: string, event: CampaignEvent) {
    if (!this.server) {
      this.logger.warn(`Cannot notify user - WebSocket server not initialized`);
      return;
    }

    this.logger.log(`Notifying user ${userId} about campaign event: ${event.type}`);
    this.server.to(`user:${userId}`).emit('campaign-event', event);
  }

  /**
   * Send campaign event to all users subscribed to a campaign
   */
  notifyCampaign(campaignId: string, event: CampaignEvent) {
    if (!this.server) {
      this.logger.warn(`Cannot notify campaign - WebSocket server not initialized`);
      return;
    }

    this.logger.log(`Broadcasting to campaign ${campaignId}: ${event.type}`);
    this.server.to(`campaign:${campaignId}`).emit('campaign-event', event);
  }

  /**
   * Broadcast to both brand and creator
   */
  notifyParties(brandId: string, creatorId: string, event: CampaignEvent) {
    this.notifyUser(brandId, event);
    if (creatorId !== brandId) {
      this.notifyUser(creatorId, event);
    }
  }

  @SubscribeMessage('subscribe-campaign')
  handleSubscribeCampaign(client: Socket, payload: { campaignId: string }) {
    const userId = this.socketToUser.get(client.id);
    if (!userId) {
      this.logger.warn(`Unauthorized subscription attempt from socket ${client.id}`);
      return;
    }

    client.join(`campaign:${payload.campaignId}`);
    this.logger.log(`Client ${client.id} (user ${userId}) subscribed to campaign ${payload.campaignId}`);
  }

  @SubscribeMessage('unsubscribe-campaign')
  handleUnsubscribeCampaign(client: Socket, payload: { campaignId: string }) {
    const userId = this.socketToUser.get(client.id);
    if (!userId) {
      return;
    }

    client.leave(`campaign:${payload.campaignId}`);
    this.logger.log(`Client ${client.id} (user ${userId}) unsubscribed from campaign ${payload.campaignId}`);
  }

  /**
   * Emit Ssemble clip request progress update to the creator
   */
  emitSsembleRequestProgress(
    creatorId: string,
    data: { requestId: string; campaignId: string; progress: number; currentStep?: string },
  ) {
    this.notifyUser(creatorId, {
      type: 'ssemble:request:progress',
      campaignId: data.campaignId,
      data: {
        requestId: data.requestId,
        progress: data.progress,
        currentStep: data.currentStep,
      },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit Ssemble clip request completion to the creator
   */
  emitSsembleRequestComplete(
    creatorId: string,
    data: { requestId: string; campaignId: string; clipsCount: number },
  ) {
    this.notifyUser(creatorId, {
      type: 'ssemble:request:complete',
      campaignId: data.campaignId,
      message: `Your clips are ready! ${data.clipsCount} clip(s) generated.`,
      data: {
        requestId: data.requestId,
        clipsCount: data.clipsCount,
      },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit Ssemble clip request failure to the creator
   */
  emitSsembleRequestFailed(
    creatorId: string,
    data: { requestId: string; campaignId: string; error: string },
  ) {
    this.notifyUser(creatorId, {
      type: 'ssemble:request:failed',
      campaignId: data.campaignId,
      message: `Clip generation failed: ${data.error}`,
      data: {
        requestId: data.requestId,
        error: data.error,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
