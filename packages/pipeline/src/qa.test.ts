import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 必须在加载仓储前固定库文件
const data = mkdtempSync(join(tmpdir(), 'sakura-qa-'));
process.env.SAKURA_DATA_DIR = data;
process.env.SAKURA_DB_FILE = join(data, 'test.db');

const db = await import('../../db/src/index.ts');
const qa = await import('./qa.ts');

/**
 * 成片 QA 的回归测试。
 *
 * 不依赖真实的 ffmpeg / 视频文件：被测媒体的本地路径全部指向不存在的文件，
 * 探针关卡因此直接判负（这正是「渲染失败 / 文件丢失」废片的走查路径），
 * 视觉评审关卡在未配置图像路由时自动降级，不会发起任何网络请求。
 */

let serial = 0;
function unique(): number {
  return ++serial;
}

function makeProject(): string {
  return db.createProject({ name: `QA 测试项目 ${unique()}` }).id;
}

function makeShot(projectId: string, clipMediaIds: string[], selectedMediaId?: string | null): string {
  const shot = db.createShot(projectId, {
    index: unique(),
    episode: 1,
    description: 'QA 测试镜头',
    durationSec: 5,
    shotSize: '中景',
    characterIds: [],
    propIds: [],
    prompt: '测试提示词',
    clipMediaIds,
    selectedMediaId: selectedMediaId ?? null,
    status: 'succeeded',
  });
  return shot.id;
}

/** 本地文件故意不存在：模拟「渲染失败 / 文件丢失」的废片 */
function makeMissingVideo(projectId: string, ownerId?: string): string {
  const n = unique();
  return db
    .createMedia({
      projectId,
      kind: 'video',
      url: `/api/files/med_missing_${n}.mp4`,
      path: `media/med_missing_${n}.mp4`,
      mime: 'video/mp4',
      durationSec: 5,
      ownerType: 'shot',
      ownerId,
    })
    .id;
}

beforeEach(() => {
  const tables = db
    .getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  for (const row of tables) db.getDb().prepare(`DELETE FROM "${row.name}"`).run();
});

test('探针硬故障（文件丢失）：判负并写入报告，不再调用模型', async () => {
  const projectId = makeProject();
  const mediaId = makeMissingVideo(projectId);
  const shotId = makeShot(projectId, [mediaId], mediaId);

  const report = await qa.reviewMedia(
    { mediaId, shotId, source: 'auto' },
    { withVision: true, autoFlag: true },
  );

  assert.equal(report.verdict, 'fail');
  assert.equal(report.status, 'succeeded');
  assert.equal(report.probe.ok, false);
  assert.equal(report.probe.decodable, false);
  assert.ok(report.issues.length >= 1);
  assert.ok(report.issues.some((issue: string) => issue.includes('无法解码')));
  assert.equal(report.review, null);
  assert.equal(db.getLatestQaReport(mediaId)?.id, report.id);
});

test('自动修复：判负片段正是选中片段时踢出选中位，无替代则标记待重抽', async () => {
  const projectId = makeProject();
  const mediaId = makeMissingVideo(projectId);
  const shotId = makeShot(projectId, [mediaId], mediaId);

  const report = await qa.reviewMedia({ mediaId, shotId }, { withVision: false, autoFlag: true });
  assert.equal(report.verdict, 'fail');

  const after = db.getShot(shotId);
  assert.equal(after?.selectedMediaId, null);
  assert.equal(after?.status, 'failed');
  assert.ok(after?.error?.includes('QA 未通过'));
});

test('自动修复：判负片段不是选中片段时不动镜头', async () => {
  const projectId = makeProject();
  const badId = makeMissingVideo(projectId);
  const selectedId = makeMissingVideo(projectId);
  const shotId = makeShot(projectId, [badId, selectedId], selectedId);

  const report = await qa.reviewMedia({ mediaId: badId, shotId }, { withVision: false, autoFlag: true });
  assert.equal(report.verdict, 'fail');

  const after = db.getShot(shotId);
  assert.equal(after?.selectedMediaId, selectedId);
  assert.equal(after?.status, 'succeeded');
  assert.ok(!after?.error);
});

