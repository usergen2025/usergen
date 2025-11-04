# Multi-Tenant Workspace and Credit System

## Overview

This document explains the multi-tenant workspace and credit system implementation for UserGen.ai. The system allows users to work in both individual and team contexts, with shared resources and credit management.

## Features

### 1. Workspace Management
- **Individual Context**: Users operate with their personal account and credits
- **Team Context**: Users operate within a workspace with shared resources and credits
- **Multiple Workspaces**: Users can be members of multiple workspaces
- **Role-Based Access**: Different roles (Owner, Admin, Member, Viewer) with varying permissions

### 2. Credit System
- **Context-Aware Credits**: Credits are managed separately for individual and team contexts
- **Transaction Tracking**: Complete audit trail of all credit transactions
- **Activity Logging**: Track all actions performed in each context
- **Credit Ledger**: Detailed history of credit changes with balances

### 3. Team Collaboration
- **Invitations**: Send, accept, and manage team invitations
- **Member Management**: Add, remove, and update member roles
- **Resource Sharing**: Shared credits and resources within workspaces
- **Activity Tracking**: Track which user performed actions in team context

## Architecture

### Database Models

#### Workspace
Represents a workspace or team that users can belong to.
- `id`: Unique identifier
- `name`: Workspace name
- `description`: Workspace description
- `ownerId`: ID of the workspace owner
- `workspaceType`: INDIVIDUAL or TEAM
- `credits`: Current credit balance
- `settings`: JSON settings
- `avatar`: Workspace avatar URL
- `isActive`: Active status

#### WorkspaceMember
Represents membership of a user in a workspace.
- `id`: Unique identifier
- `workspaceId`: Workspace ID
- `userId`: User ID
- `role`: OWNER, ADMIN, MEMBER, or VIEWER
- `permissions`: JSON permissions object
- `joinedAt`: When user joined
- `invitedBy`: Who invited the user

#### TeamInvitation
Represents pending invitations to join workspaces.
- `id`: Unique identifier
- `workspaceId`: Workspace ID
- `invitedBy`: User who sent invitation
- `email`: Invited user's email
- `role`: Role assigned upon acceptance
- `token`: Unique invitation token
- `status`: PENDING, ACCEPTED, REJECTED, or EXPIRED
- `expiresAt`: Invitation expiration date

#### Transaction
Represents credit transactions (earning or spending).
- `id`: Unique identifier
- `type`: EARNED, SPENT, PURCHASED, REFUNDED, or TRANSFER
- `amount`: Credits amount (positive or negative)
- `contextType`: INDIVIDUAL or TEAM
- `userId`: User ID (for individual transactions)
- `workspaceId`: Workspace ID (for team transactions)
- `actorUserId`: User who triggered the transaction
- `activityName`: Description of the activity
- `resourceId`: ID of the generated resource
- `status`: PENDING, COMPLETED, FAILED, or CANCELLED
- `metadata`: Additional information in JSON format

#### UserActivity
Tracks all user activities in the system.
- `id`: Unique identifier
- `userId`: User who performed the action
- `workspaceId`: Workspace context (if applicable)
- `activityType`: GENERATION, DOWNLOAD, UPDATE, DELETE, INVITE, JOIN, or LEAVE
- `resourceType`: Type of resource (video, avatar, script, etc.)
- `resourceId`: ID of the resource
- `actionDetails`: Additional details in JSON
- `creditsSpent`: Credits spent on this activity
- `transactionId`: Associated transaction ID

#### WorkspaceActivity
Tracks workspace-level activities.
- `id`: Unique identifier
- `workspaceId`: Workspace ID
- `activityType`: Activity type
- `resourceType`: Resource type
- `resourceId`: Resource ID
- `actorUserId`: User who performed the action
- `actionDetails`: Additional details
- `creditsSpent`: Credits spent
- `transactionId`: Associated transaction ID

#### CreditLedger
Audit trail of all credit changes.
- `id`: Unique identifier
- `entityType`: USER or WORKSPACE
- `entityId`: User or workspace ID
- `transactionId`: Associated transaction
- `balanceBefore`: Balance before the transaction
- `balanceAfter`: Balance after the transaction
- `change`: Amount of change
- `description`: Description of the change

## API Endpoints

### Workspace Management

#### Create Workspace
```
POST /api/workspaces
Body: {
  "name": "My Workspace",
  "description": "Team workspace for AI content",
  "workspaceType": "TEAM"
}
```

