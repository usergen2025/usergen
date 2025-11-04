# Credit System Integration

## Overview
Frontend integration for the credit system, showing how to display balances and handle credit-related operations.

## Getting Credit Balance

### Individual Credits
```typescript
GET /api/transactions/balance?userId=:userId

Response:
{
  success: true,
  data: {
    credits: 150,
    userId: 'user_123'
  }
}
```

### Workspace Credits
```typescript
GET /api/transactions/balance?userId=:userId&workspaceId=:workspaceId

Response:
{
  success: true,
  data: {
    credits: 500,
    workspaceId: 'workspace_456'
  }
}
```

## Display Credit Balance

```typescript
// React component example
function CreditBalance({ userId, workspaceId }) {
  const [balance, setBalance] = useState(0);
  
  useEffect(() => {
    const url = workspaceId
      ? `/api/transactions/balance?userId=${userId}&workspaceId=${workspaceId}`
      : `/api/transactions/balance?userId=${userId}`;
    
    fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          setBalance(result.data.credits);
        }
      });
  }, [userId, workspaceId]);
  
  return <div>Credits: {balance}</div>;
}
```

## Transaction History

```typescript
GET /api/transactions/history?userId=:userId&workspaceId=:workspaceId&limit=20

Response:
{
  success: true,
  data: {
    transactions: [
      {
        id: string;
        type: 'SPENT' | 'PURCHASED' | 'EARNED' | 'REFUNDED';
        amount: number;  // Negative for spent, positive for earned
        activityName?: string;  // e.g., "Video Generation"
        createdAt: string;
      }
    ],
    meta: {
      total: 100,
      limit: 20,
      page: 1
    }
  }
}
```

## Credit Ledger

```typescript
GET /api/transactions/ledger/:type/:id
// type: 'user' or 'workspace'
// id: userId or workspaceId

Response:
{
  success: true,
  data: {
    entries: [
      {
        id: string;
        change: number;  // Positive or negative
        balanceBefore: number;
        balanceAfter: number;
        description: string;
        createdAt: string;
      }
    ]
  }
}
```

## Error Handling

### Insufficient Credits
When attempting an action that requires credits:

```typescript
{
  success: false,
  error: {
    message: 'Insufficient credits',
    code: 'INSUFFICIENT_CREDITS',
    details: {
      required: 10,
      available: 5
    }
  }
}
```

Handle in UI:
```typescript
async function generateVideo() {
  try {
    const response = await generateVideoAPI();
    // Success
  } catch (error) {
    if (error.code === 'INSUFFICIENT_CREDITS') {
      // Show purchase credits modal
      showPurchaseModal({
        required: error.details.required,
        available: error.details.available
      });
    }
  }
}
```

## Real-time Updates

Use WebSockets or polling to update credit balance after transactions:

```typescript
// Polling example
useEffect(() => {
  const interval = setInterval(() => {
    fetchBalance(); // Refresh balance every 30 seconds
  }, 30000);
  
  return () => clearInterval(interval);
}, []);
```

也从后端服务获取 WebSocket 事件（如果可用）

