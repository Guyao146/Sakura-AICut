import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayError';
  }
}

const MAX_RESPONSE_BYTES = 1024 * 1024;
const forbiddenAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['169.254.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) forbiddenAddresses.addSubnet(address, prefix, 'ipv4');
forbiddenAddresses.addAddress('100.100.100.200', 'ipv4');
forbiddenAddresses.addAddress('168.63.129.16', 'ipv4');
forbiddenAddresses.addAddress('::', 'ipv6');
forbiddenAddresses.addSubnet('fe80::', 10, 'ipv6');
forbiddenAddresses.addSubnet('ff00::', 8, 'ipv6');
forbiddenAddresses.addSubnet('64:ff9b::', 96, 'ipv6');

const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ['10.0.0.0', 8], ['127.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['100.64.0.0', 10], ['198.18.0.0', 15],
] as const) privateAddresses.addSubnet(address, prefix, 'ipv4');
privateAddresses.addAddress('::1', 'ipv6');
privateAddresses.addSubnet('fc00::', 7, 'ipv6');

export function normalizeGatewayUrl(value: string): string {
  const input = value.trim();
  if (!input || input.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(input)) {
    throw new GatewayError('请填写有效的网关部署网址');
  }
  let url: URL;
  try { url = new URL(input); } catch { throw new GatewayError('网关网址必须以 https:// 或 http:// 开头'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new GatewayError('网关网址只支持 HTTP/HTTPS，且不能包含账号、密码、查询参数或片段');
  }
  // 兼容误填的接口根路径，同时保留反向代理部署前缀。
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '') || '/';
  return url.toString().replace(/\/+$/, '');
}

export function validateGatewayAddress(address: string, protocol: string, allowPrivateNetwork: boolean): void {
  const family = isIP(address);
  const type = family === 6 ? 'ipv6' : 'ipv4';
  if (!family || forbiddenAddresses.check(address, type)) {
    throw new GatewayError('不能连接未指定地址、链路本地地址、元数据地址或组播地址');
  }
  const privateNetwork = privateAddresses.check(address, type);
  if (privateNetwork && !allowPrivateNetwork) {
    throw new GatewayError('该网址指向本机或内网；确认可信后勾选「允许本机 / 内网地址」');
  }
  if (protocol === 'http:' && !privateNetwork) {
    throw new GatewayError('公网网关必须使用 HTTPS，避免明文发送调用 Key');
  }
}

async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([pending, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

function statusError(status: number): GatewayError {
  if (status === 401) return new GatewayError('网关凭据无效或调用 Key 已停用，请检查本地调用 Key');
  if (status === 403) return new GatewayError('网关拒绝访问：权限不足或接入授权已取消，请联系网关管理员');
  if (status === 404 || status === 405) return new GatewayError('该网址不支持网关接入接口，请检查部署根网址和网关版本');
  if (status === 429) return new GatewayError('网关验证过于频繁，请稍后再试');
  if (status >= 300 && status < 400) return new GatewayError('网关返回了重定向，已停止发送凭据；请填写最终部署网址');
  return new GatewayError(`网关请求失败（HTTP ${status}），请稍后再试`);
}

type GatewayPath = '/api/integration/verify' | '/api/integration/config' | '/oauth/token';

/** 仅请求固定接入路径；不跟随重定向，不携带本站 Cookie，不回显远端错误正文。 */
export async function requestGatewayJson(
  baseUrl: string,
  path: GatewayPath,
  options: { allowPrivateNetwork: boolean; body?: Record<string, string>; token?: string; timeoutMs?: number },
): Promise<unknown> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 12_000);
  try {
    const url = new URL(`${normalizeGatewayUrl(baseUrl)}${path}`);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const family = isIP(hostname);
    const addresses = family
      ? [{ address: hostname, family }]
      : await abortable(lookup(hostname, { all: true, order: 'ipv4first' }), signal);
    if (addresses.length === 0) throw new GatewayError('无法解析网关网址');
    for (const { address } of addresses) validateGatewayAddress(address, url.protocol, options.allowPrivateNetwork);
    const target = addresses[0];
    const body = options.body ? JSON.stringify(options.body) : undefined;

    return await new Promise<unknown>((resolve, reject) => {
      // 固定已检查的 IP，避免校验后再次解析造成 DNS 重绑定；TLS 仍校验原始主机名。
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        hostname: target.address,
        family: target.family,
        servername: family ? undefined : hostname,
        agent: false,
        signal,
        maxHeaderSize: 16 * 1024,
        method: body ? 'POST' : 'GET',
        headers: {
          Host: url.host,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
      }, (response) => {
        response.on('error', reject);
        const status = response.statusCode ?? 502;
        if (status < 200 || status >= 300) {
          reject(statusError(status));
          response.destroy();
          return;
        }
        const contentType = response.headers['content-type'] ?? '';
        if (!/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
          reject(new GatewayError('网关未返回 JSON 配置，请检查网址是否误填为登录页或管理页'));
          response.destroy();
          return;
        }
        if (Number(response.headers['content-length']) > MAX_RESPONSE_BYTES) {
          reject(new GatewayError('网关配置响应过大，已停止读取'));
          response.destroy();
          return;
        }
        let length = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > MAX_RESPONSE_BYTES) {
            reject(new GatewayError('网关配置响应过大，已停止读取'));
            response.destroy();
          } else chunks.push(chunk);
        });
        response.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { reject(new GatewayError('网关返回了无效的 JSON 配置')); }
        });
      });
      request.on('error', reject);
      request.end(body);
    });
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (signal.aborted) throw new GatewayError('连接网关超时，请检查部署网络后重试');
    throw new GatewayError('无法连接网关，请检查网址、证书及部署网络');
  }
}