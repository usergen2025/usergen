#!/bin/bash

# Environment Management Script for UserGen.ai
# This script helps manage different environments (local, dev, prod)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 <command> [environment]"
    echo ""
    echo "Commands:"
    echo "  setup <env>     Setup environment (local, dev, prod)"
    echo "  start <env>     Start services for environment"
    echo "  stop <env>      Stop services for environment"
    echo "  restart <env>   Restart services for environment"
    echo "  logs <env>      Show logs for environment"
    echo "  status <env>    Show status of services"
    echo "  clean <env>     Clean up environment"
    echo "  migrate <env>   Run database migrations"
    echo ""
    echo "Environments:"
    echo "  local          Local development environment"
    echo "  dev            Development environment"
    echo "  prod           Production environment"
    echo ""
    echo "Examples:"
    echo "  $0 setup local"
    echo "  $0 start dev"
    echo "  $0 logs prod"
}

# Function to validate environment
validate_environment() {
    local env=$1
    if [[ ! "$env" =~ ^(local|dev|prod)$ ]]; then
        print_error "Invalid environment: $env"
        print_info "Valid environments: local, dev, prod"
        exit 1
    fi
}

# Function to setup environment
setup_environment() {
    local env=$1
    print_info "Setting up $env environment..."
    
    # Check if .env file already exists in environment directory
    local env_file="environments/$env/.env.$env"
    local example_file="environments/$env/.env.$env.example"
    
    # If .env file doesn't exist, create it from example
    if [ ! -f "$env_file" ]; then
        if [ -f "$example_file" ]; then
            cp "$example_file" "$env_file"
            print_success "Created $env_file from template"
            print_warning "Please review and update $env_file with your actual values (API keys, passwords, etc.)"
        else
            print_error "Environment template not found: $example_file"
            exit 1
        fi
    else
        print_info "Using existing $env_file"
    fi
    
    # Copy environment-specific file to root .env for services to use
    cp "$env_file" .env
    print_success "Environment file copied to root as .env"
    
    # Create necessary directories
    mkdir -p logs
    mkdir -p uploads
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        print_info "Installing root dependencies..."
        npm install
    fi
    
    # Install service dependencies (only if not already installed)
    if [ ! -d "microservices/auth-service/node_modules" ]; then
        print_info "Installing service dependencies..."
        npm run install:all
    else
        print_info "Service dependencies already installed"
    fi
    
    print_success "$env environment setup complete!"
    print_info "Active environment file: .env (source: $env_file)"
}

# Function to start services
start_services() {
    local env=$1
    print_info "Starting $env services..."
    
    if [ -f "environments/$env/docker-compose.$env.yml" ]; then
        docker-compose -f "environments/$env/docker-compose.$env.yml" up -d
        print_success "$env services started!"
    else
        print_error "Docker compose file not found: environments/$env/docker-compose.$env.yml"
        exit 1
    fi
}

# Function to stop services
stop_services() {
    local env=$1
    print_info "Stopping $env services..."
    
    if [ -f "environments/$env/docker-compose.$env.yml" ]; then
        docker-compose -f "environments/$env/docker-compose.$env.yml" down
        print_success "$env services stopped!"
    else
        print_error "Docker compose file not found: environments/$env/docker-compose.$env.yml"
        exit 1
    fi
}

# Function to restart services
restart_services() {
    local env=$1
    print_info "Restarting $env services..."
    stop_services $env
    start_services $env
}

# Function to show logs
show_logs() {
    local env=$1
    print_info "Showing logs for $env services..."
    
    if [ -f "environments/$env/docker-compose.$env.yml" ]; then
        docker-compose -f "environments/$env/docker-compose.$env.yml" logs -f
    else
        print_error "Docker compose file not found: environments/$env/docker-compose.$env.yml"
        exit 1
    fi
}

# Function to show status
show_status() {
    local env=$1
    print_info "Status of $env services..."
    
    if [ -f "environments/$env/docker-compose.$env.yml" ]; then
        docker-compose -f "environments/$env/docker-compose.$env.yml" ps
    else
        print_error "Docker compose file not found: environments/$env/docker-compose.$env.yml"
        exit 1
    fi
}

# Function to clean environment
clean_environment() {
    local env=$1
    print_warning "Cleaning $env environment..."
    
    if [ -f "environments/$env/docker-compose.$env.yml" ]; then
        docker-compose -f "environments/$env/docker-compose.$env.yml" down -v --remove-orphans
        print_success "$env environment cleaned!"
    else
        print_error "Docker compose file not found: environments/$env/docker-compose.$env.yml"
        exit 1
    fi
}

# Function to run migrations
run_migrations() {
    local env=$1
    print_info "Running migrations for $env environment..."
    
    # Ensure environment is set up
    if [ ! -f ".env" ]; then
        setup_environment $env
    fi
    
    # Run migrations
    npm run migrate:dev
    
    print_success "Migrations completed!"
}

# Main script logic
main() {
    if [ $# -lt 1 ]; then
        show_usage
        exit 1
    fi
    
    local command=$1
    local environment=$2
    
    case $command in
        "setup")
            if [ -z "$environment" ]; then
                print_error "Environment required for setup command"
                show_usage
                exit 1
            fi
            validate_environment $environment
            setup_environment $environment
            ;;
        "start")
            if [ -z "$environment" ]; then
                print_error "Environment required for start command"
                show_usage
                exit 1
            fi
            validate_environment $environment
            start_services $environment
            ;;
        "stop")
            if [ -z "$environment" ]; then
                print_error "Environment required for stop command"
                show_usage
                exit 1
            fi
            validate_environment $environment
            stop_services $environment
            ;;
        "restart")
            if [ -z "$environment" ]; then
                print_error "Environment required for restart command"
                show_usage
                exit 1
            fi
            validate_environment $environment
            restart_services $environment
            ;;
        "logs")
            if [ -z "$environment" ]; then
                print_error "Environment required for logs command"
                show_usage
                exit 1
            fi
            validate_environment $environment
            show_logs $environment
            ;;
        "status")
            if [ -z "$environment" ]; then
                print_error "Environment required for status command"
                show_usage
                exit 1
            fi
            validate_environment $environment
            show_status $environment
            ;;
        "clean")
            if [ -z "$environment" ]; then
                print_error "Environment required for clean command"
                show_usage
                exit 1
            fi
            validate_environment $environment
            clean_environment $environment
            ;;
        "migrate")
            if [ -z "$environment" ]; then
                print_error "Environment required for migrate command"
                show_usage
                exit 1
            fi
            validate_environment $environment
            run_migrations $environment
            ;;
        *)
            print_error "Unknown command: $command"
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
