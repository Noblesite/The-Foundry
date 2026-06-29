export interface ModelLiteracySource {
  modelId?: string | null;
  label?: string | null;
  libraryName?: string | null;
  pipelineTag?: string | null;
  tags?: string[] | null;
  parameterCount?: number | null;
  contextWindow?: number | null;
  modelType?: string | null;
  architectures?: string[] | null;
  repositoryFiles?: Array<{ rfilename?: string | null; size?: number | null }> | null;
  configReadable?: boolean | null;
  tokenizerReadable?: boolean | null;
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

const readableList = (items: string[]) => {
  if (items.length === 0) {
    return "";
  }
  if (items.length === 1) {
    return items[0];
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};

const getRepositoryFileNames = (source: ModelLiteracySource) =>
  (source.repositoryFiles || [])
    .map((file) => file.rfilename || "")
    .filter(Boolean);

const getTokenizerFileSummary = (
  source: ModelLiteracySource,
  repositoryFileNames: string[]
) => {
  const tokenizerFiles = repositoryFileNames.filter((name) => {
    const basename = name.split("/").pop()?.toLowerCase() || name.toLowerCase();
    return (
      basename.startsWith("tokenizer") ||
      basename === "vocab.json" ||
      basename === "merges.txt" ||
      basename === "sentencepiece.bpe.model" ||
      basename === "special_tokens_map.json"
    );
  });

  if (tokenizerFiles.length > 0) {
    return `Detected tokenizer files: ${readableList(tokenizerFiles.slice(0, 4))}.`;
  }
  if (source.tokenizerReadable === true) {
    return "The local tokenizer loaded during preflight, so prompts can be converted into model tokens.";
  }
  if (source.tokenizerReadable === false) {
    return "Tokenizer files were not readable during preflight; loading should stay blocked until that is fixed.";
  }
  return "Tokenizer files are unknown until the model is inspected or cached.";
};

const getConfigSummary = (source: ModelLiteracySource, repositoryFileNames: string[]) => {
  const hasConfig = repositoryFileNames.some((name) => name.endsWith("config.json"));
  if (hasConfig) {
    return "Repository metadata includes config.json, which is where architecture and context limits usually begin.";
  }
  if (source.configReadable === true) {
    return "The local config loaded during preflight, so architecture and memory estimates are grounded in model metadata.";
  }
  if (source.configReadable === false) {
    return "Model config was not readable during preflight; memory and layer estimates are uncertain.";
  }
  return "Config metadata is unknown until inspection or preflight reads the model files.";
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
  const repositoryFileNames = getRepositoryFileNames(source);
  const contextWindow = source.contextWindow && source.contextWindow > 0
    ? source.contextWindow.toLocaleString()
    : "unknown";
  const runtimeMode = source.runtimeMode || "not loaded";
  const architectureSummary = source.architectures?.length
    ? `Architecture: ${readableList(source.architectures)}.`
    : source.modelType
      ? `Model type: ${source.modelType}.`
      : getConfigSummary(source, repositoryFileNames);
  const tokenizerSummary = getTokenizerFileSummary(source, repositoryFileNames);
  const cacheState = source.cached
    ? "This model is cached locally, so preflight can validate tokenizer files and runtime metadata."
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
          architectureSummary,
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
          tokenizerSummary,
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
