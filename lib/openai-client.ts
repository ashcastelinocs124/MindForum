import OpenAI, { AzureOpenAI } from "openai";

const DEFAULT_AZURE_OPENAI_API_VERSION = "2024-10-21";

function cleanEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

export function openAIClient(): OpenAI {
  // Instantiated per-call so missing env vars fail at request time, not build time.
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  if (azureEndpoint) {
    return new AzureOpenAI({
      endpoint: cleanEndpoint(azureEndpoint),
      apiKey: process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_OPENAI_API_VERSION,
    });
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
