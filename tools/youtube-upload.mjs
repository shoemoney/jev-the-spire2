#!/usr/bin/env node
// Upload a video to YouTube, set its metadata, and attach a custom thumbnail.
//
//   node tools/youtube-upload.mjs --auth          # one-time: print consent URL, save refresh token
//   node tools/youtube-upload.mjs --dry-run       # show exactly what would be sent
//   node tools/youtube-upload.mjs
//
// Reads OAuth client from ~/.config/claude-workspace/oauth-client.json and caches
// the refresh token beside it. Metadata lives in tools/youtube-meta.json so the
// title and description are reviewable in a diff before anything goes public.
//
// Two things that bite:
//  - Until the Cloud project passes Google's API audit, every upload is FORCED
//    PRIVATE and cannot be made public through the API. Not a bug in this script.
//    Check status at console.cloud.google.com > APIs & Services > OAuth consent.
//  - Quota is 10,000 units/day, an upload costs ~1,600, a thumbnail ~50. So about
//    six uploads a day, then HTTP 403 quotaExceeded until midnight Pacific.

import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = resolve(homedir(), '.config/claude-workspace/oauth-client.json');
const TOKEN_PATH = resolve(homedir(), '.config/claude-workspace/youtube-refresh-token.json');
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube';

const args = process.argv.slice(2);
const has = f => args.includes(f);
const arg = (f, d) => args.find(a => a.startsWith(f + '='))?.split('=').slice(1).join('=') ?? d;

async function client() {
  const raw = JSON.parse(await readFile(CLIENT_PATH, 'utf8'));
  const c = raw.installed ?? raw.web;
  if (!c?.client_id) throw new Error(`No OAuth client in ${CLIENT_PATH}`);
  return c;
}

// Out-of-band-style loopback consent. Prints a URL; you paste back the code.
async function authorize() {
  const c = await client();
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: c.client_id, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent',
  });
  console.log('\nOpen this, approve, then paste the code back here:\n\n' + url + '\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question('code: ')).trim();
  rl.close();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'authorization_code' }),
  });
  const j = await r.json();
  if (!j.refresh_token) throw new Error('No refresh token returned: ' + JSON.stringify(j));
  await writeFile(TOKEN_PATH, JSON.stringify({ refresh_token: j.refresh_token }, null, 2), { mode: 0o600 });
  console.log(`\nSaved refresh token to ${TOKEN_PATH} (0600). Uploads are headless from here.`);
}

async function accessToken() {
  const c = await client();
  const { refresh_token } = JSON.parse(await readFile(TOKEN_PATH, 'utf8')
    .catch(() => { throw new Error('No refresh token. Run with --auth first.'); }));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret,
      refresh_token, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(j));
  return j.access_token;
}

async function main() {
  if (has('--auth')) return authorize();

  const meta = JSON.parse(await readFile(resolve(HERE, 'youtube-meta.json'), 'utf8'));
  const video = resolve(HERE, '..', arg('--video', meta.videoFile));
  const thumb = resolve(HERE, '..', arg('--thumbnail', meta.thumbnailFile));
  const privacy = arg('--privacy', meta.privacyStatus);
  const size = statSync(video).size;

  const body = {
    snippet: { title: meta.title, description: meta.description, tags: meta.tags,
      categoryId: meta.categoryId ?? '28' },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false,
      license: 'youtube', embeddable: true },
  };

  if (has('--dry-run')) {
    console.log(JSON.stringify({ video, sizeMB: +(size / 1e6).toFixed(2), thumb, body }, null, 2));
    console.log(`\nTitle is ${meta.title.length} chars (YouTube max 100).`);
    console.log(`Description is ${meta.description.length} chars (max 5000).`);
    return;
  }

  const token = await accessToken();

  // Resumable upload: start a session, then send the bytes in one PUT.
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' },
    body: JSON.stringify(body),
  });
  if (!init.ok) throw new Error(`init ${init.status}: ${await init.text()}`);
  const session = init.headers.get('location');
  if (!session) throw new Error('No resumable session URL returned');

  console.log(`Uploading ${(size / 1e6).toFixed(1)}MB...`);
  const up = await fetch(session, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
    body: createReadStream(video), duplex: 'half',
  });
  if (!up.ok) throw new Error(`upload ${up.status}: ${await up.text()}`);
  const vid = await up.json();
  console.log(`\nhttps://youtu.be/${vid.id}   (privacyStatus: ${vid.status?.privacyStatus})`);
  if (vid.status?.privacyStatus !== privacy) {
    console.log(`NOTE: asked for "${privacy}", got "${vid.status?.privacyStatus}". That is the`);
    console.log('unaudited-project restriction, not this script. Flip it by hand in Studio.');
  }

  const t = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${vid.id}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: createReadStream(thumb), duplex: 'half',
  });
  console.log(t.ok ? 'Thumbnail set.' : `Thumbnail failed ${t.status}: ${await t.text()}`);
}

main().catch(e => { console.error('\n' + e.message); process.exit(1); });
