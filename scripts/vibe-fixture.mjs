export function testAudio(seconds = 0.35) {
  const samples = Math.round(24000 * seconds), buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(48000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(8000 * Math.sin(i / 24000 * Math.PI * 880)), 44 + i * 2);
  return buffer;
}


export const testScript = {
  shots: [
    { id: 'shot_1', index: 1, durationSec: 1.5, visualDescription: '粉色圆形从左向右移动', narration: '开始' },
    { id: 'shot_2', index: 2, durationSec: 1.5, visualDescription: '蓝色圆形向中央聚拢', narration: '相遇' },
  ],
};
export const testMeta = { durationSec: 3, fps: 24, width: 1024, height: 1024 };
export const testCode = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#152033;color:white;font-family:sans-serif}#petal{position:absolute;width:120px;height:120px;background:#fa70aa;border-radius:50%;top:400px}#caption{position:absolute;bottom:80px;width:100%;text-align:center;font-size:60px}</style>
</head><body><div id="petal"></div><div id="caption"></div><script>
window.__vibeMeta = ${JSON.stringify(testMeta)};
window.__vibeSeek = function(t) {
  document.getElementById('petal').style.left = (100 + 700 * t / 3) + 'px';
  document.getElementById('petal').style.background = t < 1.5 ? '#fa70aa' : '#44aaff';
  document.getElementById('caption').textContent = t < 1.5 ? '开始' : '相遇';
};
window.__vibeSeek(0);
</script></body></html>`;
