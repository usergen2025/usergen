# Workspace Management

## Overview
UserGen.ai supports multi-tenant workspaces where users can create teams, collaborate, and share resources.

## Features
- **Individual Context**: Users have personal accounts with their own credits
- **Team Workspaces**: Users can create/join workspaces with shared credits
- **Role-Based Access**: OWNER, ADMIN, MEMBER, VIEWER
- **Member Management**: Add, remove, update roles
- **Invitations**: Email-based team invitations

## API Endpoints

### Workspaces
```
POST   /api/workspaces             Create workspace
GET    /api/workspaces/user/:id    Get user's workspaces
GET    /api/workspaces/:id         Get workspace details
PATCH  /api/workspaces/:id         Update workspace
DELETE /api/workspaces/:id         Delete workspace
```

### Members
```
GET    /api/workspaces/:id/members      List members
DELETE /api/workspaces/:id/members/:id  Remove member
PATCH  /api/workspaces/:id/leave        Leave workspace
PATCH  /api/workspaces/:id/members/:id/role  Update role
```

### Invitations
```
POST   /api/invitations/workspaces/:id  Send invitation
POST   /api/invitations/accept/:token   Accept invitation
POST   /api/invitations/reject/:token   Reject invitation
GET    /api/invitations/workspaces/:id  List invitations
```

## Usage Example

### Create Workspace
```bash
curl -X POST http://localhost:8000/api/workspaces?userId=user-123 \
  -H "Content-Type: application/json" \
  -d '{"name": "My Team", "description": "Team workspace"}'
```

### Add Member via Invitation
```bash
curl -X POST http://localhost:8000/api/invitations/workspaces/workspace-id?userId=owner-id \
  -H "Content-Type: application/json" \
  -d '{"email": "member@example.com", "role": "MEMBER"}'
```

## Roles
- **OWNER**: Full control, can delete workspace
- **ADMIN**: Can manage members, cannot delete workspace
- **MEMBER**: Can use resources, cannot manage
- **VIEWER**: Read-only access

## Context Switching
Users operate in either:
- **Individual context**: Uses personal credits
- **Team context**: Uses workspace credits

All activities are tracked per context.

