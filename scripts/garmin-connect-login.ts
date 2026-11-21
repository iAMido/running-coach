/**
 * Sign in to Garmin Connect ONCE, on your own machine, so the app can put
 * strength workouts on your Garmin calendar.
 *
 * You type your Garmin email and password here (the password is hidden). They
 * go to sso.garmin.com only. Nothing but the resulting token is kept: an
 * OAuth1 token (about a year), stored encrypted in runcoach.garmin_connect_tokens.
 * If your account uses two-step verification, you will be asked for the code.
 *
 *   bunx tsx scripts/garmin-connect-login.ts --env "C:/Users/ido/running-coach/.env.local" --user <your app login email>
 *
 * Run it again whenever the app says the Garmin Connect sign-in has expired.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
dotenv.config({ path: path.resolve(process.cwd(), argValue('--env') ?? '.env.local'), quiet: true });

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

/** Read a line without echoing it. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    if (!stdin.isTTY) return reject(new Error('Run this in an interactive terminal (the password prompt needs one).'));
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') { // Ctrl-C
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const userId = argValue('--user');
  if (!userId) throw new Error('Pass --user <the email you sign in to the app with>');
  const { garminLogin } = await import('../lib/garmin-connect/sso');
  const { exchangeOAuth2 } = await import('../lib/garmin-connect/client');
  const { saveGarminConnectLogin } = await import('../lib/db/garmin-connect');

  console.log('\nGarmin Connect sign-in for RunCoach. Your password is sent to sso.garmin.com only and is not stored.\n');
  const email = await ask('Garmin email: ');
  const password = await askHidden('Garmin password (hidden): ');

  const { oauth1, consumer } = await garminLogin(email, password, () => ask('Two-step verification code: '));
  const oauth2 = await exchangeOAuth2(oauth1, consumer);
  await saveGarminConnectLogin(userId, oauth1, consumer, oauth2);
  console.log(`\nDone. Garmin Connect is connected for ${userId}. You can close this window.`);
}

main().catch((e) => {
  console.error(`\nSign-in failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
