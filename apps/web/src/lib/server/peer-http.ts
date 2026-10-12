import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

export class PeerError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const forbidden = new BlockList();
for (const [ip, prefix] of [['0.0.0.0', 8], ['169.254.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) forbidden.addSubnet(ip, prefix, 'ipv4');
for (const ip of ['100.100.100.200', '168.63.129.16']) forbidden.addAddress(ip, 'ipv4');
for (const [ip, prefix] of [['::', 128], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2002::', 16], ['2001::', 32]] as const) forbidden.addSubnet(ip, prefix, 'ipv6');
const privateNet = new BlockList();
for (const [ip, prefix] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10]] as const) privateNet.addSubnet(ip, prefix, 'ipv4');
privateNet.addAddress('::1', 'ipv6');
privateNet.addSubnet('fc00::', 7, 'ipv6');

export function normalizePeerUrl(value: string): string {
  if (!value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) throw new PeerError('请输入有效的服务地址', 400);
  let url: URL;
  try { url = new URL(value); } catch { throw new PeerError('地址必须以 HTTP(S) 开头', 400); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new PeerError('服务地址不能包含账号、密码、查询参数或片段', 400);
  return url.toString().replace(/\/+$/, '');
}

export function validatePeerAddress(address: string, protocol: string): void {
  // URL 会把映射地址规范化为十六进制，先还原 IPv4 再检查元数据/内网范围。
  const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i.exec(address);
  if (mapped) {
    const parts = mapped.slice(1).map((part) => parseInt(part, 16));
    address = [parts[0] >> 8, parts[0] & 255, parts[1] >> 8, parts[1] & 255].join('.');
  }
  const family = isIP(address);
  const type = family === 6 ? 'ipv6' : 'ipv4';
  if (!family || forbidden.check(address, type)) throw new PeerError('禁止连接未指定、元数据、链路本地或组播地址', 400);
  if (protocol === 'http:' && !privateNet.check(address, type)) throw new PeerError('公网服务必须使用 HTTPS，避免明文发送凭证', 400);
}

/** 只接受服务端固定路径，固定已验证 IP；不跟随重定向、转发 Cookie 或回显远端正文。 */
export async function peerJson(baseUrl: string, path: string, options: { token?: string; apiKey?: string; body?: unknown; method?: 'GET' | 'POST'; idempotencyKey?: string } = {}): Promise<unknown> {
  if (!/^\/api\/(?:ecosystem|open)\//.test(path) || /[\\#]/.test(path)) throw new PeerError('接口路径无效', 400);
  const url = new URL(`${normalizePeerUrl(baseUrl)}${path}`);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const signal = AbortSignal.timeout(10_000);
  let cancelDns: () => void = () => {};
  try {
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
      lookup(hostname, { all: true, order: 'ipv4first' }),
      new Promise<never>((_, reject) => {
        cancelDns = () => reject(new PeerError('服务地址解析超时', 503));
        signal.addEventListener('abort', cancelDns, { once: true });
      }),
    ]);
    signal.removeEventListener('abort', cancelDns);
    if (!addresses.length) throw new PeerError('服务地址无法解析', 503);
    for (const item of addresses) validatePeerAddress(item.address, url.protocol);
    const target = addresses[0];
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    return await new Promise<unknown>((resolve, reject) => {
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        hostname: target.address, family: target.family, servername: isIP(hostname) ? undefined : hostname,
        agent: false, signal, maxHeaderSize: 16_384, method: options.method ?? (body ? 'POST' : 'GET'),
        headers: { Host: url.host, Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.apiKey ? { 'X-API-Key': options.apiKey } : {}),
          ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        },
      }, (res) => {
        res.on('error', reject);
        const status = res.statusCode ?? 502;
        if (status < 200 || status >= 300) {
          reject(new PeerError(status === 401 ? '对端授权无效或已撤销' : status === 403 ? '对端拒绝访问：权限不足' : status === 429 ? '配对操作过于频繁，请稍后重试' : `对端请求失败（HTTP ${status}）`, status));
          res.destroy(); return;
        }
        if (!/^application\/json(?:;|$)/i.test(res.headers['content-type'] ?? '')) {
          reject(new PeerError('对端未返回 JSON，请检查服务地址和版本')); res.destroy(); return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1_048_576) { reject(new PeerError('对端响应超过大小限制')); res.destroy(); }
          else chunks.push(chunk);
        });
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { reject(new PeerError('对端返回了无效数据')); }
        });
      });
      req.on('error', reject);
      req.end(body);
    });
  } catch (error) {
    if (error instanceof PeerError) throw error;
    throw new PeerError(signal.aborted ? '连接对端超时，请检查服务是否运行' : '无法连接对端，请检查地址、证书和网络', 503);
  } finally { signal.removeEventListener('abort', cancelDns); }
}