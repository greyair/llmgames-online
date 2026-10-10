import { publicAiSpec } from "../../src/interface/aiSpecData";

export function GET() {
  return new Response(`${JSON.stringify(publicAiSpec, null, 2)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
