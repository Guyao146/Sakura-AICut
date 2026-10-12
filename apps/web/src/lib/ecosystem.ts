export interface PairingView {
  id: string; code: string; name: string; peerBaseUrl: string; scope: string; expiresAt: string; createdAt: string;
}
export interface GrantView {
  id: string; name: string; kind: string; scope: string; pairedAt: string; revokedAt: string | null; peerBaseUrl: string;
}
export interface SharedTopicView {
  key: string; keyword: string; title: string; reason: string; sharedAt: string;
  source: { id: string; title: string; platform?: string; sourceName: string; sourceUrl: string; observedAt: string; kind: 'sourced' };
}