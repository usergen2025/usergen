#!/bin/bash

# Migration and Deployment Script for All Services
# Usage: bash scripts/migrate-and-deploy.sh [migrate|generate|deploy|all]

set +e  # Don't exit on error - we'll handle errors manually

cd "$(dirname "$0")/.."  # Go to server root

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Function to check if service has Prisma schema
has_prisma_schema() {
    local service_path="$1"
    [ -f "$service_path/prisma/schema.prisma" ]
}

# Function to get DATABASE_URL from service .env or root .env
get_database_url() {
    local service_name="$1"
    local service_path="microservices/$service_name"
    
    # Try service-specific .env first
    if [ -f "$service_path/.env" ]; then
        local db_url=$(grep "^DATABASE_URL=" "$service_path/.env" 2>/dev/null | cut -d '=' -f2- | tr -d '"' | tr -d "'")
        if [ -n "$db_url" ]; then
            echo "$db_url"
            return
        fi
        
        # Try alternative database URL env vars
        case "$service_name" in
            video-processing-service)
                local db_url=$(grep "^DATABASE_URL_VIDEO_PROCESSING=\|^DATABASE_URL_VIDEO=" "$service_path/.env" 2>/dev/null | head -1 | cut -d '=' -f2- | tr -d '"' | tr -d "'")
                ;;
            auth-service)
                local db_url=$(grep "^DATABASE_URL_AUTH=" "$service_path/.env" 2>/dev/null | cut -d '=' -f2- | tr -d '"' | tr -d "'")
                ;;
            *)
                local db_url=""
                ;;
        esac
        if [ -n "$db_url" ]; then
            echo "$db_url"
            return
        fi
    fi
    
    # Try root .env
    if [ -f ".env" ]; then
        local db_url=$(grep "^DATABASE_URL=" ".env" 2>/dev/null | cut -d '=' -f2- | tr -d '"' | tr -d "'")
        if [ -n "$db_url" ]; then
            echo "$db_url"
            return
        fi
    fi
    
    # Default fallback
    echo "postgresql://postgres:password@localhost:5432/usergen_dev"
}

# Array of all services with Prisma
services_with_prisma=(
    "auth-service"
    "ai-content-service"
    "video-processing-service"
    "iam-service"
    "payment-wallet-service"
    "workspace-service"
    "activity-service"
    "project-management-service"
    "analytics-service"
    "notification-service"
    "media-management-service"
    "voice-audio-service"
)

migrate_count=0
generate_count=0
skip_count=0
fail_count=0

action="${1:-all}"

case "$action" in
    migrate)
        echo "=========================================="
        echo "🔄 Running Prisma Migrations"
        echo "=========================================="
        echo ""
        
        for service in "${services_with_prisma[@]}"; do
            service_path="microservices/$service"
            
            if [ ! -d "$service_path" ]; then
                print_warning "Skipping $service - directory not found"
                ((skip_count++))
                continue
            fi
            
            if ! has_prisma_schema "$service_path"; then
                print_warning "Skipping $service - no Prisma schema found"
                ((skip_count++))
                continue
            fi
            
            print_info "Migrating $service..."
            cd "$service_path"
            
            # Get DATABASE_URL
            db_url=$(get_database_url "$service")
            
            # Run migration
            if DATABASE_URL="$db_url" npx prisma migrate deploy 2>&1; then
                print_success "$service migrated successfully"
                ((migrate_count++))
            else
                print_error "Failed to migrate $service"
                ((fail_count++))
            fi
            
            cd ../..
            echo ""
        done
        
        echo "=========================================="
        echo "Migration Summary:"
        echo "  ✅ Success: $migrate_count"
        echo "  ⚠️  Skipped: $skip_count"
        echo "  ❌ Failed:  $fail_count"
        echo "=========================================="
        ;;
        
    generate)
        echo "=========================================="
        echo "🔧 Generating Prisma Clients"
        echo "=========================================="
        echo ""
        
        for service in "${services_with_prisma[@]}"; do
            service_path="microservices/$service"
            
            if [ ! -d "$service_path" ]; then
                print_warning "Skipping $service - directory not found"
                ((skip_count++))
                continue
            fi
            
            if ! has_prisma_schema "$service_path"; then
                print_warning "Skipping $service - no Prisma schema found"
                ((skip_count++))
                continue
            fi
            
            print_info "Generating Prisma client for $service..."
            cd "$service_path"
            
            # Get DATABASE_URL
            db_url=$(get_database_url "$service")
            
            # Generate Prisma client
            if DATABASE_URL="$db_url" npx prisma generate 2>&1; then
                print_success "$service Prisma client generated successfully"
                ((generate_count++))
            else
                print_error "Failed to generate Prisma client for $service"
                ((fail_count++))
            fi
            
            cd ../..
            echo ""
        done
        
        echo "=========================================="
        echo "Generation Summary:"
        echo "  ✅ Success: $generate_count"
        echo "  ⚠️  Skipped: $skip_count"
        echo "  ❌ Failed:  $fail_count"
        echo "=========================================="
        ;;
        
    deploy)
        echo "=========================================="
        echo "🏗️  Building All Services"
        echo "=========================================="
        echo ""
        
        # Use existing build script
        bash scripts/build-services.sh
        ;;
        
    all)
        echo "=========================================="
        echo "🚀 Full Deployment Pipeline"
        echo "=========================================="
        echo ""
        
        # Step 1: Migrate
        echo "Step 1/3: Running Prisma Migrations..."
        echo ""
        bash "$0" migrate
        
        # Step 2: Generate Prisma Clients
        echo ""
        echo "Step 2/3: Generating Prisma Clients..."
        echo ""
        bash "$0" generate
        
        # Step 3: Build Services
        echo ""
        echo "Step 3/3: Building All Services..."
        echo ""
        bash "$0" deploy
        
        echo ""
        echo "=========================================="
        echo "✅ Full Deployment Pipeline Complete!"
        echo "=========================================="
        ;;
        
    *)
        echo "Usage: $0 [migrate|generate|deploy|all]"
        echo ""
        echo "Commands:"
        echo "  migrate  - Run Prisma migrations for all services"
        echo "  generate - Generate Prisma clients for all services"
        echo "  deploy   - Build all services"
        echo "  all      - Run migrate, generate, and deploy in sequence"
        exit 1
        ;;
esac

# Exit with error code if any operations failed
if [ $fail_count -gt 0 ]; then
    exit 1
fi

exit 0

