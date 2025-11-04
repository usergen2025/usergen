# Error Handling Guide

## Overview
Comprehensive guide for handling API errors in the frontend application.

## Standard Error Response Format

All errors follow this structure:

```typescript
{
  success: false,
  error: {
    message: string;        // Human-readable error message
    code?: string;          // Error code (for programmatic handling)
    details?: any;          // Additional error details
  }
}
```

## HTTP Status Codes

| Status | Meaning | Common Causes |
|--------|---------|---------------|
| 200 | Success | Request completed successfully |
| 400 | Bad Request | Invalid request data |
| 401 | Unauthorized | Missing/invalid token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Resource conflict (e.g., duplicate) |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Internal server error |

## Common Error Codes

### Authentication Errors
- `INVALID_CREDENTIALS` - Wrong email/password
- `TOKEN_EXPIRED` - Access token expired
- `TOKEN_INVALID` - Invalid token format
- `USER_NOT_FOUND` - User doesn't exist
- `EMAIL_NOT_VERIFIED` - Email verification required

### Authorization Errors
- `INSUFFICIENT_PERMISSIONS` - User lacks required permission
- `WORKSPACE_ACCESS_DENIED` - Not a member of workspace
- `ROLE_INSUFFICIENT` - User role too low for action

### Resource Errors
- `WORKSPACE_NOT_FOUND` - Workspace doesn't exist
- `MEMBER_NOT_FOUND` - Member not found
- `INVITATION_NOT_FOUND` - Invitation doesn't exist
- `INSUFFICIENT_CREDITS` - Not enough credits

### Validation Errors
- `VALIDATION_FAILED` - Request validation failed
- `EMAIL_INVALID` - Invalid email format
- `PASSWORD_TOO_WEAK` - Password doesn't meet requirements

## Error Handling Implementation

### Basic Error Handler
```typescript
async function handleApiCall<T>(
  apiCall: () => Promise<Response>
): Promise<T> {
  try {
    const response = await apiCall();
    const data = await response.json();
    
    if (!response.ok) {
      throw new ApiError(data.error, response.status);
    }
    
    if (!data.success) {
      throw new ApiError(data.error);
    }
    
    return data.data;
  } catch (error) {
    if (error instanceof ApiError) {
      handleApiError(error);
    } else {
      handleNetworkError(error);
    }
    throw error;
  }
}

class ApiError extends Error {
  constructor(
    public error: { message: string; code?: string; details?: any },
    public status?: number
  ) {
    super(error.message);
    this.name = 'ApiError';
  }
}
```

### Error Handler with Retry
```typescript
async function apiCallWithRetry<T>(
  apiCall: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error;
      
      // Don't retry on client errors (4xx)
      if (error.status >= 400 && error.status < 500) {
        throw error;
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  
  throw lastError;
}
```

## User-Friendly Error Messages

```typescript
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Invalid email or password',
  TOKEN_EXPIRED: 'Your session has expired. Please login again.',
  INSUFFICIENT_PERMISSIONS: 'You do not have permission to perform this action',
  INSUFFICIENT_CREDITS: 'Insufficient credits. Please purchase more credits to continue.',
  WORKSPACE_NOT_FOUND: 'Workspace not found',
  // ... more messages
};

function getErrorMessage(error: ApiError): string {
  if (error.error.code && ERROR_MESSAGES[error.error.code]) {
    return ERROR_MESSAGES[error.error.code];
  }
  return error.error.message || 'An unexpected error occurred';
}
```

## React Error Boundary

```typescript
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error, errorInfo) {
    // Log to error reporting service
    console.error('Error caught:', error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
```

## Toast Notifications

```typescript
import { toast } from 'react-toastify';

function showError(error: ApiError) {
  const message = getErrorMessage(error);
  
  toast.error(message, {
    position: 'top-right',
    autoClose: 5000,
  });
  
  // Log error for debugging
  console.error('API Error:', error);
}
```

## Network Error Handling

```typescript
function handleNetworkError(error: Error) {
  if (error.message === 'Failed to fetch') {
    toast.error('Unable to connect to server. Please check your internet connection.');
  } else {
    toast.error('Network error occurred. Please try again.');
  }
}
```

## Best Practices

1. **Always handle errors** - Never ignore API errors
2. **Show user-friendly messages** - Convert technical errors to readable messages
3. **Log errors** - Log errors for debugging (without sensitive data)
4. **Provide recovery options** - Suggest actions users can take
5. **Handle 401 gracefully** - Automatically refresh tokens or redirect to login
6. **Rate limiting** - Show helpful message when rate limited
7. **Retry logic** - Implement retry for transient errors (5xx)

