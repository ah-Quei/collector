import type { AgentInputItem, Model, ModelProvider, ModelRequest, ModelResponse, StreamEvent } from '@openai/agents';

export interface RegisteredImageInput {
    id: string;
    path: string;
    mimeType: string;
    size: number;
    dataUrl: string;
}

export interface ImageInputMetadata {
    id: string;
    path: string;
    mimeType: string;
    size: number;
}

export class ImageInputRegistry {
    private images = new Map<string, RegisteredImageInput>();
    private nextId = 1;

    add(image: Omit<RegisteredImageInput, 'id'>): ImageInputMetadata {
        const id = `img_${String(this.nextId++).padStart(3, '0')}`;
        const registered = { id, ...image };
        this.images.set(id, registered);
        return withoutDataUrl(registered);
    }

    get(id: string): RegisteredImageInput | null {
        return this.images.get(id) ?? null;
    }

    clear(): void {
        this.images.clear();
    }
}

export class ImageInjectingModelProvider implements ModelProvider {
    constructor(
        private delegate: ModelProvider,
        private getRegistry: () => ImageInputRegistry,
    ) {}

    async getModel(modelName?: string): Promise<Model> {
        const model = await this.delegate.getModel(modelName);
        return new ImageInjectingModel(model, this.getRegistry);
    }
}

class ImageInjectingModel implements Model {
    constructor(
        private delegate: Model,
        private getRegistry: () => ImageInputRegistry,
    ) {}

    getResponse(request: ModelRequest): Promise<ModelResponse> {
        return this.delegate.getResponse(this.withInjectedImages(request));
    }

    getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
        return this.delegate.getStreamedResponse(this.withInjectedImages(request));
    }

    private withInjectedImages(request: ModelRequest): ModelRequest {
        if (typeof request.input === 'string') return request;

        const registry = this.getRegistry();
        const input: AgentInputItem[] = [];
        const allImageIds: string[] = [];

        for (const item of request.input) {
            input.push(item);
            const imageIds = getImageInputIds(item);
            allImageIds.push(...imageIds);
        }

        // Inject all images as a single user message AFTER all tool results
        // to maintain proper message ordering (assistant -> tools -> user)
        if (allImageIds.length > 0) {
            const content: Array<
                | { type: 'input_text'; text: string }
                | { type: 'input_image'; image: string }
            > = [
                {
                    type: 'input_text',
                    text: 'Images returned by read_image_asset are attached below as multimodal input. Analyze their visible text and visual content before producing the final article.',
                },
            ];

            for (const id of allImageIds) {
                const image = registry.get(id);
                if (!image) continue;
                content.push({ type: 'input_text', text: `Image file: ${image.path} (${image.mimeType}, ${image.size} bytes)` });
                content.push({ type: 'input_image', image: image.dataUrl });
            }

            if (content.length > 1) {
                input.push({ role: 'user', content });
            }
        }

        return { ...request, input };
    }
}

function getImageInputIds(item: AgentInputItem): string[] {
    if (item.type !== 'function_call_result') return [];
    if (item.name !== 'read_image_asset') return [];
    if (item.output.type !== 'text') return [];

    try {
        const parsed = JSON.parse(item.output.text);
        const payload = parsed?.ok === true && parsed.data ? parsed.data : parsed;
        if (payload?.mode !== 'image_inputs' || !Array.isArray(payload.imageInputIds)) return [];
        return payload.imageInputIds.filter((id: unknown): id is string => typeof id === 'string');
    } catch {
        return [];
    }
}

function withoutDataUrl(image: RegisteredImageInput): ImageInputMetadata {
    return {
        id: image.id,
        path: image.path,
        mimeType: image.mimeType,
        size: image.size,
    };
}
