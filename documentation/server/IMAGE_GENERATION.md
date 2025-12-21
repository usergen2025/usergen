# Image Generation System

## Overview

The image generation system provides a flexible, multi-provider architecture for generating B-roll images for video projects. It supports multiple AI providers (FAL, BytePlus) and allows users to select different models for image generation.

## Architecture

### Provider Abstraction

The system uses a provider abstraction pattern (`IImageGenerationProvider`) that allows easy switching between different image generation providers:

```
IImageGenerationProvider (Interface)
├── FalProvider (FAL API implementation)
├── BytePlusProvider (BytePlus API implementation)
└── [Future providers can be added easily]
```

### Key Components

1. **Provider Interface** (`IImageGenerationProvider`)
   - Unified interface for all image generation providers
   - Handles request normalization and response standardization

2. **FAL Provider** (`FalProvider`)
   - Implements async image generation via FAL API
   - Handles polling, error handling, and retries
   - Supports 4 FAL models:
     - Model 1: `fal-ai/imagen4/preview/ultra` (Default)
     - Model 2: `fal-ai/nano-banana`
     - Model 3: `fal-ai/reve/text-to-image`
     - Model 4: `fal-ai/nano-banana-pro`

3. **BytePlus Provider** (`BytePlusProvider`)
   - Implements synchronous image generation via BytePlus API
   - Model 5: `seedream-4-0-250828`

4. **Model Registry** (`ModelRegistryService`)
   - Centralized configuration for all available models
   - Manages model metadata, capabilities, and default settings

5. **Provider Factory** (`ProviderFactory`)
   - Routes requests to the correct provider based on model selection
   - Manages provider instances

6. **Image Generation Processor** (`ImageGenerationProcessor`)
   - Queue worker that processes image generation jobs
   - Handles provider selection, request building, and error handling

## Available Models

| Model ID | Display Name | Platform | Default Config |
|----------|--------------|----------|----------------|
| `model-1` | Model 1 | FAL | Resolution: 2K, Format: PNG |
| `model-2` | Model 2 | FAL | Format: PNG |
| `model-3` | Model 3 | FAL | Format: PNG |
| `model-4` | Model 4 | FAL | Resolution: 1K, Format: PNG |
| `model-5` | Model 5 | BytePlus | Resolution: 2K, Format: PNG |

**Default Model**: `model-1` (FAL imagen4/preview/ultra)

## API Endpoints

### Regenerate Image

```http
POST /api/video-projects/:projectId/regenerate-image/:sceneNumber
Authorization: Bearer <token>
Content-Type: application/json

{
  "prompt": "Optional prompt override",
  "modelId": "model-1",  // Optional, defaults to model-1
  "aspectRatio": "9:16", // Optional override
  "resolution": "2K",    // Optional override
  "force": false          // Force regeneration even if image exists
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "image-projectId-sceneNumber-timestamp",
    "existing": false
  },
  "message": "Image generation queued successfully"
}
```

### Get Available Models

```http
GET /api/video-projects/image-generation-models
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "models": [
      {
        "id": "model-1",
        "displayName": "Model 1",
        "platform": "FAL",
        "defaultConfig": {
          "aspectRatio": "9:16",
          "resolution": "2K",
          "outputFormat": "png",
          "numImages": 1
        },
        "capabilities": {
          "supportsAspectRatio": true,
          "supportsResolution": true,
          "supportsNumImages": true,
          "isAsync": true,
          "estimatedTimeSeconds": 30
        }
      },
      // ... other models
    ],
    "default": "model-1"
  }
}
```

## Configuration

### Environment Variables

```bash
# FAL Configuration
FAL_KEY=your-fal-api-key-here

# BytePlus Configuration
BYTEPLUS_API_KEY=your-byteplus-api-key
BYTEPLUS_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3
```

### Model Configuration

Models are configured in `ModelRegistryService`. To add a new model:

