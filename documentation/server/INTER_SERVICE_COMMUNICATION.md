# Inter-Service Communication

## Overview
UserGen.ai uses a microservices architecture where services communicate through:
1. **HTTP REST APIs** (synchronous)
2. **RabbitMQ message queue** (asynchronous/events)
3. **Shared databases** (via service boundaries)

## Communication Patterns

### 1. Direct HTTP Calls

Services make HTTP requests to each other for real-time operations.

#### Example: Workspace Service → Auth Service
```typescript
// In workspace-service
const response = await httpService.get(
  `${AUTH_SERVICE_URL}/api/users/${userId}`
);
```

#### Example: AI Content Service → Payment Wallet Service
```typescript
// Before generating content, check/deduct credits
const response = await httpService.post(
  `${PAYMENT_WALLET_SERVICE_URL}/api/transactions/deduct`,
  { userId, workspaceId, amount: 10 }
);
```

### 2. Event-Driven (RabbitMQ)

Services publish events that other services consume.

#### Example: User Created Event
```typescript
// auth-service publishes
await messageQueue.publish('user.created', {
  userId: user.id,
  email: user.email,
  name: user.name,
});

// workspace-service consumes
@RabbitSubscribe('user.created')
async handleUserCreated(data: { userId: string }) {
  await this.workspaceService.createDefaultWorkspace(data.userId);
}
```

#### Example: Transaction Completed Event
```typescript
// payment-wallet-service publishes
await messageQueue.publish('transaction.completed', {
  userId,
  amount: -10,
  activityName: 'Video Generated',
});

// activity-service consumes
@RabbitSubscribe('transaction.completed')
async logActivity(data: TransactionEvent) {
  await this.activitiesService.create({
    userId: data.userId,
    activityType: 'CREDIT_DEDUCTED',
    metadata: data,
  });
}
```

### 3. API Gateway (Kong)

All external requests go through Kong which routes to appropriate services.

```
Client Request
    ↓
API Gateway (Kong:8000)
    ↓
Microservice (auth-service:3000)
    ↓
Response
```

## Service Dependency Graph

```
┌─────────────────────────────────────┐
│         API Gateway (Kong)           │
│         Port: 8000                   │
└─────────────────────────────────────┘
           │
           ├─────────────────────┬────────────┬────────────┬────────────┐
           │                     │            │            │            │
           ▼                     ▼            ▼            ▼            ▼
    ┌─────────┐         ┌─────────┐   ┌──────┐   ┌──────────┐  ┌──────┐
    │  Auth   │────────▶│   IAM   │   │Worksp│   │ Payment  │  │ AI   │
    │ Service │         │ Service │   │  ace │   │  Wallet  │  │Content│
    └─────────┘         └─────────┘   └──────┘   └──────────┘  └──────┘
         │                   │            │            │            │
         │                   │            │            │            │
         └───────────────────┴────────────┴────────────┴────────────┘
                       │
                       ▼
              ┌──────────────┐
              │  Activity   │
              │   Service   │
              └──────────────┘

Legend:
  ──▶  Direct HTTP calls
  ──▶▶ Event-driven (RabbitMQ)
```

## Service-to-Service Communication Examples

### Auth Service
**Provides**: User authentication, JWT tokens, user info
**Consumes**: None
**Used by**: All services (via JWT validation)

### IAM Service
**Provides**: Permission checking, role management
**Consumes**: None
**Used by**: All services that need authorization

### Workspace Service
**Provides**: Workspace management, member management
**Consumes**: 
- Auth Service (user validation)
- IAM Service (permission checks)
**Used by**: AI Content Service, Activity Service

### Payment Wallet Service
**Provides**: Credit management, transactions
**Consumes**:
- Auth Service (user validation)
- Workspace Service (workspace existence)
**Used by**: AI Content Service, Activity Service (via events)

### AI Content Service
**Provides**: Video generation, avatar creation
**Consumes**:
- Auth Service (user validation)
- Workspace Service (workspace/member checks)
- IAM Service (permission checks)
- Payment Wallet Service (credit deduction)
**Publishes**: Content generation events

### Activity Service
**Provides**: Activity logging
**Consumes**: Events from all services
**Publishes**: None

## Environment Variables for Inter-Service Calls

Each service declares its dependencies:

```yaml
# workspace-service environment
AUTH_SERVICE_URL=http://auth-service:3000
IAM_SERVICE_URL=http://iam-service:3005

# payment-wallet-service environment
AUTH_SERVICE_URL=http://auth-service:3000
WORKSPACE_SERVICE_URL=http://workspace-service:3001

# ai-content-service environment
AUTH_SERVICE_URL=http://auth-service:3000
IAM_SERVICE_URL=http://iam-service:3005
PAYMENT_WALLET_SERVICE_URL=http://payment-wallet-service:3002
```

## Common Communication Patterns

### 1. Permission Check Pattern
```typescript
// Before performing action, check permission
async function generateVideo(userId, workspaceId) {
  // Check permission via IAM
  const hasPermission = await iamClient.checkPermission({
    userId,
    resourceType: 'workspace',
    resourceId: workspaceId,
    permission: 'video.generate',
  });
  
  if (!hasPermission) throw new ForbiddenException();
  
  // Proceed with action
}
```

### 2. Credit Deduction Pattern
```typescript
// Deduct credits before resource generation
async function generateVideo(userId, workspaceId) {
  // Deduct credits
  await paymentClient.deductCredits({
    userId,
    workspaceId,
    amount: 10,
    activityName: 'Video Generation',
  });
  
  // Generate video
  const video = await this.videoService.generate(prompt);
  
  return video;
}
```

### 3. Event Publishing Pattern
```typescript
// After completing action, publish event
async function createWorkspace(data) {
  const workspace = await this.workspaceService.create(data);
  
  // Publish event for other services
  await messageQueue.publish('workspace.created', {
    workspaceId: workspace.id,
    ownerId: data.ownerId,
  });
  
  return workspace;
}
```

## Error Handling

### HTTP Service Unavailable
```typescript
try {
  await otherService.call();
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    throw new InternalServerErrorException('Service unavailable');
  }
}
```

### Service Timeout
```typescript
const response = await httpService.get(url, {
  timeout: 5000, // 5 seconds
});
```

## Testing Inter-Service Communication

### Local Testing
All services run on Docker network `usergen-network`:
- Service URLs: `http://service-name:port`
- Example: `http://auth-service:3000`

### External Testing
Via API Gateway: `http://localhost:8000/api/...`

## Best Practices

1. Use HTTP for synchronous operations
2. Use message queue for async operations
3. Implement retries for critical operations
4. Set timeouts on all HTTP calls
5. Log all inter-service calls
6. Handle failures gracefully
7. Use circuit breakers for resilience
8. Validate data from other services

