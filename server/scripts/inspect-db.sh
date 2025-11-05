#!/bin/bash
# Database Inspection Script for UserGen.ai
# Allows quick connection and querying of databases

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}📊 UserGen.ai Database Inspection Tool${NC}"
echo ""

# Check if Docker containers are running
check_docker() {
  if ! docker ps | grep -q "usergen-postgres"; then
    echo -e "${YELLOW}⚠️  PostgreSQL container (usergen-postgres) is not running${NC}"
    echo "   Start it with: cd server/environments/local && docker compose up -d postgres"
    return 1
  fi
  if ! docker ps | grep -q "usergen-mongodb"; then
    echo -e "${YELLOW}⚠️  MongoDB container (usergen-mongodb) is not running${NC}"
    echo "   Start it with: cd server/environments/local && docker compose up -d mongodb"
    return 1
  fi
  if ! docker ps | grep -q "usergen-redis"; then
    echo -e "${YELLOW}⚠️  Redis container (usergen-redis) is not running${NC}"
    echo "   Start it with: cd server/environments/local && docker compose up -d redis"
    return 1
  fi
  return 0
}

show_menu() {
  echo -e "${GREEN}Select database to inspect:${NC}"
  echo "1) PostgreSQL - Avatars & Jobs"
  echo "2) PostgreSQL - Auth Service (Users)"
  echo "3) MongoDB - Metadata"
  echo "4) Redis - Cache/Sessions"
  echo "5) Show all avatars"
  echo "6) Show all avatar generation jobs"
  echo "7) Show avatar by ID"
  echo "8) Exit"
  echo ""
  read -p "Enter choice [1-8]: " choice
  return $choice
}

# PostgreSQL Connection Info
PG_HOST="localhost"
PG_PORT="5432"
PG_USER="postgres"
PG_PASSWORD="password"

# PostgreSQL Databases
PG_DB_AI_CONTENT="usergen_ai_content"
PG_DB_AUTH="usergen_auth"

# MongoDB Connection Info
MONGO_HOST="localhost"
MONGO_PORT="27017"
MONGO_USER="admin"
MONGO_PASS="password"
MONGO_DB="usergen_metadata"

# Redis Connection Info
REDIS_HOST="localhost"
REDIS_PORT="6379"

inspect_postgres_avatars() {
  echo -e "${BLUE}📋 PostgreSQL - AI Content Service (Avatars)${NC}"
  echo "Connecting to: postgresql://${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_DB_AI_CONTENT}"
  echo ""
  
  # Check if psql is installed
  if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}⚠️  psql is not installed. Install PostgreSQL client tools.${NC}"
    echo ""
    echo "Alternative: Use a GUI tool like pgAdmin or TablePlus"
    echo "Connection details:"
    echo "  Host: ${PG_HOST}"
    echo "  Port: ${PG_PORT}"
    echo "  Database: ${PG_DB_AI_CONTENT}"
    echo "  Username: ${PG_USER}"
    echo "  Password: ${PG_PASSWORD}"
    echo ""
    return 1
  fi

  # Use PGPASSWORD environment variable for password
  export PGPASSWORD="${PG_PASSWORD}"
  
  echo "Enter SQL queries (type '\\q' to quit, '\\d' for tables, '\\d avatars' for avatar table structure):"
  echo ""
  psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${PG_DB_AI_CONTENT}
  
  unset PGPASSWORD
}

inspect_postgres_auth() {
  echo -e "${BLUE}📋 PostgreSQL - Auth Service (Users)${NC}"
  echo "Connecting to: postgresql://${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_DB_AUTH}"
  echo ""
  
  if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}⚠️  psql is not installed. Install PostgreSQL client tools.${NC}"
    echo ""
    echo "Alternative: Use a GUI tool like pgAdmin or TablePlus"
    echo "Connection details:"
    echo "  Host: ${PG_HOST}"
    echo "  Port: ${PG_PORT}"
    echo "  Database: ${PG_DB_AUTH}"
    echo "  Username: ${PG_USER}"
    echo "  Password: ${PG_PASSWORD}"
    echo ""
    return 1
  fi

  export PGPASSWORD="${PG_PASSWORD}"
  psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${PG_DB_AUTH}
  unset PGPASSWORD
}

