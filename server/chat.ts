import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleChatHttp } from "../src/lib/chat.js";

export const maxDuration = 30;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await handleChatHttp(req, res);
}
