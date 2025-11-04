# Credit Management

## Overview
Administrative guide for managing the credit system, transactions, and user balances.

## Credit System Overview

Users and workspaces have credit balances used for:
- Video generation
- Avatar creation
- Other AI-powered features

## Admin Actions

### View Credit Balances
View all user credit balances:
```
GET /admin/credits/users
```

View all workspace credit balances:
```
GET /admin/credits/workspaces
```

### Adjust Credits
Manually adjust credits for support cases:

**User Credits:**
```
PATCH /admin/users/:userId/credits
{
  amount: 100,  // Positive to add, negative to subtract
  reason: "Support compensation",
  transactionType: "MANUAL_ADJUSTMENT"
}
```

**Workspace Credits:**
```
PATCH /admin/workspaces/:workspaceId/credits
{
  amount: 500,
  reason: "Promotional credits",
  transactionType: "MANUAL_ADJUSTMENT"
}
```

### Transaction Monitoring

View all transactions:
```
GET /admin/transactions
```

Filter by:
- User
- Workspace
- Date range
- Transaction type
- Amount range

### Refund Transactions
Issue refunds for failed services:
```
POST /admin/transactions/:id/refund
{
  reason: "Service failure",
  amount: 10  // Partial or full refund
}
```

## Credit Policies

### Default Credits
- New users: 100 credits (default)
- New workspaces: 0 credits (default)

### Credit Costs
Admin can view current credit costs for services:
- Video generation: 10 credits
- Avatar creation: 5 credits
- (Other service costs)

## Reports

### Credit Usage Reports
Generate reports on:
- Total credits issued
- Total credits spent
- Credits by service type
- Credits by user segment
- Credits by workspace

### High Usage Alerts
Monitor for:
- Users with unusually high credit consumption
- Suspicious transaction patterns
- Potential fraud detection

## Best Practices

1. **Document Adjustments** - Always include reason for credit changes
2. **Verify Before Adjusting** - Confirm user/workspace information
3. **Fair Practice** - Follow consistent policies for credit adjustments
4. **Monitor Patterns** - Watch for unusual credit activity
5. **Support Coordination** - Coordinate credit adjustments with support tickets


