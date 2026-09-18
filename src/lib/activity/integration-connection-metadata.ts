// Safe metadata builder for INTEGRATION_CONNECTION / CREATED|UPDATED|
// STATUS_CHANGED Activity events (Integrations V1, locked spec §29).
// Never includes: the raw webhook URL, the encrypted credential, the
// credential key version, or any raw provider response — only the
// provider identifier, the actor's display name, and (for a status
// transition) the from/to status strings ever appear here.

export type IntegrationConnectionActivityMetadata = {
  provider: string;
  actorName: string;
  from?: string;
  to?: string;
};

export function buildIntegrationConnectionMetadata(params: {
  provider: string;
  actorName: string;
  from?: string;
  to?: string;
}): IntegrationConnectionActivityMetadata {
  const metadata: IntegrationConnectionActivityMetadata = { provider: params.provider, actorName: params.actorName };
  if (params.from !== undefined) metadata.from = params.from;
  if (params.to !== undefined) metadata.to = params.to;
  return metadata;
}
