import {
  ApiEventLog,
  DeliverEventResponseSchema,
  ErrorWithStackSchema,
  HttpSourceRequest,
  HttpSourceResponseSchema,
  IndexEndpointResponseSchema,
  PongResponse,
  PongResponseSchema,
  PreprocessRunBody,
  PreprocessRunResponseSchema,
  RegisterTriggerBody,
  RegisterTriggerBodySchema,
  RunJobBody,
  RunJobResponseSchema,
} from "@trigger.dev/internal";
import { safeBodyFromResponse } from "~/utils/json";
import { logger } from "./logger.server";

export class EndpointApiError extends Error {
  constructor(message: string, stack?: string) {
    super(`EndpointApiError: ${message}`);
    this.stack = stack;
    this.name = "EndpointApiError";
  }
}

// TODO: this should work with tunnelling
export class EndpointApi {
  constructor(
    private apiKey: string,
    private url: string,
    private id: string
  ) {}

  async ping(): Promise<PongResponse> {
    const response = await safeFetch(this.url, {
      method: "POST",
      headers: {
        "x-trigger-api-key": this.apiKey,
        "x-trigger-endpoint-id": this.id,
        "x-trigger-action": "PING",
      },
    });

    if (!response) {
      return {
        ok: false,
        error: `Could not connect to endpoint ${this.url}`,
      };
    }

    if (response.status === 401) {
      const body = await safeBodyFromResponse(response, ErrorWithStackSchema);

      if (body) {
        return {
          ok: false,
          error: body.message,
        } as const;
      }

      return {
        ok: false,
        error: `Trigger API key is invalid`,
      } as const;
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `Could not connect to endpoint ${this.url}. Status code: ${response.status}`,
      };
    }

    const anyBody = await response.json();

    logger.debug("ping() response from endpoint", {
      body: anyBody,
    });

    return PongResponseSchema.parse(anyBody);
  }

  async indexEndpoint() {
    const response = await safeFetch(this.url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "x-trigger-api-key": this.apiKey,
        "x-trigger-action": "INDEX_ENDPOINT",
      },
    });

    if (!response) {
      throw new Error(`Could not connect to endpoint ${this.url}`);
    }

    if (response.status === 401) {
      const body = await safeBodyFromResponse(response, ErrorWithStackSchema);

      if (body) {
        return {
          ok: false,
          error: body.message,
        } as const;
      }

      return {
        ok: false,
        error: `Trigger API key is invalid`,
      } as const;
    }

    if (!response.ok) {
      throw new Error(
        `Could not connect to endpoint ${this.url}. Status code: ${response.status}`
      );
    }

    const anyBody = await response.json();

    const data = IndexEndpointResponseSchema.parse(anyBody);

    return {
      ok: true,
      data,
    } as const;
  }

  async deliverEvent(event: ApiEventLog) {
    const response = await safeFetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trigger-api-key": this.apiKey,
        "x-trigger-action": "DELIVER_EVENT",
      },
      body: JSON.stringify(event),
    });

    if (!response) {
      throw new Error(`Could not connect to endpoint ${this.url}`);
    }

    if (!response.ok) {
      throw new Error(
        `Could not connect to endpoint ${this.url}. Status code: ${response.status}`
      );
    }

    const anyBody = await response.json();

    logger.debug("deliverEvent() response from endpoint", {
      body: anyBody,
    });

    return DeliverEventResponseSchema.parse(anyBody);
  }

  async executeJobRequest(options: RunJobBody) {
    const response = await safeFetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-trigger-api-key": this.apiKey,
        "x-trigger-action": "EXECUTE_JOB",
      },
      body: JSON.stringify(options),
    });

    return {
      response,
      parser: RunJobResponseSchema,
      errorParser: ErrorWithStackSchema,
    };
  }

  async preprocessRunRequest(options: PreprocessRunBody) {
    const response = await safeFetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trigger-api-key": this.apiKey,
        "x-trigger-action": "PREPROCESS_RUN",
      },
      body: JSON.stringify(options),
    });

    return { response, parser: PreprocessRunResponseSchema };
  }

  async initializeTrigger(
    id: string,
    params: any
  ): Promise<RegisterTriggerBody | undefined> {
    const response = await safeFetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trigger-api-key": this.apiKey,
        "x-trigger-action": "INITIALIZE_TRIGGER",
      },
      body: JSON.stringify({ id, params }),
    });

    if (!response) {
      throw new Error(`Could not connect to endpoint ${this.url}`);
    }

    if (!response.ok) {
      // Attempt to parse the error message
      const anyBody = await response.json();

      const error = ErrorWithStackSchema.safeParse(anyBody);

      if (error.success) {
        throw new EndpointApiError(error.data.message, error.data.stack);
      }

      throw new Error(
        `Could not connect to endpoint ${this.url}. Status code: ${response.status}`
      );
    }

    const anyBody = await response.json();

    logger.debug("initializeTrigger() response from endpoint", {
      body: anyBody,
    });

    return RegisterTriggerBodySchema.parse(anyBody);
  }

  async deliverHttpSourceRequest(options: {
    key: string;
    dynamicId?: string;
    secret: string;
    params: any;
    data: any;
    request: HttpSourceRequest;
  }) {
    const response = await safeFetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-trigger-api-key": this.apiKey,
        "x-trigger-action": "DELIVER_HTTP_SOURCE_REQUEST",
        "x-ts-key": options.key,
        "x-ts-secret": options.secret,
        "x-ts-params": JSON.stringify(options.params ?? {}),
        "x-ts-data": JSON.stringify(options.data ?? {}),
        "x-ts-http-url": options.request.url,
        "x-ts-http-method": options.request.method,
        "x-ts-http-headers": JSON.stringify(options.request.headers),
        ...(options.dynamicId && { "x-ts-dynamic-id": options.dynamicId }),
      },
      body: options.request.rawBody,
    });

    if (!response) {
      throw new Error(`Could not connect to endpoint ${this.url}`);
    }

    if (!response.ok) {
      throw new Error(
        `Could not connect to endpoint ${this.url}. Status code: ${response.status}`
      );
    }

    const anyBody = await response.json();

    logger.debug("deliverHttpSourceRequest() response from endpoint", {
      body: anyBody,
    });

    return HttpSourceResponseSchema.parse(anyBody);
  }
}

async function safeFetch(url: string, options: RequestInit) {
  try {
    return await fetch(url, addStandardRequestOptions(options));
  } catch (error) {
    logger.debug("Error while trying to connect to endpoint", {
      url,
      error,
    });
  }
}

function addStandardRequestOptions(options: RequestInit) {
  return {
    ...options,
    headers: {
      ...options.headers,
      "user-agent": "triggerdotdev-server/2.0.0",
    },
  };
}
