# API Integration Guide

## Overview
This guide helps frontend developers integrate with the UserGen.ai backend API through the API Gateway.

## Base Configuration

### API Gateway URL
```
Development: http://localhost:8000/api
Production: https://api.usergen.ai/api
```

### Headers Required
All API requests should include:

```typescript
{
  'Content-Type': 'application/json',
  'Authorization': 'Bearer <jwt_token>',
  'X-Request-ID': '<optional-unique-id>' // For request tracking
}
```

## Authentication

### Login Flow
```typescript
// POST /api/auth/login
const response = await fetch('http://localhost:8000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123'
  })
});

// Response
{
  success: true,
  data: {
    accessToken: 'eyJhbGci...',
    refreshToken: 'refresh_token_here',
    user: {
      id: 'user_123',
      email: 'user@example.com',
      name: 'John Doe'
    }
  }
}
```

### Using the Token
Store the `accessToken` and include it in subsequent requests:

```typescript
const response = await fetch('http://localhost:8000/api/workspaces', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
});
```

See [Authentication Guide](./AUTHENTICATION.md) for complete auth flow.

## Common API Patterns

### GET Request
```typescript
async function fetchWorkspaces() {
  const response = await fetch('http://localhost:8000/api/workspaces', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  const result = await response.json();
  return result.data; // Array of workspaces
}
```

### POST Request
```typescript
async function createWorkspace(name: string) {
  const response = await fetch('http://localhost:8000/api/workspaces', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, description: '' })
  });
  
  const result = await response.json();
  return result.data; // Created workspace
}
```

### Error Handling
```typescript
async function apiCall() {
  try {
    const response = await fetch(url, options);
    const result = await response.json();
    
    if (!response.ok || !result.success) {
      throw new Error(result.error?.message || 'Request failed');
    }
    
    return result.data;
  } catch (error) {
    // Handle error
    console.error('API Error:', error);
    throw error;
  }
}
```

## Context Switching (Individual vs Workspace)

When operating in workspace context, include workspace ID in headers or request:

```typescript
// Get workspace-specific resources
const response = await fetch(
  `http://localhost:8000/api/workspaces/${workspaceId}/projects`,
  {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Workspace-Id': workspaceId // Optional header
    }
  }
);
```

## Response Types

### Success Response
```typescript
{
  success: true,
  data: { /* response data */ },
  meta?: { /* pagination, etc */ }
}
```

### Error Response
```typescript
{
  success: false,
  error: {
    message: 'Error description',
    code: 'ERROR_CODE',
    details: { /* additional error details */ }
  }
}
```

## Rate Limiting

The API has rate limits. You'll receive a 429 status code if exceeded:

```typescript
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  // Wait and retry
}
```

## Next Steps

- [Authentication Guide](./AUTHENTICATION.md) - Detailed auth implementation
- [Workspaces](./WORKSPACES.md) - Workspace API integration
- [Credits](./CREDITS.md) - Credit system integration
- [Error Handling](./ERROR_HANDLING.md) - Comprehensive error handling


