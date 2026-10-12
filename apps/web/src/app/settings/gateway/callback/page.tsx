import { redirect } from 'next/navigation';
import { completeGatewayAuthorization } from '@/lib/server/gateway-oauth';
import { GatewayError } from '@/lib/server/gateway-http';

/**
 * 网关账号授权回调：只接受 code/state 或错误参数，不回显令牌。
 * 失败时回到设置页并携带可读原因；成功后由设置页继续同步模型配置。
 */
export const dynamic = 'force-dynamic';

export default async function GatewayCallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  try {
    await completeGatewayAuthorization({
      code: single(params.code),
      state: single(params.state),
      error: single(params.error),
      errorDescription: single(params.error_description),
    });
    redirect('/settings?tab=providers&gateway=authorized');
  } catch (error) {
    const message = error instanceof GatewayError ? error.message : '网关账号授权失败，请重新发起';
    redirect(`/settings?tab=providers&gateway=${encodeURIComponent(`error:${message}`)}`);
  }
}