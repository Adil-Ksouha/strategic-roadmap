export type PrivateCredentialFields = {
  email: string;
  password: string;
  name?: string;
  bootstrapToken?: string;
  teamId?: string;
};

export function normalizePrivateCredentialFields(fields: PrivateCredentialFields) {
  return {
    email: fields.email.trim(),
    password: fields.password,
    name: fields.name?.trim() ?? "",
    bootstrapToken: fields.bootstrapToken ?? "",
    teamId: fields.teamId ?? "1",
  };
}
