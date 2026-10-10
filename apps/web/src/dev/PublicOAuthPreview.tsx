import { OAuthPreview } from "./FlowPreview";

export default function PublicOAuthPreview() {
  return <OAuthPreview state={new URLSearchParams(location.search).get("state") ?? "consent"} />;
}
