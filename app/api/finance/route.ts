import { requireActor, sameOrigin, jsonBody, failure } from "../../../server/auth.mjs";
import { admin } from "../../../server/firebase.mjs";
import { canAccessFinance } from "../../../server/policy.mjs";
import { validateLedger } from "../../../server/finance.mjs";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

async function financeActor() {
  const actor = await requireActor();
  if (!canAccessFinance(actor.role)) throw Object.assign(Error("Finance access required."), {status:403});
  return actor;
}

export async function GET() {
  try {
    const actor = await financeActor();
    const doc = await admin().db.doc("cms_finance/ledger").get();
    const data = doc.data();
    return Response.json({canOpenWorkspace:actor.role === "admin",version:data?.version ?? 0, rows:data?.rows ?? [], trips:data?.trips ?? []},{headers});
  } catch(error) { return failure(error); }
}

export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const actor = await financeActor();
    const ledger = validateLedger(await jsonBody(request, 600000));
    const {db} = admin();
    const ref = db.doc("cms_finance/ledger");
    const version = await db.runTransaction(async tx => {
      const prior = await tx.get(ref);
      if ((prior.data()?.version ?? 0) !== ledger.version) {
        throw Object.assign(Error("Finance changed in another session. Reload before saving."),{status:409});
      }
      const version = ledger.version + 1;
      tx.set(ref,{...ledger,version,updatedBy:actor.uid,updatedAt:new Date().toISOString()});
      return version;
    });
    return Response.json({version},{headers});
  } catch(error) { return failure(error); }
}
