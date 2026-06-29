export interface ModelLiteracySource {
  modelId?: string | null;
  label?: string | null;
  libraryName?: string | null;
  pipelineTag?: string | null;
  tags?: string[] | null;
  parameterCount?: number | null;
  contextWindow?: number | null;
  runtimeMode?: string | null;
  cached?: boolean;
  source?: "archive" | "construct" | "artifact";
}

export interface ModelLiteracyCard {
  id: string;
  title: string;
  icon: string;
  body: string;
  bullets: string[];
}

export interface ModelLiteracyProfile {
  modelId: string;
  label: string;
  family: string;
  purpose: string;
  cards: ModelLiteracyCard[];
}

const DEFAULT_MODEL_ID = "No model selected";

const includesAny = (haystack: string, needles: string[]) =>
  needles.some((needle) => haystack.includes(needle));

const formatParameterCount = (parameterCount?: number | null) => {
  if (!parameterCount || parameterCount <= 0) {
    return "Parameter count is unknown until model metadata is inspected.";
  }
  if (parameterCount >= 1_000_000_000) {
    return `Roughly ${(parameterCount / 1_000_000_000).toFixed(1)}B parameters.`;
  }
  if (parameterCount >= 1_000_000) {
    return `Roughly ${(parameterCount / 1_000_000).toFixed(1)}M parameters.`;
  }
  return `${parameterCount.toLocaleString()} parameters.`;
};

const getModelShortName = (modelId: string) => {
  const parts = modelId.split("/").filter(Boolean);
  return parts[parts.length - 1] || modelId;
};

const inferModelFamily = (source: ModelLiteracySource) => {
  const searchableText = [
    source.modelId,
    source.libraryName,
    source.pipelineTag,
    ...(source.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (includesAny(searchableText, ["sentence-transformers", "embedding", "feature-extraction"])) {
    return {
      family: "Embedding or retrieval model",
      purpose: "Turns text into vectors for search, clustering, and Library retrieval rather than persona chat.",
    };
  }

  if (includesAny(searchableText, ["text2text", "seq2seq", "t5", "flan"])) {
    return {
      family: "Encoder-decoder language model",
      purpose: "Reads an input sequence with an encoder, then generates an output sequence with a decoder.",
    };
  }

  if (includesAny(searchableText, ["vision", "image", "vlm", "multimodal"])) {
    return {
      family: "Vision or multimodal model",
      purpose: "Combines text with visual inputs, which requires a wrapper that knows how to prepare both modalities.",
    };
  }

  if (includesAny(searchableText, ["audio", "speech", "whisper", "asr"])) {
    return {
      family: "Speech or audio model",
      purpose: "Processes audio features or transcripts before producing text, labels, or embeddings.",
    };
  }

  if (includesAny(searchableText, ["instruct", "chat", "assistant"])) {
    return {
      family: "Instruction-tuned causal language model",
      purpose: "Predicts the next token while following chat-style system and user instructions.",
    };
  }

  return {
    family: "Causal language model",
    purpose: "Predicts the next token from the prompt and context it receives from the wrapper.",
  };
};

export const buildModelLiteracyProfile = (
  source: ModelLiteracySource
): ModelLiteracyProfile => {
  const modelId = source.modelId?.trim() || DEFAULT_MODEL_ID;
  const label = source.label?.trim() || getModelShortName(modelId);
  const inferred = inferModelFamily(source);
  const contextWindow = source.contextWindow && source.contextWindow > 0
    ? source.contextWindow.toLocaleString()
    : "unknown";
  const runtimeMode = source.runtimeMode || "not loaded";
  const cacheState = source.cached
    ? "This model is cached locally, so the next proof should inspect tokenizer files and runtime metadata."
    : "This model may still be remote; inspect the tokenizer after it is cached before trusting exact control tokens.";

  return {
    modelId,
    label,
    family: inferred.family,
    purpose: inferred.purpose,
    cards: [
      {
        id: "purpose",
        title: "Model purpose",
        icon: "fa-compass-drafting",
        body: inferred.purpose,
        bullets: [
          inferred.family,
          formatParameterCount(source.parameterCount),
          `Current surface: ${source.source || "model browser"}.`,
        ],
      },
      {
        id: "layers",
        title: "Layer families",
        icon: "fa-diagram-project",
        body:
          "Most local chat models use stacked Transformer blocks: token embeddings, attention projections, feed-forward layers, normalization, and a language-model head.",
        bullets: [
          "Q, K, and V attention projections help each token compare itself to other tokens in the context.",
          "MLP or feed-forward layers reshape the attended signal into useful features.",
          "LoRA adapters usually attach small trainable matrices to attention or MLP projections.",
        ],
      },
      {
        id: "reserved-tokens",
        title: "Reserved tokens",
        icon: "fa-key",
        body:
          "Tokenizers usually reserve special tokens for beginning, ending, padding, unknown text, and chat roles.",
        bullets: [
          "System, user, and assistant markers are wrapper-facing control tokens when a chat template exists.",
          "Stop or end-of-sequence tokens tell the wrapper when to stop streaming.",
          cacheState,
        ],
      },
      {
        id: "context-budget",
        title: "Context budget",
        icon: "fa-window-maximize",
        body:
          "The context window is the token budget shared by system prompt, user prompt, Library context, tool results, and generated output.",
        bullets: [
          `Configured or detected context window: ${contextWindow} tokens.`,
          "Long prompts leave fewer tokens for answers, so retrieval and chunking must be selective.",
          "Reserved tokens and chat templates also consume part of the budget.",
        ],
      },
      {
        id: "wrapper-logic",
        title: "Wrapper behavior",
        icon: "fa-route",
        body:
          "The model does not take action on its own. The Foundry wrapper sends prompts, streams tokens, watches for stop or request patterns, and decides the next call.",
        bullets: [
          `Current runtime mode: ${runtimeMode}.`,
          "For RAG, the wrapper retrieves Library context and appends it before the model sees the prompt.",
          "For agents or tools, the wrapper validates structured output before running any external action.",
        ],
      },
    ],
  };
};