test('自动修复：autoFlag=false 时只出报告、不改镜头', async () => {
  const projectId = makeProject();
  const mediaId = makeMissingVideo(projectId);
  const shotId = makeShot(projectId, [mediaId], mediaId);

  await qa.reviewMedia({ mediaId, shotId }, { withVision: false, autoFlag: false });

  const after = db.getShot(shotId);
  assert.equal(after?.selectedMediaId, mediaId);
  assert.equal(after?.status, 'succeeded');
});


test('有可替代片段时：判负片段被踢出，选中位换到同镜头另一片段', async () => {
  const projectId = makeProject();
  const badId = makeMissingVideo(projectId);
  const altId = makeMissingVideo(projectId);
  const shotId = makeShot(projectId, [badId, altId], badId);

  await qa.reviewMedia({ mediaId: badId, shotId }, { withVision: false, autoFlag: true });

  const after = db.getShot(shotId);
  assert.equal(after?.selectedMediaId, altId);
  assert.equal(after?.status, 'succeeded');
  assert.ok(!after?.error);
});

test('非视频媒体不允许 QA', async () => {
  const projectId = makeProject();
  const imageId = db
    .createMedia({ projectId, kind: 'image', url: `/api/files/img_${unique()}.png`, mime: 'image/png' })
    .id;

  await assert.rejects(
    () => qa.reviewMedia({ mediaId: imageId }),
    /QA 只支持视频媒体/,
  );
});

test('未配置图像路由时视觉评审自动降级（仅探针，不调模型）', async () => {
  assert.equal(qa.hasVisionRoute(), false);
  const review = await qa.reviewFramesWithVision(['data:image/jpeg;base64,AAAA'], {});
  assert.equal(review, null);
});

test('增量扫描：已通过的历史报告默认跳过，refresh=true 才重查', async () => {
  const projectId = makeProject();
  const mediaId = makeMissingVideo(projectId);
  const shotId = makeShot(projectId, [mediaId], mediaId);

  // 伪造一份已通过的历史报告
  const history = db.createQaReport({ projectId, mediaId, shotId, source: 'auto' });
  db.updateQaReport(history.id, {
    status: 'succeeded',
    verdict: 'pass',
    probe: { ok: true, decodable: true, durationSec: 5, width: 1080, height: 1920, fps: 30 },
    review: null,
    issues: [],
  });

  const skipped = await qa.reviewProjectClips(projectId, { withVision: false });
  assert.equal(skipped.total, 1);
  assert.equal(skipped.passed, 1);
  assert.equal(skipped.skipped, 1);
  assert.equal(skipped.failed, 0);
  assert.deepEqual(skipped.reshootIndexes, []);
  assert.equal(db.getLatestQaReport(mediaId)?.id, history.id);

  // 强制重查：文件不存在 → 判负，并自动修复
  const refreshed = await qa.reviewProjectClips(projectId, { withVision: false, refresh: true });
  assert.equal(refreshed.skipped, 0);
  assert.equal(refreshed.failed, 1);
  const shot = db.getShot(shotId);
  assert.deepEqual(refreshed.reshootIndexes, [shot?.index ?? -1]);
  assert.equal(db.getShot(shotId)?.selectedMediaId, null);
});

test('项目汇总：getProjectQaSummary 聚合评级与重抽镜头序号', async () => {
  const projectId = makeProject();
  const mediaId = makeMissingVideo(projectId);
  const shotId = makeShot(projectId, [mediaId], mediaId);

  await qa.reviewMedia({ mediaId, shotId }, { withVision: false, autoFlag: false });

  const summary = qa.getProjectQaSummary(projectId);
  assert.equal(summary.total, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.passed, 0);
  assert.equal(summary.reports[0].verdict, 'fail');
  const shot = db.getShot(shotId);
  assert.deepEqual(summary.reshootIndexes, [shot?.index ?? -1]);
});