1. Add model configuration to `ModelRegistryService.initializeModels()`
2. Ensure the provider (FAL or BytePlus) is properly configured
3. Update the model registry with model metadata

## Error Handling

### FAL Error Handling

The FAL provider implements comprehensive error handling based on [FAL's error documentation](https://docs.fal.ai/model-apis/errors):

- **Retryable Errors**: Checked via `X-Fal-Retryable` header
  - `internal_server_error` (500)
  - `generation_timeout` (504)
  - `downstream_service_error` (400)
  - `downstream_service_unavailable` (500)

- **Non-Retryable Errors**: Client-side issues
  - `content_policy_violation` (422)
  - `feature_not_supported` (422)
  - Validation errors (422)

### Error Response Format

```json
{
  "success": false,
  "error": "User-friendly error message",
  "metadata": {
    "retryable": false,
    "errorType": "content_policy_violation"
  }
}
```

## Usage Flow

1. **User selects model** (via UI model selector)
2. **Frontend calls API** with `modelId` parameter
3. **API queues job** with model information
4. **Processor picks job** and:
   - Gets model configuration from registry
   - Routes to appropriate provider via factory
   - Generates image using unified interface
   - Downloads and stores image locally
   - Updates database with image metadata
5. **WebSocket notification** sent to frontend
6. **Frontend updates UI** with generated image

## Adding a New Provider

1. **Create provider class** implementing `IImageGenerationProvider`
2. **Implement required methods**:
   - `generateImage()`
   - `getCapabilities()`
   - `getSupportedModels()`
   - `validateRequest()`
3. **Register in ProviderFactory**
4. **Add to RenderingModule** providers/exports
5. **Update ModelRegistryService** with new models

## Adding a New Model

1. **Add model to ModelRegistryService**:
   ```typescript
   this.models.set('model-X', {
     id: 'provider/model-id',
     displayName: 'Model X',
     platform: 'FAL' | 'BYTEPLUS',
     capabilities: { ... },
     defaultConfig: { ... },
   });
   ```
2. **Ensure provider supports the model**
3. **Test model with various prompts and configurations**

## Frontend Integration

### Model Selection

The frontend provides a `ModelSelector` component that:
- Fetches available models from API
- Displays models in a dropdown
- Highlights selected model
- Allows per-scene model selection

### Usage Example

```typescript
import { ModelSelector } from '@/components/create-video/ModelSelector';

<ModelSelector
  selectedModelId={selectedModels[sceneNumber] || 'model-1'}
  onModelSelect={(modelId) => {
    setSelectedModels(prev => ({
      ...prev,
      [sceneNumber]: modelId,
    }));
  }}
  disabled={isRegenerating}
/>
```

## Best Practices

1. **Model Selection**: Default to `model-1` (FAL imagen4) for best quality
2. **Error Handling**: Always check `retryable` flag before retrying
3. **Progress Updates**: Use progress callbacks for long-running operations
4. **Validation**: Validate requests before submission to avoid API errors
5. **Caching**: Consider caching model lists to reduce API calls

## Troubleshooting

### Common Issues

1. **FAL_KEY not configured**
   - Error: "FAL_KEY is required but not configured"
   - Solution: Add `FAL_KEY` to environment variables

2. **Model not found**
   - Error: "Model not found: model-X"
   - Solution: Ensure model is registered in `ModelRegistryService`

3. **Generation timeout**
   - Error: "Request exceeded maximum duration"
   - Solution: Check FAL API status, may need to increase timeout

4. **Content policy violation**
   - Error: "Content violates usage policies"
   - Solution: Modify prompt to remove prohibited content

## Future Enhancements

- [ ] Per-project model preferences
- [ ] Model quality metrics and A/B testing
- [ ] Cost tracking per model/provider
- [ ] Automatic fallback to alternative models
- [ ] Model performance analytics
- [ ] Support for additional providers (OpenAI DALL-E, Stability AI, etc.)

