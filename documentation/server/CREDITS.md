# Credit System

## Overview
Credits are the currency used in UserGen.ai for accessing AI features. Credits exist in two contexts:
1. **User Credits**: Personal account credits
2. **Workspace Credits**: Shared team credits

## How It Works
- Deduct credits before using features
- Track all transactions in ledger
- Support purchases, refunds, transfers
- Complete audit trail for compliance

## API Endpoints

### Transactions
```
POST /api/transactions/deduct    Deduct credits
POST /api/transactions/add      Add credits
GET  /api/transactions/balance  Check balance
GET  /api/transactions/history  Transaction history
GET  /api/transactions/ledger/:type/:id  Credit ledger
```

## Usage

### Deduct Credits
```bash
# Individual context
curl -X POST http://localhost:8000/api/transactions/deduct \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "amount": 10,
    "activityName": "Video Generation",
    "resourceId": "video-456"
  }'

# Team context
curl -X POST http://localhost:8000/api/transactions/deduct \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "workspaceId": "workspace-789",
    "amount": 10,
    "activityName": "Video Generation"
  }'
```

### Check Balance
```bash
# User credits
curl http://localhost:8000/api/transactions/balance?userId=user-123

# Workspace credits
curl http://localhost:8000/api/transactions/balance?userId=user-123&workspaceId=workspace-789
```

## Transaction Types
- **SPENT**: Credits deducted for usage
- **PURCHASED**: Credits added via payment
- **EARNED**: Credits earned (referrals, bonuses)
- **REFUNDED**: Credits returned
- **TRANSFER**: Credits moved between accounts

## Credit Ledger
Complete audit trail showing:
- Balance before transaction
- Balance after transaction
- Amount changed
- Description of change
- Timestamp

