/**
 * Pricing information for different AI models
 * Prices are in USD per 1 million tokens
 */

export const MODEL_PRICING = {
  "models/gemini-flash-latest": {
    inputCostPerMillion: 0.30,
    outputCostPerMillion: 2.5,
    name: "Gemini 2.5 Flash",
  },
  "models/gemini-pro": {
    inputCostPerMillion: 0.5,
    outputCostPerMillion: 1.5,
    name: "Gemini Pro",
  },
  // Add more models as needed
};

export interface TokenCost {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

/**
 * Calculate the cost of tokens for a given model
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param modelName - Name of the model (default: gemini-flash-latest)
 * @returns TokenCost object with input, output, and total costs
 */
export function calculateTokenCost(
  inputTokens: number,
  outputTokens: number,
  modelName: string = "models/gemini-flash-latest"
): TokenCost {
  const pricing = MODEL_PRICING[modelName as keyof typeof MODEL_PRICING];

  if (!pricing) {
    console.warn(`Pricing not found for model: ${modelName}. Using default.`);
    const defaultPricing = MODEL_PRICING["models/gemini-flash-latest"];
    const inputCost = (inputTokens / 1_000_000) * defaultPricing.inputCostPerMillion;
    const outputCost = (outputTokens / 1_000_000) * defaultPricing.outputCostPerMillion;
    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputCostPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputCostPerMillion;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

/**
 * Format cost as USD string
 * @param cost - Cost in USD
 * @returns Formatted USD string
 */
export function formatCostAsUSD(cost: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(cost);
}
