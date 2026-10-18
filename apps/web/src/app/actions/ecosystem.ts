'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { cancelPairing, disconnectEcosystem, ecosystemView, generateEcosystemPairing, readPeerTopics, removeEcosystem, requireEcosystemManager, setEcosystemScreenplayImport } from '@/lib/server/ecosystem';
import { PeerError } from '@/lib/server/peer-http';

async function managed<T>(work: () => T | Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    await requireEcosystemManager();
    const data = await work();
    revalidatePath('/settings');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof PeerError ? error.message : error instanceof z.ZodError ? '请输入有效的应用名称和服务地址' : '操作失败，请稍后重试' };
  }
}
const idSchema = z.string().regex(/^(?:grant|pair)_[a-zA-Z0-9_-]{1,60}$/);
export async function createPairingAction(input: { name: string; peerBaseUrl: string; allowRender: boolean; allowScreenplayImport: boolean }) {
  return managed(() => generateEcosystemPairing(input));
}
export async function cancelPairingAction(input: { id: string }) {
  return managed(() => cancelPairing(idSchema.parse(input.id)));
}
export async function revokeGrantAction(input: { id: string }) {
  return managed(() => disconnectEcosystem(idSchema.parse(input.id)));
}
export async function deleteGrantAction(input: { id: string }) {
  return managed(() => removeEcosystem(idSchema.parse(input.id)));
}
export async function refreshEcosystemAction() { return managed(ecosystemView); }
export async function setScreenplayImportAction(input: { id: string; enabled: boolean }) {
  return managed(() => setEcosystemScreenplayImport(idSchema.parse(input.id), z.boolean().parse(input.enabled)));
}
export async function readPeerTopicsAction(input: { id: string }) {
  return managed(() => readPeerTopics(idSchema.parse(input.id)));
}