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

export interface JobStatusUpdate {
  jobId: string;
  queueType: 'audio-generation' | 'image-generation' | 'video-generation' | 'scene-composite' | 'stock-download';
  state: 'completed' | 'failed' | 'processing' | 'progress';
  result?: any;
  progress?: number;
  error?: string;
  metadata?: {
    retryable?: boolean;
    errorType?: string;
    [key: string]: any;
  };
}

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3200']).map((o: string) => o.trim()),
    credentials: true,
  },
  namespace: '/job-status',
})
@Injectable()
export class JobStatusGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(JobStatusGateway.name);
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds
  private socketToUser: Map<string, string> = new Map(); // socketId -> userId

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  afterInit(server: Server) {
    this.logger.log(`WebSocket Gateway initialized for namespace /job-status`);
    this.logger.log(`Server instance: ${server ? 'available' : 'undefined'}`);
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || 
                   client.handshake.headers.authorization?.replace('Bearer ', '');
      
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

      // Join user-specific room
      client.join(`user:${userId}`);
      
      // Track socket for this user
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(client.id);
      this.socketToUser.set(client.id, userId);

      this.logger.log(`Client connected: ${client.id} for user ${userId}`);
      
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
      this.logger.log(`Client disconnected: ${client.id} for user ${userId}`);
    } else {
      this.logger.log(`Client disconnected: ${client.id} (unknown user)`);
    }
    
    this.socketToUser.delete(client.id);
  }

  /**
   * Send job status update to user
   */
  async notifyJobStatus(userId: string, data: JobStatusUpdate) {
    // Check if server is initialized - it might be undefined in worker threads
    if (!this.server) {
      this.logger.warn(`Cannot notify job status - WebSocket server not initialized for job ${data.jobId}`);
      return;
    }

    this.logger.log(`Notifying user ${userId} about job ${data.jobId}: ${data.state}`);
    
    try {
      // Try to get room info for logging (might fail if adapter not ready, but that's OK)
      let userRoomSize = 0;
      let jobRoomSize = 0;
      try {
        if (this.server.sockets?.adapter?.rooms) {
          const userRoom = this.server.sockets.adapter.rooms.get(`user:${userId}`);
          const jobRoom = this.server.sockets.adapter.rooms.get(`job:${data.jobId}`);
          userRoomSize = userRoom?.size || 0;
          jobRoomSize = jobRoom?.size || 0;
        }
      } catch (e) {
        // Adapter not ready yet, but we can still emit
        this.logger.debug(`Adapter not ready for room info, but continuing with emit`);
      }
      
      console.log(`[JobStatusGateway] 📤 Emitting to user ${userId}:`, {
        jobId: data.jobId,
        queueType: data.queueType,
        state: data.state,
        sceneNumber: data.queueType === 'image-generation' ? data.result?.image?.sceneNumber : data.queueType === 'video-generation' ? data.result?.video?.sceneNumber : undefined,
        localUrl: data.queueType === 'image-generation' ? data.result?.image?.localUrl : data.queueType === 'video-generation' ? data.result?.video?.localUrl : undefined,
        userRoomSize,
        jobRoomSize,
      });
      
      // Emit directly to rooms - this works even if adapter isn't fully initialized
      // The server.to() method doesn't require adapter to be ready
      this.server.to(`user:${userId}`).emit('job-status-update', data);
      this.server.to(`job:${data.jobId}`).emit('job-status-update', data);
      
      console.log(`[JobStatusGateway] ✅ WebSocket event emitted`);
    } catch (error: any) {
      this.logger.error(`Failed to emit WebSocket event for job ${data.jobId}:`, error.message);
    }
  }

  /**
   * Handle client subscription to specific job
   */
  @SubscribeMessage('subscribe-job')
  async handleSubscribeJob(client: Socket, payload: { jobId: string; queueType: string }) {
    const userId = this.socketToUser.get(client.id);
    if (!userId) {
      this.logger.warn(`Unauthorized subscription attempt from socket ${client.id}`);
      return;
    }
    
    client.join(`job:${payload.jobId}`);
    this.logger.log(`Client ${client.id} (user ${userId}) subscribed to job ${payload.jobId}`);
  }

  /**
   * Handle client unsubscription from specific job
   */
  @SubscribeMessage('unsubscribe-job')
  async handleUnsubscribeJob(client: Socket, payload: { jobId: string }) {
    const userId = this.socketToUser.get(client.id);
    if (!userId) {
      this.logger.warn(`Unauthorized unsubscription attempt from socket ${client.id}`);
      return;
    }
    
    client.leave(`job:${payload.jobId}`);
    this.logger.log(`Client ${client.id} (user ${userId}) unsubscribed from job ${payload.jobId}`);
  }
}

