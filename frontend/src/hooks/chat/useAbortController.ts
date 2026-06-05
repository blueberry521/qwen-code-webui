import { useCallback } from "react";
import { getAbortUrl, getPermissionRespondUrl } from "../../config/api";

export function useAbortController() {
  // Helper function to perform abort request
  const performAbortRequest = useCallback(async (requestId: string) => {
    const response = await fetch(getAbortUrl(requestId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (response.status === 404) {
      return response;
    }

    if (!response.ok) {
      throw new Error(`Failed to abort request: ${response.status} ${response.statusText}`);
    }

    return response;
  }, []);

  const abortRequest = useCallback(
    async (
      requestId: string | null,
      isLoading: boolean,
    ) => {
      if (!requestId || !isLoading) return;

      return performAbortRequest(requestId);
    },
    [performAbortRequest],
  );

  const createAbortHandler = useCallback(
    (requestId: string) => async () => {
      try {
        await performAbortRequest(requestId);
      } catch (error) {
        console.error("Failed to abort request:", error);
      }
    },
    [performAbortRequest],
  );

  return {
    abortRequest,
    createAbortHandler,
  };
}

/**
 * Send a permission response to the backend for proactive canUseTool flow.
 * Standalone function (not a hook) since it's a simple HTTP POST.
 */
export async function sendPermissionResponse(
  permissionId: string,
  behavior: "allow" | "deny",
  options?: {
    message?: string;
    updatedInput?: Record<string, unknown>;
    scope?: "specific" | "all";
    answers?: Record<string, string>;
  },
): Promise<Response> {
  return fetch(getPermissionRespondUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissionId, behavior, ...options }),
  });
}
