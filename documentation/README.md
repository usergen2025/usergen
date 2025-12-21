# UserGen.ai Documentation

Welcome to the UserGen.ai documentation! This directory is organized to serve different audiences.

## Documentation Structure

### For End Users 👥
**[user/](./user/)** - User guides and documentation for using the application
- [Getting Started](./user/GETTING_STARTED.md) - Create account and first steps
- [Creating Content](./user/CREATING_CONTENT.md) - Generate videos and avatars
- [Managing Workspaces](./user/MANAGING_WORKSPACES.md) - Teams and collaboration
- [Understanding Credits](./user/UNDERSTANDING_CREDITS.md) - Credits and pricing
- [FAQs](./user/FAQS.md) - Frequently asked questions

### For Frontend Developers 💻
**[client/](./client/)** - Frontend integration guides and API documentation
- [API Integration Guide](./client/API_INTEGRATION.md) - How to integrate with backend
- [Authentication](./client/AUTHENTICATION.md) - Frontend auth flow
- [Workspaces](./client/WORKSPACES.md) - Workspace API integration
- [Credits](./client/CREDITS.md) - Credit system integration
- [Error Handling](./client/ERROR_HANDLING.md) - Error handling guide

### For Backend Developers 🔧
**[server/](./server/)** - Backend documentation and architecture
- [Multi-Tenant Architecture](./server/MULTI_TENANT.md) - System architecture
- [Workspaces API](./server/WORKSPACES.md) - Workspace service API
- [Credits API](./server/CREDITS.md) - Credit system API
- [IAM Service](./server/IAM.md) - Identity and Access Management
- [Inter-Service Communication](./server/INTER_SERVICE_COMMUNICATION.md) - Service communication patterns
- [Image Generation System](./server/IMAGE_GENERATION.md) - Multi-provider image generation with model selection

### For Administrators 👨‍💼
**[admin/](./admin/)** - Administrative documentation
- [System Overview](./admin/SYSTEM_OVERVIEW.md) - Platform architecture
- [User Management](./admin/USER_MANAGEMENT.md) - Managing users
- [Workspace Administration](./admin/WORKSPACE_ADMIN.md) - Workspace administration
- [Credit Management](./admin/CREDIT_MANAGEMENT.md) - Credit system administration
- [Monitoring](./admin/MONITORING.md) - System monitoring
- [Troubleshooting](./admin/TROUBLESHOOTING.md) - Common issues and solutions

## Setup & Quick Start

### Quick Start Guides
- **[QUICK_START.md](./QUICK_START.md)** - Get started in 5 minutes
- **[SETUP.md](./SETUP.md)** - Complete setup guide for development

## Service Overview

| Service | Port | Purpose |
|---------|------|---------|
| API Gateway (Kong) | 8000 | Entry point for all requests |
| auth-service | 9000 | Authentication & user management |
| ai-content-service | 9001 | AI content generation |
| activity-service | 9003 | Activity tracking & audit logs |
| payment-wallet-service | 9005 | Credit management & transactions |
| workspace-service | 9007 | Team workspaces & collaboration |
| iam-service | 9010 | Identity & Access Management |

## Getting Started

1. **Start services**: `cd server && docker-compose up`
2. **Run migrations**: See [QUICK_START.md](./QUICK_START.md)
3. **Test**: Use [API Gateway](http://localhost:8000)

## Quick Links by Role

### 🎯 End Users
Start with: [Getting Started Guide](./user/GETTING_STARTED.md)

### 👨‍💻 Frontend Developers
Start with: [API Integration Guide](./client/API_INTEGRATION.md)

### 🔧 Backend Developers
Start with: [Multi-Tenant Architecture](./server/MULTI_TENANT.md)

### 👨‍💼 Administrators
Start with: [System Overview](./admin/SYSTEM_OVERVIEW.md)

---

**Need Help?** Check the relevant section above or contact support.