#### Get My Workspaces
```
GET /api/workspaces
Response: Array of workspaces user is a member of
```

#### Get Workspace Details
```
GET /api/workspaces/:workspaceId
Response: Workspace details with member count
```

#### Update Workspace
```
PATCH /api/workspaces/:workspaceId
Body: {
  "name": "Updated Name",
  "description": "Updated description"
}
```

#### Delete Workspace
```
DELETE /api/workspaces/:workspaceId
Note: Only workspace owner can delete
```

#### Get Workspace Members
```
GET /api/workspaces/:workspaceId/members
Response: Array of members with their roles
```

#### Remove Member
```
DELETE /api/workspaces/:workspaceId/members/:memberId
Note: Only owner or admin can remove members
```

#### Leave Workspace
```
POST /api/workspaces/:workspaceId/leave
Note: Owner cannot leave
```

#### Update Member Role
```
PATCH /api/workspaces/:workspaceId/members/:memberId/role
Body: {
  "role": "ADMIN"
}
Note: Only owner can update roles
```

#### Get Workspace Credits
```
GET /api/workspaces/:workspaceId/credits
Response: Current workspace credits
```

### Invitation Management

#### Send Invitation
```
POST /api/invitations/workspaces/:workspaceId/invite
Body: {
  "email": "user@example.com",
  "role": "MEMBER"
}
```

#### Accept Invitation
```
POST /api/invitations/accept/:token
```

#### Reject Invitation
```
POST /api/invitations/reject/:token
```

#### Get Workspace Invitations
```
GET /api/invitations/workspaces/:workspaceId
Response: Array of pending and expired invitations
```

#### Cancel Invitation
```
DELETE /api/invitations/:invitationId
```

#### Resend Invitation
```
POST /api/invitations/:invitationId/resend
Response: New invitation token
```

### Credit Management

#### Deduct Credits
```
POST /api/transactions/deduct
Body: {
  "workspaceId": "workspace-id", // Optional
  "amount": 10,
  "activityName": "Video Generation",
  "resourceId": "resource-id",
  "metadata": {}
}
```

#### Add Credits
```
POST /api/transactions/add
Body: {
  "workspaceId": "workspace-id", // Optional
  "amount": 100,
  "description": "Credits purchased",
  "metadata": {}
}
```

#### Check Balance
```
GET /api/transactions/balance?workspaceId=workspace-id
Response: Current credit balance and context
```

#### Get Transaction History
```
GET /api/transactions/history?workspaceId=workspace-id&limit=50
Response: Array of transactions
```

#### Get Credit Ledger
```
GET /api/transactions/ledger?workspaceId=workspace-id&limit=100
Response: Array of ledger entries
```

### Context Switching

