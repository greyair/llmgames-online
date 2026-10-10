export class CredentialRequestError extends Error {
  readonly requiresReauthentication: boolean;
  constructor(message: string, code?: string) {
    super(message);
    this.requiresReauthentication = code === "REAUTHENTICATION_REQUIRED";
  }
}
