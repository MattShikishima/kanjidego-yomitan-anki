import fs from 'fs';
import path from 'path';
import util from 'util';
import { execFile } from 'child_process';
import jsdom from 'jsdom';
import { BROWSER_USER_AGENT, PAGES_DIRECTORY } from '../constants';

const fsExists = util.promisify(fs.exists);
const fsReadFile = util.promisify(fs.readFile);
const execFileAsync = util.promisify(execFile);

/**
 * Gets the document from the page.
 * Caches the page in the /pages directory.
 * @param pageUrl
 * @returns
 */
export async function getPageDocument(pageUrl: string) {
  const fileName = pageUrl.replace(/\W/g, '_') + '.html';
  const filePath = path.join(process.cwd(), PAGES_DIRECTORY, fileName);

  if (!(await fsExists(filePath))) {
    console.log('Fetching:', pageUrl);
    const dir = path.dirname(filePath);
    if (!(await fsExists(dir))) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    await fetchPage(pageUrl, filePath);
  }

  const text = await fsReadFile(filePath, 'utf-8');
  const dom = new jsdom.JSDOM(text);
  const document = dom.window.document;
  return document;
}

/**
 * Fetches a page and writes it to destPath.
 *
 * The wiki is served behind Cloudflare, whose bot mitigation rejects Node's
 * fetch (it fingerprints the TLS handshake). curl passes the challenge, so we
 * shell out to it. The download goes to a temp file first so a failed fetch
 * never leaves a truncated page in the cache.
 */
async function fetchPage(pageUrl: string, destPath: string) {
  const tempPath = `${destPath}.tmp`;
  try {
    await execFileAsync(
      'curl',
      [
        '--silent',
        '--show-error',
        '--location',
        '--fail',
        '--compressed',
        '--user-agent',
        BROWSER_USER_AGENT,
        '--header',
        'Accept-Language: ja,en;q=0.9',
        '--output',
        tempPath,
        pageUrl,
      ],
      { maxBuffer: 1024 * 1024 * 128 }
    );
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true });
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(
        'curl is required to fetch wiki pages (the wiki blocks Node fetch via Cloudflare), but it was not found on PATH.'
      );
    }
    throw new Error(`Failed to fetch ${pageUrl}: ${err.message}`);
  }
  await fs.promises.rename(tempPath, destPath);
}
