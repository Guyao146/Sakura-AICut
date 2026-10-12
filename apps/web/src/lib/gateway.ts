/** 网关设置的公开视图；不得包含调用 Key 或接入令牌。 */
export interface GatewayConnectionSummary {
  providerId: string;
  name: string;
  baseUrl: string;
  keyName: string;
  modelAccessMode: string;
  gatewayVersion: string;
  modelCount: number;
  syncedAt: string;
  allowPrivateNetwork: boolean;
}

export interface GatewayConnectInput {
  providerId?: string;
  baseUrl: string;
  apiKey: string;
  name?: string;
  allowPrivateNetwork: boolean;
  renewAuthorization?: boolean;
}

export interface GatewaySyncResult {
  connection: GatewayConnectionSummary;
  created: boolean;
  warning?: string;
}

export interface GatewayAuthorizationSession {
  /** 未完成授权的本地草稿句柄；只在发起授权的浏览器会话中有效。 */
  draftId: string;
  authorizeUrl: string;
  state: string;
}

/** 回调解析结果；失败时 error 必填。 */
export interface GatewayAuthorizationResult {
  ok: boolean;
  gatewayUrl?: string;
  error?: string;
}