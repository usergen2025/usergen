# Frontend Authentication Guide

## Overview
This guide covers authentication flows for the frontend application, including login, registration, token management, and context switching.

## Authentication Endpoints

### Register User
```typescript
POST /api/auth/register

Request:
{
  name: string;
  email: string;
  password: string;
  mobile?: string;
}

Response:
{
  success: true,
  data: {
    user: {
      id: string;
      email: string;
      name: string;
    },
    message: 'Registration successful'
  }
}
```

### Login
```typescript
POST /api/auth/login

Request:
{
  email: string;
  password: string;
}

Response:
{
  success: true,
  data: {
 oasisToken: string;      // JWT access token
    refreshToken: string;    // Refresh token
    user: {
      id: string;
      email: string;
      name: string;
      credits: number;
    }
  }
}
```

### Refresh Token
```typescript
POST /api/auth/refresh

Request:
{
  refreshToken: string;
}

Response:
{
  success: true,
  data: {
    accessToken: string;
    refreshToken: string;
  }
}
```

## Token Storage

### Recommended Approach
Store tokens securely:

```typescript
// Browser localStorage (for web apps)
localStorage.setItem('accessToken', token);
localStorage.setItem('refreshToken', refreshToken);

// Or use httpOnly cookies (more secure)
// Tokens set by backend via Set-Cookie header
```

### Token Expiry
- **Access Token**: Expires in 24 hours (default)
- **Refresh Token**: Expires in 7 days (default)

Handle token expiry:

```typescript
async function apiCallWithRefresh(url: string) {
  let accessToken = localStorage.getItem('accessToken');
  
  let response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  // If token expired, refresh it
  if (response.status === 401) {
    const refreshResponse = await refreshAccessToken();
    accessToken = refreshResponse.data.accessToken;
    localStorage.setItem('accessToken', accessToken);
    
    // Retry original request
    response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
  }
  
  return response;
}
```

## Logout

```typescript
POST /api/auth/logout

Request Headers:
{
  'Authorization': 'Bearer <access_token>'
}

// Also clear local storage
localStorage.removeItem('accessToken');
localStorage.removeItem('refreshToken');
localStorage.removeItem('user');
```

## Protected Routes

### Check Authentication Status
```typescript
function isAuthenticated(): boolean {
  const token = localStorage.getItem('accessToken');
  if (!token) return false;
  
  // Optionally verify token hasn't expired
  const payload = JSON.parse(atob(token.split('.')[1]));
  return payload.exp * 1000 > Date.now();
}
```

### Route Guard Example (React)
```typescript
function ProtectedRoute({ children }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" />;
  }
  return children;
}
```

## Context Switching

Users can switch between individual and workspace contexts:

```typescript
// Set workspace context
POST /api/auth/context

Request:
{
  workspaceId: string;  // null for individual context
}

Response:
{
  success: true,
  data: {
 hodToken: string;      // New token with context
    context: {
      type: 'individual' | 'workspace',
      workspaceId?: string,
      role?: string
    }
  }
}
```

Store context in local state:
```typescript
const [context, setContext] = useState({
  type: 'individual',
  workspaceId: null
});
```

## Error Codes

- `INVALID_CREDENTIALS` - Wrong email/password
- `TOKEN_EXPIRED` - Access token expired
- `TOKEN_INVALID` - Invalid token format
- `USER_NOT_FOUND` - User doesn't exist
- `EMAIL_NOT_VERIFIED` - Email verification required

## Security Best Practices

1. **Never commit tokens** to version control
2. **Use HTTPS** in production
3. **Refresh tokens** before expiry
4. **Clear tokens** on logout
5. **Validate tokens** client-side (basic expiry check)
6. **Handle 401 errors** gracefully with token refresh


