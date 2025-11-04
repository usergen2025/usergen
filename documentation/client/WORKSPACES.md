# Workspace API Integration

## Overview
Frontend integration guide for workspace management API, including responses and data structures.

## Endpoints

### List User's Workspaces
```typescript
GET /api/workspaces/user/:userId

Response:
{
  success: true,
  data: [
    {
      id: string;
      name: string;
      description?: string;
      ownerId: string;
      workspaceType: 'INDIVIDUAL' | 'TEAM';
      isActive: boolean;
      createdAt: string;
      memberCount?: number;
    }
  ]
}
```

### Get Workspace Details
```typescript
GET /api/workspaces/:id

Response:
{
  success: true,
  data: {
    id: string;
    name: string;
    description?: string;
    ownerId: string;
    workspaceType: 'INDIVIDUAL' | 'TEAM';
    members: Array<{
      id: string;
      userId: string;
      role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
      joinedAt: string;
    }>;
    createdAt: string;
    updatedAt: string;
  }
}
```

### Create Workspace
```typescript
POST /api/workspaces?userId=:userId

Request Body:
{
  name: string;
  description?: string;
  workspaceType?: 'INDIVIDUAL' | 'TEAM';
}

Response:
{
  success: true,
  data: {
    id: string;
    name: string;
    description?: string;
    ownerId: string;
    workspaceType: 'TEAM';
    createdAt: string;
  }
}
```

### Update Workspace
```typescript
PATCH /api/workspaces/:id

Request Body:
{
  name?: string;
  description?: string;
}

Response:
{
  success: true,
  data: { /* updated workspace */ }
}
```

### Delete Workspace
```typescript
DELETE /api/workspaces/:id

Response:
{
  success: true,
  data: { message: 'Workspace deleted' }
}
```

## Member Management

### List Workspace Members
```typescript
GET /api/workspaces/:id/members

Response:
{
  success: true,
  data: [
    {
      id: string;
      userId: string;
      userName?: string;
      userEmail?: string;
      role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
      joinedAt: string;
    }
  ]
}
```

### Remove Member
```typescript
DELETE /api/workspaces/:id/members/:memberId

Response:
{
  success: true,
  data: { message: 'Member removed' }
}
```

### Update Member Role
```typescript
PATCH /api/workspaces/:id/members/:memberId/role

Request Body:
{
  role: 'ADMIN' | 'MEMBER' | 'VIEWER';
}

Response:
{
  success: true,
  data: { /* updated member */ }
}
```

## Invitations

### Send Invitation
```typescript
POST /api/invitations/workspaces/:workspaceId?userId=:userId

Request Body:
{
  email: string;
  role: 'ADMIN' | 'MEMBER' | 'VIEWER';
}

Response:
{
  success: true,
  data: {
    id: string;
    email: string;
    role: string;
    status: 'PENDING';
    expiresAt: string;
  }
}
```

### Accept Invitation
```typescript
POST /api/invitations/accept/:token

Response:
{
  success: true,
  data: {
    workspace: { /* workspace details */ },
    message: 'Invitation accepted'
  }
}
```

### List Invitations
```typescript
GET /api/invitations/workspaces/:workspaceId

Response:
{
  success: true,
  data: [
    {
      id: string;
      email: string;
      role: string;
      status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
      createdAt: string;
    }
  ]
}
```

## Frontend Implementation Example

```typescript
// React example
function WorkspaceList() {
  const [workspaces, setWorkspaces] = useState([]);
  const token = localStorage.getItem('accessToken');
  const userId = getUserId(); // From auth context

  useEffect(() => {
    fetch(`http://localhost:8000/api/workspaces/user/${userId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          setWorkspaces(result.data);
        }
      });
  }, []);

  return (
    <div>
      {workspaces.map(ws => (
        <WorkspaceCard key={ws.id} workspace={ws} />
      ))}
    </div>
  );
}
```

## Context Switching

When user selects a workspace:

```typescript
async function switchToWorkspace(workspaceId: string) {
  const response = await fetch('http://localhost:8000/api/auth/context', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ workspaceId })
  });
  
  const result = await response.json();
  
  if (result.success) {
    // Update token and context
    localStorage.setItem('accessToken', result.data.accessToken);
    setCurrentContext({
      type: 'workspace',
      workspaceId: workspaceId,
      role: result.data.context.role
    });
  }
}
```


