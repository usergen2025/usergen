#!/bin/bash
# Docker Control Script for UserGen.ai Services
# Manages Docker containers for databases, Redis, RabbitMQ, etc.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_DIR="$SERVER_DIR/environments/local"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

show_help() {
  echo "Docker Control Script for UserGen.ai Services"
  echo ""
  echo "Usage: $0 [command] [options]"
  echo ""
  echo "Commands:"
  echo "  start          Start Docker services (databases, Redis, RabbitMQ)"
  echo "  stop           Stop Docker services"
  echo "  restart        Restart Docker services"
  echo "  status         Show status of Docker services"
  echo "  logs [service] Show logs (optionally for specific service)"
  echo "  clean          Stop and remove all containers, volumes, and networks"
  echo "  ps             List running containers"
  echo ""
  echo "Examples:"
  echo "  $0 start              # Start all infrastructure services"
  echo "  $0 stop                # Stop all services"
  echo "  $0 logs postgres       # Show PostgreSQL logs"
  echo "  $0 clean               # Clean everything (WARNING: Removes data)"
}

case "$1" in
  start)
    echo -e "${GREEN}🚀 Starting Docker infrastructure services...${NC}"
    cd "$ENV_DIR"
    docker-compose -f docker-compose.local.yml up -d
    echo ""
    echo -e "${GREEN}✅ Docker services started!${NC}"
    echo ""
    echo "Services:"
    docker-compose -f docker-compose.local.yml ps
    ;;
    
  stop)
    echo -e "${YELLOW}🛑 Stopping Docker services...${NC}"
    cd "$ENV_DIR"
    docker-compose -f docker-compose.local.yml stop
    echo -e "${GREEN}✅ Docker services stopped!${NC}"
    ;;
    
  restart)
    echo -e "${YELLOW}🔄 Restarting Docker services...${NC}"
    cd "$ENV_DIR"
    docker-compose -f docker-compose.local.yml restart
    echo -e "${GREEN}✅ Docker services restarted!${NC}"
    ;;
    
  status)
    echo -e "${GREEN}📊 Docker Services Status:${NC}"
    cd "$ENV_DIR"
    docker-compose -f docker-compose.local.yml ps
    echo ""
    echo -e "${GREEN}📋 Container Details:${NC}"
    docker-compose -f docker-compose.local.yml ps -a
    ;;
    
  logs)
    cd "$ENV_DIR"
    if [ -z "$2" ]; then
      echo -e "${GREEN}📋 Showing logs for all services (Ctrl+C to exit)...${NC}"
      docker-compose -f docker-compose.local.yml logs -f
    else
      echo -e "${GREEN}📋 Showing logs for $2 (Ctrl+C to exit)...${NC}"
      docker-compose -f docker-compose.local.yml logs -f "$2"
    fi
    ;;
    
  clean)
    echo -e "${RED}⚠️  WARNING: This will remove all containers, volumes, and networks!${NC}"
    read -p "Are you sure? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
      cd "$ENV_DIR"
      echo -e "${YELLOW}🧹 Cleaning Docker resources...${NC}"
      docker-compose -f docker-compose.local.yml down -v --remove-orphans
      echo -e "${GREEN}✅ Cleanup complete!${NC}"
    else
      echo -e "${YELLOW}Cleanup cancelled.${NC}"
    fi
    ;;
    
  ps)
    cd "$ENV_DIR"
    docker-compose -f docker-compose.local.yml ps
    ;;
    
  *)
    show_help
    exit 1
    ;;
esac

