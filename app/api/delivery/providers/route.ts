import { deliveryConnectionSummary } from "../../../../lib/delivery";

export async function GET() {
  return Response.json(deliveryConnectionSummary(), { headers: { "cache-control": "no-store" } });
}
