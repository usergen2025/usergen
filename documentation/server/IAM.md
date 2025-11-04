# Identity and Access Management (IAM)

## Overview
The IAM service provides centralized authorization for all microservices in UserGen.ai. It manages permissions, roles, policies, and access control across the platform.

## Service Details

- **Port**: 3005
- **Database**: `usergen_iam`
- **Purpose**: Authorization, permission management, role-based access control

## Core Concepts

### Permissions
Granular actions users can perform (e.g., `video.generate`, `project.delete`).

### Roles
Collections of permissions assigned to users in specific contexts.

### Policies
Rules that grant/deny permissions based on conditions (time, user list, etc.).

### User Roles
Direct assignments of roles to users in specific contexts (workspace, project, etc.).

## API Endpoints

### Permissions
```
GET    /api/permissions              List all permissions
GET    /api/permissions/:id          Get permission details
POST   /api/permissions              Create permission
PUT    /api/permissions/:id          Update permission
DELETE /api/permissions/:id          Delete permission
```

### Roles
```
GET    /api/roles                    List all roles
GET    /api/roles/:id                Get role with permissions
POST   /api/roles                    Create role
PUT    /api/roles/:id                Update role
DELETE /api/roles/:id                Delete role
GET    /api/roles/:id/permissions    Get role permissions
POST   /api/roles/:id/permissions    Add permission to role
DELETE /api/roles/:id/permissions/:permId  Remove permission
```

### Policies
```
GET    /api/policies                 List policies
GET    /api/policies/:id             Get policy details
POST   /api/policies                 Create policy
PUT    /api/policies/:id              Update policy
DELETE /api/policies/:id              Delete policy
```

### Access Control
```
POST   /api/access/check             Check single permission
POST   /api/access/batch-check       Check multiple permissions
GET    /api/access/user/:userId/permissions  Get user's effective permissions
```

## Usage Examples

### Creating Permissions
```bash
curl -X POST http://localhost:8000/api/permissions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "video.generate",
    "resource": "video",
    "action": "generate",
    "description": "Generate video content"
  }'
```

### Creating Roles
```bash
curl -X POST http://localhost:8000/api/roles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "workspace.member",
    "displayName": "Workspace Member",
    "context": "workspace",
    "description": "Default member permissions"
  }'
```

### Checking Permissions
```bash
curl -X POST http://localhost:8000/api/access/check \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "resourceType": "workspace",
    "resourceId": "workspace-456",
    "permission": "video.generate"
  }'
```

## Default System Roles

### Workspace Context
- **owner**: Full control (`*` permission)
- **admin**: Manage workspace, members, projects (no delete)
- **member**: Create projects, generate content
- **viewer**: View-only access

### Global Context
- **user**: Basic user permissions
- **premium**: Premium feature access
- **admin**: Platform administrator

## How Services Communicate with IAM

Other services call IAM via HTTP to check permissions:

```typescript
// In any microservice
async function checkPermission(userId, workspaceId, permission) {
  const response = await axios.post(
    `${IAM_SERVICE_URL}/api/access/check`,
    {
      userId,
      resourceType: 'workspace',
      resourceId: workspaceId,
      permission,
    }
  );
  return response.data.granted;
}
```

## Integration Guide

1. **Add IAM dependency** to service's `docker-compose.yml`
2. **Set IAM_SERVICE_URL** environment variable
3. **Create HTTP client** to call IAM service
4. **Check permissions** before sensitive operations
5. **Handle denied access** appropriately

## Benefits

- Centralized authorization logic
- Single source of truth for permissions
- Audit trail for all access checks
- Flexible role/policy system
- Reusable across all services

