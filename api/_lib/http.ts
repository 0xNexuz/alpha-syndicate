import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ComplianceService } from "../../src/lib/services.js";

export type ApiHandler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

export function withApi(handler: ApiHandler): ApiHandler {
  return async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    try {
      await handler(req, res);
    } catch (error) {
      const err = error as Error & { status?: number };
      res.status(err.status ?? 500).json({
        error: err.message,
        status: err.status ?? 500
      });
    }
  };
}

export function requireCompliantAgent(req: VercelRequest) {
  const agentId = req.headers["x-agent-id"];
  if (typeof agentId !== "string") {
    throw Object.assign(new Error("missing_x_agent_id"), { status: 401 });
  }

  return ComplianceService.assertApproved(agentId);
}

function applyCors(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.GATEWAY_ALLOWED_ORIGIN ?? req.headers.origin ?? "*";
  res.setHeader("access-control-allow-origin", allowedOrigin);
  res.setHeader("access-control-allow-headers", "content-type,x-agent-id,x-payment");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
}
