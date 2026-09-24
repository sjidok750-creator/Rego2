// 한 파일짜리 HTML로 번들: docs/index.html(전체 문서), dist/artifact.html(본문만 — 호스팅용)
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serve = process.argv.includes('--serve');

async function bundle() {
  const res = await esbuild.build({
    entryPoints: [path.join(root, 'src/main.js')],
    bundle: true,
    format: 'esm',
    minify: !process.env.DEBUG,
    sourcemap: process.env.DEBUG ? 'inline' : false,
    target: ['es2020', 'safari15'],
    write: false,
    legalComments: 'none',
    logLevel: 'warning',
  });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = (await esbuild.transform(await readFile(path.join(root, 'src/styles.css'), 'utf8'), { loader: 'css', minify: true })).code;
  const tpl = await readFile(path.join(root, 'src/index.html'), 'utf8');
  const inline = tpl
    .replace('<link rel="stylesheet" href="styles.css">', () => `<style>${css}</style>`)
    .replace('<script type="module" src="main.js"></script>', () => `<script type="module">${js}</script>`);
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'docs/index.html'), inline);

  // 호스팅용: <html>/<head>/<body> 없이 머리글 요소 + 본문
  const between = (s, a, b) => s.slice(s.indexOf(a) + a.length, s.indexOf(b));
  const head = between(inline, '<!--HEAD-->', '<!--/HEAD-->');
  const body = between(inline, '<!--BODY-->', '<!--/BODY-->');
  const artifact = head.trim() + '\n' + body.replace(/<!--\/?SCRIPT-->/g, '').trim() + '\n';
  await writeFile(path.join(root, 'dist/artifact.html'), artifact);
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log(`built docs/index.html (${kb(inline.length)}), dist/artifact.html (${kb(artifact.length)})`);
}

await bundle();

if (serve) {
  const { watch } = await import('node:fs');
  let t = 0;
  watch(path.join(root, 'src'), { recursive: true }, () => {
    clearTimeout(t);
    t = setTimeout(() => bundle().catch((e) => console.error(e.message)), 80);
  });
  const port = Number(process.env.PORT || 5173);
  createServer(async (req, res) => {
    try {
      const html = await readFile(path.join(root, 'docs/index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  }).listen(port, () => console.log(`http://localhost:${port}`));
}
