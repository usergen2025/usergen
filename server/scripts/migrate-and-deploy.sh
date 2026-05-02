#!/bin/bash

# Migration and Deployment Script for All Services
# Usage: bash scripts/migrate-and-deploy.sh [migrate|generate|deploy|all]

set +e  # Don't exit on error - we'll handle errors manually

cd "$(dirname "$0")/.."  # Go to server root
SERVER_ROOT="$(pwd)"

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

check_required_tools() {
    local missing=0
    for cmd in bash node npm npx; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            print_error "Missing required command: $cmd"
            missing=1
        fi
    done
    if [ "$missing" -ne 0 ]; then
        exit 1
    fi
}

# Function to check if service has Prisma schema
has_prisma_schema() {
    local service_path="$1"
    [ -f "$service_path/prisma/schema.prisma" ]
}

# Resolve DATABASE_URL for Prisma. Migrate/generate always run with cwd = microservices/<service>,
# so we read ./.env there first, then fall back to server-root .env.
get_database_url() {
    local service_name="$1"
    local db_url=""
    local env_here=".env"
    local env_root="$SERVER_ROOT/.env"

    if [ -f "$env_here" ]; then
        db_url=$(grep "^DATABASE_URL=" "$env_here" 2>/dev/null | cut -d '=' -f2- | tr -d '"' | tr -d "'")
        if [ -n "$db_url" ]; then
            echo "$db_url"
            return
        fi

        case "$service_name" in
            video-processing-service)
                db_url=$(grep "^DATABASE_URL_VIDEO_PROCESSING=\|^DATABASE_URL_VIDEO=" "$env_here" 2>/dev/null | head -1 | cut -d '=' -f2- | tr -d '"' | tr -d "'")
                ;;
            auth-service)
                db_url=$(grep "^DATABASE_URL_AUTH=" "$env_here" 2>/dev/null | cut -d '=' -f2- | tr -d '"' | tr -d "'")
                ;;
            notification-service)
                db_url=$(grep "^DATABASE_URL_NOTIFICATION=" "$env_here" 2>/dev/null | cut -d '=' -f2- | tr -d '"' | tr -d "'")
                ;;
        esac
        if [ -n "$db_url" ]; then
            echo "$db_url"
            return
        fi
    fi

    if [ -f "$env_root" ]; then
        db_url=$(grep "^DATABASE_URL=" "$env_root" 2>/dev/null | cut -d '=' -f2- | tr -d '"' | tr -d "'")
        if [ -n "$db_url" ]; then
            echo "$db_url"
            return
        fi
        if [ "$service_name" = "notification-service" ]; then
            db_url=$(grep "^DATABASE_URL_NOTIFICATION=" "$env_root" 2>/dev/null | cut -d '=' -f2- | tr -d '"' | tr -d "'")
            if [ -n "$db_url" ]; then
                echo "$db_url"
                return
            fi
        fi
    fi

    case "$service_name" in
        notification-service)
            echo "postgresql://postgres:password@localhost:5432/usergen_notification"
            ;;
        video-processing-service)
            echo "postgresql://postgres:password@localhost:5432/usergen_video_processing"
            ;;
        *)
            echo "postgresql://postgres:password@localhost:5432/usergen_dev"
            ;;
    esac
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
    "campaign-service"
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
check_required_tools

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

            if [ "$service" = "notification-service" ]; then
                print_info "notification-service: ensure PostgreSQL database usergen_notification exists (migrate deploy creates tables only, not CREATE DATABASE)"
            fi
            
            # Get DATABASE_URL
            db_url=$(get_database_url "$service")

            migrate_out=$(DATABASE_URL="$db_url" npx prisma migrate deploy 2>&1)
            mig_status=$?
            echo "$migrate_out"

            if [ "$mig_status" -eq 0 ]; then
                print_success "$service migrated successfully"
                ((migrate_count++))
            elif echo "$migrate_out" | grep -q "P3005"; then
                # Database already had tables before migrations were added — baseline first migration, then deploy.
                first_mig=""
                for d in prisma/migrations/[0-9]*; do
                    [ -d "$d" ] || continue
                    first_mig=$(basename "$d")
                    break
                done
                if [ -n "$first_mig" ]; then
                    print_warning "Non-empty DB + new migrations — baselining \"$first_mig\" then re-running deploy..."
                    if DATABASE_URL="$db_url" npx prisma migrate resolve --applied "$first_mig" 2>&1 && \
                       DATABASE_URL="$db_url" npx prisma migrate deploy 2>&1; then
                        print_success "$service migrated successfully (after baseline)"
                        ((migrate_count++))
                    else
                        print_error "Failed to migrate $service (after baseline attempt)"
                        ((fail_count++))
                    fi
                else
                    print_error "Failed to migrate $service (P3005, no migration folder to baseline)"
                    ((fail_count++))
                fi
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
        
        pipeline_ok=0

        echo "Step 1/3: Running Prisma Migrations..."
        echo ""
        if ! bash "$0" migrate; then
            print_error "Migrate step failed — aborting pipeline"
            pipeline_ok=1
        fi

        if [ "$pipeline_ok" -eq 0 ]; then
            echo ""
            echo "Step 2/3: Generating Prisma Clients..."
            echo ""
            if ! bash "$0" generate; then
                print_error "Prisma generate step failed — aborting pipeline"
                pipeline_ok=1
            fi
        fi

        if [ "$pipeline_ok" -eq 0 ]; then
            echo ""
            echo "Step 3/3: Building All Services..."
            echo ""
            if ! bash "$0" deploy; then
                print_error "Build step failed"
                pipeline_ok=1
            fi
        fi

        echo ""
        echo "=========================================="
        if [ "$pipeline_ok" -eq 0 ]; then
            echo -e "${GREEN}✅ Full Deployment Pipeline Complete!${NC}"
        else
            echo -e "${RED}❌ Deployment pipeline finished with errors${NC}"
        fi
        echo "=========================================="

        if [ "$pipeline_ok" -ne 0 ]; then
            exit 1
        fi
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

