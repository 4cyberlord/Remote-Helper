#!/usr/bin/env node
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { nativeBridge } from '../lib/display.mjs';
import { loadConfig, newSession, currentSession, loadSession, saveSession, sessionDir, sessionLock } from '../lib/state.mjs';
import { capture } from '../lib/capture.mjs';
import { operation } from '../lib/api.mjs';
import { submit } from '../lib/workflow.mjs';

const executable = basename(process.argv[1] || 'council-remote');
const direct = executable === 'council-remote' || executable === 'remote.mjs';
const command = direct ? process.argv[2] : executable;
const args = direct ? process.argv.slice(3) : process.argv.slice(2);
const CAPTURE_COMMANDS = new Set(['00', '01', '02', '03', '04']);

function usage() {
  console.log(`Council Remote Helper — macOS terminal

  00           New independent session
  01           Full screenshot (display under pointer)
  02           Left half of the display
  03           Right half of the display
  04           Submit the session to the cloud agents

  council-remote             Open terminal session accepting 00–04
  council-remote login       Reauthenticate with username and PIN
  council-remote logout      Revoke this helper's sign-in\n  council-remote retry ID    Recover a previously sealed session by UUID

Screenshots stay in a separate, private folder for each 00.
Open Council Editor to see the (R) solution history.
`);
}

async function ask(question) {
  if (!stdin.isTTY) throw new Error('An interactive terminal is required to sign in.');
  const rl = createInterface({ input: stdin, output: stdout });
  try { return (await new Promise(resolve => rl.question(question, resolve))).trim(); }
  finally { rl.close(); }
}

async function secret(question) {
  if (!stdin.isTTY || !stdin.setRawMode) throw new Error('An interactive terminal is required for PIN entry.');
  return new Promise((resolve, reject) => {
    let pin = '';
    stdout.write(question);
    stdin.resume(); stdin.setRawMode(true); stdin.setEncoding('utf8');
    const cleanup = (err) => {
      stdin.removeListener('data', read);
      stdin.setRawMode(false);
      stdin.pause(); stdout.write('\n');
      if (err) reject(err); else resolve(pin);
    };
    function read(chars) {
      for (const char of chars) {
        if (char === '\u0003' || char === '\u0004') { cleanup(new Error('Sign-in cancelled.')); return; }
        if (char === '\r' || char === '\n') { cleanup(); return; }
        if (char === '\u007f' || char === '\b') pin = pin.slice(0, -1);
        else if (char >= '0' && char <= '9' && pin.length < 4) pin += char;
      }
    }
    stdin.on('data', read);
  });
}

async function signIn(config) {
  const username = await ask('Council Editor username: ');
  const pin = await secret('Council Editor PIN (hidden): ');
  const response = await operation(config, null, 'auth.login', { username, pin });
  if (!response?.token || !response?.userId) throw new Error('The server did not issue a valid sign-in.');
  // Do not pass the bearer token on the command line or save it in a JSON file.
  nativeBridge(['keychain-set'], response.token);
  console.log(`Signed in as ${response.username}. The token is protected in macOS Keychain.`);
  return { token: response.token, userId: response.userId, config };
}

async function ensureAuth({ fresh = false } = {}) {
  const config = await loadConfig();
  if (!fresh) {
    try {
      const token = nativeBridge(['keychain-get']);
      const who = await operation(config, token, 'auth.whoami');
      if (!who?.userId) throw new Error('Sign-in could not be validated.');
      return { config, token, userId: who.userId };
    } catch (error) {
      // Only missing or revoked credentials cause a new PIN prompt. Do not
      // misdiagnose an offline server as an expired login.
      if (!/No login in Keychain|no longer valid|sign in first|HTTP 401|session token|not valid/i.test(error.message)) throw error;
    }
  }
  return signIn(config);
}

async function handle(commandName, argumentsList, auth) {
  switch (commandName) {
    case '00': {
      const s = await newSession(argumentsList.join(' '), auth.userId);
      console.log(`(R) New session: ${s.id}\nFolder: ${sessionDir(s.id)}\nReady for 01, 02, 03; submit with 04.`);
      return;
    }
    case '01': case '02': case '03': {
      const s = await currentSession();
      if (s.userId !== auth.userId) throw new Error('This session belongs to a different account. Use 00.');
      const kind = { '01': 'full', '02': 'left', '03': 'right' }[commandName];
      await sessionLock(s.id, async () => {
        if (s.pending || s.submissions.length) throw new Error('This batch is sealed. Type 00 for a new session, or retry 04 if submission failed.');
        const shot = await capture(s, kind);
        s.captures.push(shot);
        await saveSession(s);
        console.log(`Saved ${kind}: ${shot.width}×${shot.height} pixels\n${shot.path}\n${s.captures.length}/10 screenshots.`);
      });
      return;
    }
    case '04': {
      const s = await currentSession();
      if (s.userId !== auth.userId) throw new Error('This session belongs to a different account. Use 00.');
      const result = await submit(s, { config: auth.config, token: auth.token });
      console.log(`(R) Job queued: ${result.id}\nSession: ${result.sessionId}\nThe agents process it independently. Open Council Editor for the result.`);
      return;
    }
    default: throw new Error('Only 00, 01, 02 and 03 capture, and 04 submits.');
  }
}

async function interactive(auth) {
  console.log('Council Remote Helper | 00 new · 01 full · 02 left · 03 right · 04 submit · exit');
  const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY, prompt: 'remote> ' });
  rl.prompt();
  for await (const line of rl) {
    const [cmd, ...parts] = line.trim().split(/\s+/).filter(Boolean);
    if (!cmd) { rl.prompt(); continue; }
    if (cmd === 'exit' || cmd === 'quit') break;
    try { await handle(cmd, parts, auth); }
    catch (error) { console.error(`Error: ${error.message}`); }
    rl.prompt();
  }
  rl.close();
}

async function main() {
  if (command === '--help' || command === 'help' || command === '-h') return usage();
  if (command === 'logout') {
    const config = await loadConfig();
    try { const token = nativeBridge(['keychain-get']); await operation(config, token, 'auth.logout'); }
    catch (error) { throw new Error(`Could not revoke login on the server: ${error.message}`); }
    nativeBridge(['keychain-delete']); console.log('Signed out and local credential cleared.'); return;
  }
  if (command === 'login') { await ensureAuth({ fresh: true }); return; }
  if (command && command !== 'retry' && !CAPTURE_COMMANDS.has(command)) throw new Error('Unknown command. Use 00–04, or council-remote for the interactive shell.');
  const auth = await ensureAuth();
  if (command === 'retry') {
    if (args.length !== 1) throw new Error('Usage: council-remote retry <session-uuid>');
    const session = await loadSession(args[0]);
    if (session.userId !== auth.userId) throw new Error('This session belongs to a different account.');
    const result = await submit(session, { config: auth.config, token: auth.token });
    console.log('Recovered (R) job: ' + result.id + '\\nSession: ' + result.sessionId);
    return;
  }
  if (!command) return interactive(auth);
  await handle(command, args, auth);
}

main().catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
