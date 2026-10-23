/** 对外地址与容器监听地址分开；反代应覆盖客户端传入的转发头。 */
interface PublicRequest {
  url: string;
  headers: Pick<Headers, 'get'>;
}

function origin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash
    || ['0.0.0.0', '[::]'].includes(url.hostname)) {
    throw new Error('对外地址必须是可访问的 HTTP(S) 根网址，请检查 APP_URL 和反向代理配置');
  }
  return url.origin;
}

export function publicBaseUrl(request: PublicRequest): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return origin(configured);

  const first = (name: string) => request.headers.get(name)?.split(',')[0]?.trim();
  const host = first('x-forwarded-host') || first('host');
  const requestUrl = new URL(request.url);
  if (host) {
    const proto = first('x-forwarded-proto') || requestUrl.protocol.slice(0, -1);
    if (!['http', 'https'].includes(proto) || /[\s/\\?#@]/.test(host)) {
      throw new Error('反向代理的对外域名或协议无效');
    }
    return origin(`${proto}://${host}`);
  }
  return origin(requestUrl.origin);
}

/** 业务跳转只允许本站路径；不把请求内部的监听域名带回浏览器。 */
export function publicUrl(path: string, request: PublicRequest): URL {
  const base = publicBaseUrl(request);
  const url = new URL(path, `${base}/`);
  if (url.origin !== base) throw new Error('返回地址必须属于本站');
  return url;
}