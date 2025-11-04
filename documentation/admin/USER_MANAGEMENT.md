# User Management

## Overview
Administrative guide for managing users in the UserGen.ai platform.

## User Roles

### System Roles
- **USER** - Regular user
- **PREMIUM** - Premium user
- **ADMIN** - Platform administrator

### Workspace Roles
- **OWNER** - Full workspace control
- **ADMIN** - Manage workspace (no delete)
- **MEMBER** - Use workspace features
- **VIEWER** - Read-only access

## Admin Actions

### View All Users
Access user list through admin dashboard or API:
```
GET /admin/users
```

### User Details
View complete user profile, workspaces, credits, activity:
```
GET /admin/users/:userId
```

### Modify User
- Update user profile
- Change user credits
- Modify user status (active/inactive)
- Upgrade/downgrade user role

### Suspend/Reactivate User
Suspend users who violate terms of service:
```
PATCH /admin/users/:userId/suspend
PATCH /admin/users/:userId/activate
```

### Delete User
Permanently remove user account (with data retention policies):
```
DELETE /admin/users/:userId
```

## User Credits Management

### Adjust Credits
Manually adjust user credits for support cases:
```
PATCH /admin/users/:userId/credits
{
  amount: 100,  // Add or subtract
  reason: "Support compensation"
}
```

### View Credit History
View all credit transactions for a user:
```
GET /admin/users/:userId/transactions
```

## Monitoring User Activity

### Activity Logs
View comprehensive activity logs:
```
GET /admin/users/:userId/activities
```

Tracks:
- Login/logout
- Content generation
- Credit transactions
- Workspace actions

## Best Practices

1. **Document Changes** - Always note reason for manual interventions
2. **Audit Trail** - All admin actions are logged
3. **Privacy** - Respect user data privacy
4. **Support** - Coordinate with support team for user issues
5. **Backup** - Verify backups before destructive actions


