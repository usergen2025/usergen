# Database Connection Information

## Quick Connection Details

### PostgreSQL (AI Content Service - Avatars)
```
Host: localhost
Port: 5432
Database: usergen_ai_content
Username: postgres
Password: password
```

### PostgreSQL (Auth Service - Users)
```
Host: localhost
Port: 5432
Database: usergen_auth
Username: postgres
Password: password
```

### MongoDB (Metadata)
```
Host: localhost
Port: 27017
Database: usergen_metadata
Username: admin
Password: password
Connection String: mongodb://admin:password@localhost:27017/usergen_metadata
```

### Redis (Cache/Sessions)
```
Host: localhost
Port: 6379
No authentication required
```

## GUI Tools

### PostgreSQL
- **pgAdmin**: https://www.pgadmin.org/
- **TablePlus**: https://tableplus.com/
- **DBeaver**: https://dbeaver.io/

### MongoDB
- **MongoDB Compass**: https://www.mongodb.com/products/compass
- Connection String: `mongodb://admin:password@localhost:27017/usergen_metadata`

### Redis
- **RedisInsight**: https://redis.com/redis-enterprise/redis-insight/

## Command Line Tools

### PostgreSQL
```bash
# Install PostgreSQL client (if not installed)
# macOS: brew install postgresql
# Linux: sudo apt-get install postgresql-client

# Connect to AI Content database
psql -h localhost -p 5432 -U postgres -d usergen_ai_content
# Password: password

# Common queries:
# List all avatars:
SELECT * FROM avatars ORDER BY "createdAt" DESC;

# List all jobs:
SELECT * FROM avatar_generation_jobs ORDER BY "createdAt" DESC;

# View avatar with jobs:
SELECT a.*, j.status as job_status, j."jobType" 
FROM avatars a 
LEFT JOIN avatar_generation_jobs j ON a.id = j."avatarId"
WHERE a.id = 'your-avatar-id';
```

### MongoDB
```bash
# Install MongoDB client (if not installed)
# macOS: brew install mongosh
# Linux: sudo apt-get install mongodb-clients

# Connect to MongoDB
mongosh "mongodb://admin:password@localhost:27017/usergen_metadata"

# Common commands:
# Show databases
show dbs

# Use database
use usergen_metadata

# Show collections
show collections

# Query documents
db.collection_name.find().pretty()
```

### Redis
```bash
# Install Redis client (if not installed)
# macOS: brew install redis
# Linux: sudo apt-get install redis-tools

# Connect to Redis
redis-cli

# Common commands:
# List all keys
KEYS *

# Get value
GET key_name

# Check if connected
PING
```

## Quick Inspect Script

Use the provided script for quick database inspection:
```bash
cd server
bash scripts/inspect-db.sh
```