#### Switch Context
```
POST /api/auth/context?workspaceId=workspace-id
Response: {
  "currentContext": {
    "type": "TEAM",
    "workspaceId": "workspace-id",
    "role": "OWNER"
  },
  "workspace": {
    "id": "workspace-id",
    "name": "My Workspace",
    "credits": 500
  },
  "tokens": {
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

## User Flow

### Individual Context
1. User logs in → Gets JWT with individual context
2. User creates resources → Uses personal credits
3. User performs actions → Tracked in personal activity log
4. All actions use `userId` and `contextType: INDIVIDUAL`

### Team Context
1. User creates/joins workspace → Becomes member
2. User switches to workspace context → Gets new JWT with team context
3. User creates resources → Uses workspace credits
4. Actions tracked with `workspaceId` and `actorUserId`

## Context Switching Flow

1. **Initial Login**: JWT contains individual context (default)
2. **User Switches to Team**: 
   - Calls `POST /api/auth/context?workspaceId=xyz`
   - Receives new JWT with team context
   - Frontend stores new token
3. **All Subsequent Requests**: Use new JWT with team context
4. **Credits Checked**: From workspace instead of user
5. **Actions Tracked**: In workspace with actor user ID

## Permission Levels

### OWNER
- Full control over workspace
- Can delete workspace
- Can change member roles
- Can remove any member
- Cannot be removed or change own role

### ADMIN
- Can invite and remove members
- Can update workspace settings
- Can view all transactions and activities
- Cannot delete workspace or change owner role

### MEMBER
- Can use workspace resources
- Can generate content using workspace credits
- Can leave workspace
- Cannot invite or remove members

### VIEWER
- Can view workspace resources
- Cannot generate content
- Cannot invite or remove members

## Credit System

### Earning Credits
- Purchasing credits (via payment service)
- Promotional credits
- Refunds

### Spending Credits
- Video generation
- Avatar creation
- Voice cloning
- Other AI services

### Transaction Flow
1. Check balance (user or workspace credits)
2. Verify sufficient balance
3. Deduct credits atomically
4. Create transaction record
5. Create credit ledger entry
6. Publish event to message queue
7. Return remaining balance

### Audit Trail
Every credit transaction creates:
1. **Transaction Record**: Type, amount, context, status
2. **Credit Ledger Entry**: Balance before/after, change amount
3. **Activity Record**: What action was performed
4. **Message Queue Event**: For other services to consume

## Security Considerations

### Access Control
- Users can only access workspaces they're members of
- JWT validation includes context information
- Each request validates workspace membership
- Role-based permissions enforced at service layer

### Data Isolation
- Personal account data separate from workspace data
- Workspace members see shared resources only
- Personal resources not visible to workspace members

### Credit Protection
- Atomic operations for credit deduction
- Balance verification before deduction
- Transaction rollback on failure
- Complete audit trail for all changes

## Integration with Other Services

### AI Content Service
- Call `POST /api/transactions/deduct` before generation
- Pass resource details in metadata
- Link transaction to generated resource

### Payment Service
- Call `POST /api/transactions/add` on successful payment
- Link transaction to payment record
- Publish credit purchased event

### Notification Service
- Listen for credit low balance events
- Notify user when team credits are low
- Send invitation acceptance notifications

## Example Use Cases

### Use Case 1: User Creates Team
1. User calls `POST /api/workspaces`
2. Workspace created with 0 credits
3. User automatically becomes owner
4. User switches context to team
5. All subsequent actions use workspace credits

### Use Case 2: Invite Team Member
1. Owner calls `POST /api/invitations/workspaces/{id}/invite` with email
2. Invitation created with token
3. Email sent to invitee
4. Invitee calls `POST /api/invitations/accept/{token}`
5. Invitee becomes member
6. Event published to message queue

### Use Case 3: Generate Video in Team
1. User (in team context) initiates video generation
2. AI service calls `POST /api/transactions/deduct` with workspaceId
3. Transaction service checks workspace credits
4. Credits deducted atomically
5. Transaction and activity records created
6. Video generation proceeds

### Use Case 4: Switch Between Contexts
1. User is in team context (creating videos for work)
2. User calls `POST /api/auth/context` (no workspaceId)
3. Returns to individual context
4. User now uses personal credits
5. Personal activity log updated

## Monitoring and Analytics

### Metrics to Track
- Credits purchased per user/workspace
- Credits spent per service type
- Workspace activity levels
- Invitation acceptance rates
- Context switching frequency
- Credit balance distribution

### Dashboards
- Workspace usage dashboard
- Credit consumption dashboard
- Member activity dashboard
- Transaction history dashboard

## Migration Notes

### Existing Users
- All users start with default 100 credits
- Context defaults to INDIVIDUAL
- No existing behavior changes

### New Features
- Workspace features are additive
- Users can continue using individual mode
- No breaking changes to existing endpoints

## Testing

### Unit Tests
- Workspace CRUD operations
- Member management
- Credit transactions
- Permission checks
- Invitation flows

### Integration Tests
- Context switching flow
- Credit deduction in both contexts
- Team collaboration scenarios
- Permission enforcement

### E2E Tests
- Full user journey: create workspace → invite → generate content
- Context switching → different credit sources
- Multiple workspaces → switching between them

## Troubleshooting

### Common Issues

1. **"Insufficient Credits" when workspace has credits**
   - Check if user is in team context
   - Verify JWT contains correct workspaceId
   - Check workspace membership

2. **"Not a member of workspace"**
   - Verify invitation was accepted
   - Check workspaceMember table
   - Ensure JWT includes membership

3. **Context not switching**
   - Call `POST /api/auth/context` again
   - Get new JWT token
   - Update frontend token storage

## Future Enhancements

1. **Credit Transfer**: Transfer credits between workspaces
2. **Billing History**: Invoice generation for workspaces
3. **Credit Packages**: Buy bulk credits for teams
4. **Credit Limits**: Set per-user or per-workspace limits
5. **Analytics Dashboard**: Advanced reporting for workspace usage
6. **Webhooks**: Notify on low credits, member added, etc.


