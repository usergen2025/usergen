# Frontend Developer Documentation

## Overview
This section contains documentation for frontend developers working on the UserGen.ai application. It includes API integration guides, response formats, and frontend implementation details.

## Quick Links

- **[API Integration Guide](./API_INTEGRATION.md)** - How to integrate with the backend API
- **[Authentication](./AUTHENTICATION.md)** - Frontend authentication flow
- **[Workspaces](./WORKSPACES.md)** - Workspace API responses and integration
- **[Credits](./CREDITS.md)** - Credit system API integration
- **[Error Handling](./ERROR_HANDLING.md)** - Common errors and how to handle them

## Getting Started

1. Review the [API Integration Guide](./API_INTEGRATION.md)
2. Set up authentication using the [Authentication](./AUTHENTICATION.md) guide
3. Review API-specific documentation for features you're implementing

## API Base URL

- **Development**: `http://localhost:8000/api`
- **Production**: `https://api.usergen.ai/api`

## Response Format

All API responses follow this structure:

```typescript
{
  success: boolean;
  data?: any;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}
```


