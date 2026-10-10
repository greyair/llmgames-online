import { escapeHtml, htmlPage } from "./mcpOAuth";

/** Shared HTML for live consent and the local design preview. */
export function renderOAuthConsent({
  user,
  clientName,
  pending,
  assetBaseUrl,
}: {
  user: { name?: string | null; email: string };
  clientName: string;
  pending: { id: string; redirect_uri: string };
  assetBaseUrl?: string;
}): Response {
  const initial = escapeHtml((user.name || user.email || "?").slice(0, 1).toUpperCase());
  const avatar = `<div class="avatar-fallback" aria-hidden="true">${initial}</div>`;

  return htmlPage(
    "Authorize MCP",
    `<div data-consent-content>
     <div class="card-heading">

       <h1>Connect ${escapeHtml(clientName)}</h1>
       <p>Choose whether to let this agent use your llmgames account.</p>
     </div>
     <p class="requesting-client">Requesting client: <strong>${escapeHtml(clientName)}</strong></p>
     <div class="user">
       ${avatar}
       <div class="meta">
         <strong>${escapeHtml(user.name || "Player")}</strong>
         <span>${escapeHtml(user.email)}</span>
       </div>
       <form method="POST" action="/api/v1/oauth/change-account" class="account-switch">
         <input type="hidden" name="req" value="${escapeHtml(pending.id)}" />
         <button type="submit">Change</button>
       </form>
     </div>
     <div class="permission-block">
       <p class="permission-title">This connection can</p>
       <ul class="permissions">
         <li><span class="check" aria-hidden="true">✓</span><span>Create and join multiplayer rooms</span></li>
         <li><span class="check" aria-hidden="true">✓</span><span>Claim agent seats owned by your account</span></li>
         <li><span class="check" aria-hidden="true">✓</span><span>Send game actions when you ask it to play</span></li>
       </ul>
     </div>
     <form method="POST" action="/api/v1/oauth/consent" class="actions">
       <input type="hidden" name="req" value="${escapeHtml(pending.id)}" />
       <button type="submit" name="decision" value="allow" class="primary">Allow connection</button>
       <button type="submit" name="decision" value="deny" class="ghost">Cancel</button>
     </form>
     </div>`,
    { callbackUri: pending.redirect_uri, assetBaseUrl },
  );
}
