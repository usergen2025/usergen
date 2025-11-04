# System Overview

## Platform Architecture

UserGen.ai is built as a microservices architecture with the following services:

- **Auth Service** - User authentication and management
- **IAM Service** - Identity and Access Management (permissions, roles)
- **Workspace Service** - Team and workspace management
- **Payment Wallet Service** - Credit system and transactions
- **Activity Service** - Activity logging and audit trails
- **AI Content Service** - AI-powered content generation

## Service Ports

| Service | Port | Purpose |
|---------|------|---------|
| API Gateway | 8000 | Entry point for all requests |
| Auth Service | 9000 | Authentication |
| AI Content Service | 9001 | Content generation |
| Activity Service | 9003 | Logging |
| Payment Wallet | 9005 | Credits |
| Workspace Service | 9007 | Workspaces |
| IAM Service | 9010 | Authorization |

## Data Flow

1. **User Request** → API Gateway (Kong)
2. **Authentication** → Auth Service validates token
3. **Authorization** → IAM Service checks permissions
4. **Business Logic** → Appropriate service handles request
5. **Events** → Activity Service logs actions
6. **Response** → Returned to user via Gateway

## Admin Capabilities

As an admin, you can:

- View and manage all users
- Oversee all workspaces
- Monitor credit transactions
- View activity logs and audit trails
- Manage system configuration
- Access analytics and reports

## Security

- All services use JWT for authentication
- IAM service handles authorization
- Activity service logs all actions for audit
- Role-based access control (RBAC) enforced


