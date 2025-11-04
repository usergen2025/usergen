# Workspace Administration

## Overview
Guide for administering workspaces and teams in the UserGen.ai platform.

## Viewing Workspaces

### All Workspaces
View list of all workspaces:
```
GET /admin/workspaces
```

Information includes:
- Workspace name and description
- Owner information
- Member count
- Credit balance
- Creation date
- Status (active/inactive)

### Workspace Details
Get detailed workspace information:
```
GET /admin/workspaces/:id
```

Includes:
- All members and their roles
- Credit transactions
- Activity history
- Settings and configuration

## Workspace Management Actions

### Suspend Workspace
Suspend workspace for policy violations:
```
PATCH /admin/workspaces/:id/suspend
```

### Reactivate Workspace
Restore suspended workspace:
```
PATCH /admin/workspaces/:id/activate
```

### Transfer Ownership
Transfer workspace ownership if needed:
```
PATCH /admin/workspaces/:id/transfer-ownership
{
  newOwnerId: "user_id"
}
```

### Adjust Workspace Credits
Manually adjust workspace credits:
```
PATCH /admin/workspaces/:id/credits
{
  amount: 500,
  reason: "Support adjustment"
}
```

## Monitoring Workspace Activity

### Activity Logs
View all activities within a workspace:
```
GET /admin/workspaces/:id/activities
```

### Credit Transactions
View credit spending and purchases:
```
GET /admin/workspaces/:id/transactions
```

## Member Management

### View All Members
See all members across all workspaces:
```
GET /admin/workspaces/:id/members
```

### Remove Members
Remove problematic members if needed {{Only when necessary}}:
```
DELETE /admin/workspaces/:id/members/:memberId
```

## Statistics

### Workspace Metrics
- Total workspaces
- Active workspaces
- Average members per workspace
- Credit usage statistics
- Activity trends

## Guidelines

1. **Investigate First** - Review activity logs before taking action
2. **Document Actions** - Record reason for administrative interventions
3. **Notify Users** - Inform workspace owners of significant changes
4. **Preserve Data** - Consider data retention before deletion
5. **Follow Policy** - Adhere to platform terms of service


