#!/bin/bash
# Port Cleanup Script for UserGen.ai Services
# Kills processes running on service ports before starting services

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Ports used by microservices
PORTS=(9000 9001 9002 9003 9004 9005 9006 9007 9008 9009 9010 9011 9090)

echo -e "${YELLOW}🧹 Clearing ports before starting services...${NC}"
echo ""

cleared_count=0
for port in "${PORTS[@]}"; do
  # Check if port is in use
  pid=$(lsof -ti:$port 2>/dev/null)
  
  if [ ! -z "$pid" ]; then
    echo -e "${YELLOW}⚠️  Port $port is in use (PID: $pid)${NC}"
    
    # Kill the process
    kill -9 $pid 2>/dev/null
    
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✅ Cleared port $port (killed PID: $pid)${NC}"
      cleared_count=$((cleared_count + 1))
    else
      echo -e "${RED}❌ Failed to clear port $port${NC}"
    fi
  else
    echo -e "${GREEN}✅ Port $port is available${NC}"
  fi
done

echo ""
if [ $cleared_count -gt 0 ]; then
  echo -e "${GREEN}✅ Cleared $cleared_count port(s)${NC}"
  echo -e "${YELLOW}⏳ Waiting 2 seconds for ports to be fully released...${NC}"
  sleep 2
else
  echo -e "${GREEN}✅ All ports are available${NC}"
fi

echo ""

