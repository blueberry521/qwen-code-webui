export async function loadQwenQuery(): Promise<typeof import("@qwen-code/sdk").query> {
  const sdk = await import("@qwen-code/sdk");
  return sdk.query;
}