inspect_mongodb() {
  echo -e "${BLUE}📋 MongoDB - Metadata${NC}"
  echo "Connecting to: mongodb://${MONGO_USER}@${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB}"
  echo ""
  
  if ! command -v mongosh &> /dev/null && ! command -v mongo &> /dev/null; then
    echo -e "${YELLOW}⚠️  mongosh/mongo is not installed. Install MongoDB client tools.${NC}"
    echo ""
    echo "Alternative: Use MongoDB Compass"
    echo "Connection String: mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB}"
    echo ""
    return 1
  fi

  # Try mongosh first (MongoDB 4.4+), fallback to mongo
  if command -v mongosh &> /dev/null; then
    mongosh "mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB}"
  else
    mongo "mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB}"
  fi
}

inspect_redis() {
  echo -e "${BLUE}📋 Redis - Cache/Sessions${NC}"
  echo "Connecting to: redis://${REDIS_HOST}:${REDIS_PORT}"
  echo ""
  
  if ! command -v redis-cli &> /dev/null; then
    echo -e "${YELLOW}⚠️  redis-cli is not installed. Install Redis client tools.${NC}"
    echo ""
    echo "Alternative: Use RedisInsight"
    echo "Connection: ${REDIS_HOST}:${REDIS_PORT}"
    echo ""
    return 1
  fi

  redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT}
}

show_all_avatars() {
  echo -e "${BLUE}📋 All Avatars${NC}"
  echo ""
  
  if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}⚠️  psql is not installed.${NC}"
    return 1
  fi

  export PGPASSWORD="${PG_PASSWORD}"
  
  echo "SELECT id, \"userId\", name, source, provider, \"providerAvatarId\", \"providerGroupId\", \"imageKey\", \"generationStatus\", \"createdAt\" FROM avatars ORDER BY \"createdAt\" DESC LIMIT 20;" | \
  psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${PG_DB_AI_CONTENT} -x
  
  unset PGPASSWORD
}

show_all_jobs() {
  echo -e "${BLUE}📋 All Avatar Generation Jobs${NC}"
  echo ""
  
  if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}⚠️  psql is not installed.${NC}"
    return 1
  fi

  export PGPASSWORD="${PG_PASSWORD}"
  
  echo "SELECT id, \"userId\", \"avatarId\", provider, \"jobType\", status, \"groupId\", \"avatarIdResult\", \"createdAt\", \"completedAt\" FROM avatar_generation_jobs ORDER BY \"createdAt\" DESC LIMIT 20;" | \
  psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${PG_DB_AI_CONTENT} -x
  
  unset PGPASSWORD
}

show_avatar_by_id() {
  echo -e "${BLUE}📋 Avatar by ID${NC}"
  read -p "Enter Avatar ID: " avatar_id
  
  if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}⚠️  psql is not installed.${NC}"
    return 1
  fi

  export PGPASSWORD="${PG_PASSWORD}"
  
  echo "SELECT * FROM avatars WHERE id = '${avatar_id}';" | \
  psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${PG_DB_AI_CONTENT} -x
  
  echo ""
  echo "Related Jobs:"
  echo "SELECT * FROM avatar_generation_jobs WHERE \"avatarId\" = '${avatar_id}' ORDER BY \"createdAt\" DESC;" | \
  psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${PG_DB_AI_CONTENT} -x
  
  unset PGPASSWORD
}

# Main loop
check_docker

while true; do
  show_menu
  choice=$?

  case $choice in
    1)
      inspect_postgres_avatars
      ;;
    2)
      inspect_postgres_auth
      ;;
    3)
      inspect_mongodb
      ;;
    4)
      inspect_redis
      ;;
    5)
      show_all_avatars
      echo ""
      read -p "Press Enter to continue..."
      ;;
    6)
      show_all_jobs
      echo ""
      read -p "Press Enter to continue..."
      ;;
    7)
      show_avatar_by_id
      echo ""
      read -p "Press Enter to continue..."
      ;;
    8)
      echo "Goodbye!"
      exit 0
      ;;
    *)
      echo "Invalid choice. Please try again."
      ;;
  esac
  
  echo ""
done

